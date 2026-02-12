# Scheduling Logic — Complete Documentation

This document describes **exactly** what `scheduler_logic.py` does, function by function, phase by phase. Edit this document freely; changes will be applied back to the code.

---

## 1. Imports & Setup

```
os, json, random, psycopg2, logging
datetime (aliased as dt), timedelta
dateutil.relativedelta → relativedelta
psycopg2.extras → RealDictCursor
```

A module-level logger `customs_api` is created.

---

## 2. `get_db()` — Database Connection

- Reads `DATABASE_URL` from environment.
- Converts `postgres://` prefix to `postgresql://`.
- Appends `sslmode=require` if missing.
- Returns a `psycopg2` connection, or `None` on failure.

---

## 3. Helper Functions (Module-Level)

### 3a. `is_in_period(date_obj, range_config)`

Checks whether a date falls inside a configurable active range.

- **Input**: a `date` object and a `range_config` dict with `start` and `end` keys (format `DD-MM` or `DD/MM`).
- If `range_config` is empty / missing keys → returns `True` (always active).
- Supports wrap-around ranges (e.g. `01-11` to `31-03`).
- Returns `True`/`False`.

### 3b. `is_scoreable_day(d_date, special_dates_set)`

Determines if a date counts towards weekend / special-date scoring.

- Accepts either a `date` object or a `YYYY-MM-DD` string.
- Returns `True` if:
  - The ISO weekday is **Saturday (6)** or **Sunday (7)**, OR
  - The date string is present in `special_dates_set`.
- Returns `False` otherwise.

### 3c. `get_staff_users(cursor)`

- Queries the `users` table for `role = 'staff'`, ordered by `seniority ASC, id ASC`.
- Returns a list of `{'id': int, 'name': str}`.

---

## 4. `load_state_for_scheduler(start_date=None)`

Loads all data the scheduler needs from the database into a single dict.

### Steps:
1. Ensures the `scheduler_state` table exists (creates it if not).
2. Fetches **employees** via `get_staff_users`.
3. Fetches **duties** from the `duties` table.
4. Fetches the full **schedule** from the `schedule` table (converts dates to strings).
5. Fetches **unavailability** records (converts dates to strings).
6. Fetches **rotation_queues** and **next_round_queues** from `scheduler_state`.
7. Fetches **special_dates** from the `special_dates` table.
8. If `start_date` is provided, fetches **user preferences** for the corresponding month from `user_preferences` (specifically the `prefer_double_sk` flag).

### Returns:
```python
{
    "employees": [...],
    "service_config": {
        "duties": [...],
        "special_dates": [...],
        "rotation_queues": {...},
        "next_round_queues": {...}
    },
    "schedule": [...],
    "unavailability": [...],
    "preferences": {user_id: True, ...}
}
```

---

## 5. `calculate_db_balance(start_str=None, end_str=None)`

Calculates score / balance statistics for the **frontend Balance tab**. Mirrors the scheduler's scoring logic so numbers are consistent.

### Parameters:
- `start_str`, `end_str`: optional, format `YYYY-MM`. If omitted, considers all dates.

### Stat Structure (per employee):
```python
{
    'name': str,
    'total': int,            # raw duty score
    'effective_total': int,  # total + handicaps
    'sk_score': int,         # weekend/special-date score
    'duty_counts': {duty_id: int, ...},
    '_seen_weeks': set()     # internal, removed before return
}
```

### Step A — Base Handicaps
For every employee, for every non-off-balance duty, reads the `handicaps` value from each shift config entry and adds it to `effective_total`.

### Step B — Process Schedule

#### Logic A: Weekly Duties
- **Counter**: Counts unique ISO weeks via `_seen_weeks` set. Each week is counted once per duty, regardless of how many individual days fall in the period.
- **Score**: Only adds to `total` and `effective_total` on **scoreable days** (Sat/Sun/Special). Off-balance weekly duties are skipped.
- After processing, `continue` (skips Logic B).

#### Logic B: Daily Duties
1. **Counter**: Increments `duty_counts[duty_id]` by 1 for every schedule entry.
2. **Off-Balance Check**: If the duty is `is_off_balance`, skip scoring.
3. **Protected Default Logic**: If the shift is `is_within_hours` AND the employee is the `default_employee_id`, skip scoring on **non-scoreable** days (M–F that are not special dates). This means the default owner is only scored on weekends/special dates.
4. **Add Score**: Increments `total` and `effective_total` by 1.
5. **SK Score**: If the duty is NOT `is_special` and NOT `is_off_balance` and it's a **scoreable day**, increments `sk_score`. IMPORTANT NOTE TO CHECK: **scoreable days** of weekly duties are in fact counted in the sk_score.

### Cleanup
- Removes the `_seen_weeks` set from each stat entry.
- Returns a list of stat dicts.

---

## 6. `run_auto_scheduler_logic(db, start_date, end_date)`

The main scheduling algorithm. Takes the pre-loaded `db` dict and a date range.

### Setup
- Extracts employees, duties, special dates, schedule, history, unavailability, rotation queues, and preferences.
- **Schedule vs. History**: entries within `[start_date, end_date]` that are `manually_locked` are kept in `schedule`. All other entries (outside the range) go to `history`. Non-locked entries within the range are **discarded** (they will be regenerated).
- Normalizes duty `shifts_per_day` and `shift_config` defaults.

### Internal Helpers

#### `is_user_busy(eid, check_date, current_schedule, ignore_yesterday=False)`
Checks if an employee is busy on a given date by scanning `current_schedule + history`:
- **Only considers normal and weekly duties** — off-balance and special duties are **ignored**.
- Returns `"Εργάζεται"` if the employee has a (normal/weekly) duty on `check_date`.
- Returns `"Εργάστηκε Χθες"` if the employee worked the **previous day** (unless `ignore_yesterday=True`).
- Returns `"Εργάζεται Αύριο"` if the employee has a duty on the **next day**.
- Returns `False` if available.

This enforces the **1-0-1 rest rule**: no back-to-back duty days (for normal/weekly duties only).

> **Note**: Off-balance and special duties do NOT block an employee from being assigned. An employee can work an off-balance or special duty on an adjacent day without triggering the busy check.

#### `get_q(key, excluded_ids=[])`
Retrieves the rotation queue for a given key:
1. Loads `rot_q[key]` (current queue) and `nxt_q[key]` (next-round queue).
2. Filters out invalid / excluded employee IDs.
3. Adds any missing employees to the current queue.
4. If the current queue is empty, promotes the next-round queue.
5. Updates `rot_q` and `nxt_q` in place.
6. Returns `(current_queue, next_round_queue)`.

#### `rotate_assigned_user(key, user_id)`
After assigning a user from the rotation queue:
- Removes them from the current queue (`rot_q`).
- Appends them to the next-round queue (`nxt_q`).

---

### Phase 0: Work-Hours Assignments

Assigns shifts marked as `is_within_hours` (i.e. duties that fall within normal working hours).

**For each day** in the range, **for each work-hour slot**:
1. Skip if the duty or shift is outside its `active_range`.
2. Skip if already assigned (locked).
3. For weekly duties, skip Sundays outside the `sunday_active_range`.
4. Determine if a **cover** is needed:
   - No `default_employee_id` is configured, OR
   - The default employee is unavailable or busy, OR
   - The day is a **scoreable day** AND the default employee is **excluded** (disabled in Αναθέσεις tab).
5. If no cover needed → assign the default employee.
6. If cover needed → pick from the rotation queue (`cover_{duty_id}_{shift_idx}`), choosing the first available candidate. All employees in the `excluded_ids` list are **fully excluded** from the rotation queue (they cannot be picked as cover on any day).
7. Log a warning if no one is available.

> **Key distinction**: The `default_employee_id` is **always** assigned on weekdays (non-scoreable days), even if they are disabled in the Αναθέσεις tab. Being "enabled" (not excluded) in Αναθέσεις means the default employee can **also** cover scoreable days (Sat/Sun/Special). All **other** employees, when excluded, are completely removed from the rotation queue and cannot be assigned on any day.

---

### Phase 1: Weekly Duty Assignments

Assigns weekly duties (non-special, non-work-hours) one week at a time.

**For each weekly duty, for each shift**:
1. Calculate the week boundaries (`w_start` to `w_end`).
2. **Continuity Check**: If the week starts before `start_date`, look at the schedule history to find who was assigned the day before `start_date`. Assign the same person to maintain continuity.
3. If no continuity match, pick from the rotation queue (`weekly_{duty_id}_sh_{shift_idx}`).
4. Assign the chosen employee to **every day** in the week (Mon–Sun), skipping Sundays if outside `sunday_active_range`, and skipping already-assigned slots.
5. Log a warning if no one is available.

---

### Phase 2: Daily Duty Assignments

Assigns daily (non-weekly, non-special, non-work-hours) duties.

**For each day**:
1. Collect all unassigned slots for active daily duties.
2. **Shuffle** the slots randomly to avoid ordering bias.
3. For each slot, pick from the rotation queue (`normal_{duty_id}_sh_{shift_idx}`), choosing the first candidate who is not unavailable and not busy.
4. Assign and rotate.
5. Log a warning if no one is available.

---

### Balancing Logic (Phases 3 & 4)

Uses a shared balancing engine (`run_balance`) that runs twice:
1. **Phase 3**: Balances **normal duties** (not off-balance, not special).
2. **Phase 4**: Balances **off-balance duties** (off-balance, not special).

#### `get_detailed_scores(target_duties)`
Calculates per-employee scores for a set of duty IDs:
- **Excludes employees** who are in the `excluded_ids` of **every** shift of **every** target duty (globally excluded). These employees don't appear in the score dict at all.
- Adds **handicap** offsets from shift configs (for non-excluded employees only).
- Iterates over `history + schedule` for the target duties.
- **Lookback window**: from 2 months before `start_date` to `end_date`.
- **Weekly duty** entries only count on scoreable days.
- **Work-hours shifts** assigned to the default employee only count on scoreable days.
- Returns `{employee_id: score}` (excluded employees are omitted).

#### `run_balance(target, label)`
Iteratively moves shifts from over-assigned employees to under-assigned ones:
1. Calculate scores.
2. Find the employee with the **most** shifts (`max`) and the **least** (`min`).
3. If the difference is ≤ 1, stop — balanced.
4. Identify **potential donors** (anyone with a score > min + 1), starting from the highest.
5. For each donor's unlocked shifts (in the current month, shuffled):
   - Skip if it's a work-hours default shift on a non-scoreable day.
   - Skip if it's a weekly duty.
   - Find a valid **receiver** (anyone with score < donor − 1) who is not excluded, not unavailable, and not busy.
   - Reassign the shift.
6. If no swap is possible for 3+ consecutive iterations (**stagnation**), log diagnostic reasons and stop.
7. Maximum 500 iterations.

---

### Phase 5: SK (Weekend/Special Date) Balancing

Balances the number of **scoreable-day** (weekend + special date) duties across employees over a **6-month rolling window** (current month + 5 months back).

#### SK Score Calculation
For every entry in `history + schedule` within the window:
- Skip entries before the window start.
- Skip duties that are `is_special` or `is_off_balance`.
- If the entry is on a **scoreable day** → add 1 to the employee's SK score.

> **Note**: Weekly duties ARE included in the SK score (they are not filtered out). This is intentional — weekly duties on weekends count towards weekend fairness.

#### SK Swap Logic
Up to 200 iterations:
1. Calculate SK scores.
2. SK scores are initialized only for employees who participate in **at least one shift** of normal duties (employees excluded from ALL normal-duty shifts via `excluded_ids` are removed from SK scoring entirely).
3. If the entry is on a **scoreable day** → add 1 to the employee's SK score (only if they are in the score dict).
4. For each over-assigned employee (`max_id`) and under-assigned employee (`min_id`):
   - Find **max_we**: max_id's shifts on **scoreable days** (not locked, not weekly/special/off-balance).
   - Find **min_wd**: min_id's shifts on **non-scoreable days** (not locked, not weekly/special/off-balance).
   - Before swapping, verify that `min_id` is **not excluded** from max_id's specific shift, and `max_id` is **not excluded** from min_id's specific shift (`excluded_ids` per-shift check).
   - Try to **swap** a scoreable-day shift of max_id with a non-scoreable-day shift of min_id.
   - Only swap if neither employee is unavailable or busy on the swapped dates.
   - Try **all possible max/min pairs** before giving up.
5. If no swap is possible across all pairs, log diagnostic info (available SK shifts, available weekday shifts) and stop.

> **Key constraint**: Weekly, special, and off-balance duties are **never swapped** during SK balancing. They are included in the score but protected from being moved.
>
> **Diagnostics**: When no swap is found, the log shows the employee names, their SK scores, and how many swappable shifts each has, to help debug the issue.

---

### Phase 6: Double Duty Optimization

For employees who have opted into `prefer_double_sk` (via user preferences):
- Tries to consolidate their two weekend shifts into a **consecutive Sat-Sun** pair.
- Only affects non-weekly, non-special, non-off-balance duties on weekends.

#### Logic:
1. Find the user's 2 weekend shifts. If they don't have exactly 2, skip.
2. If they're already consecutive, skip.
3. Try to find a swappable shift on the **adjacent day** (Saturday's Sunday or Sunday's Saturday).
4. Swap the user's distant weekend shift with the other employee's adjacent shift.
5. Both employees must be available (not unavailable, not busy) on the swapped dates.

---

### Return Value

```python
return schedule, {
    "rotation_queues": rot_q,
    "next_round_queues": nxt_q,
    "logs": logs
}
```

- `schedule`: the final list of schedule entries.
- `rotation_queues` / `next_round_queues`: updated queue state to persist.
- `logs`: list of log messages generated during the run.

---

## Glossary

| Term | Meaning |
|---|---|
| **Scoreable Day** | Saturday, Sunday, or a date in the `special_dates` table |
| **SK Score** | Count of duties on scoreable days (weekend/special) |
| **Handicap** | A static offset added to an employee's `effective_total` to pre-bias balancing |
| **Off-Balance** | A duty flag; these duties are balanced separately and excluded from the main balance |
| **Weekly Duty** | A duty assigned once per week to the same person (all 7 days) |
| **Work-Hours** | A shift marked `is_within_hours`; has a `default_employee_id` who covers weekdays without scoring. The default employee is **always** assigned on weekdays even if excluded in Αναθέσεις; exclusion only affects scoreable days |
| **Rotation Queue** | A FIFO queue that ensures fair round-robin assignment. `excluded_ids` fully removes non-default employees from the queue on all days |
| **1-0-1 Rule** | No employee works two consecutive days of normal/weekly duties (enforced by `is_user_busy`). Off-balance and special duties are ignored |
| **Protected Default** | The default employee for a work-hours shift is always assigned on weekdays (not scored). When enabled in Αναθέσεις, they also cover scoreable days. When disabled, scoreable days get a cover from the rotation queue |
| **Special Duty** | A duty with `is_special` flag; excluded from all balancing phases |
| **Manually Locked** | A schedule entry that cannot be moved or deleted by the scheduler |
| **Stagnation** | When the balancer cannot make progress for 3+ iterations; it logs reasons and stops |
| **Double Duty** | Consolidating weekend shifts to be on consecutive Sat-Sun for employees who prefer it |
