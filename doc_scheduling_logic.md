# Scheduling Logic — Complete Documentation

This document describes **exactly** what `scheduler_logic.py` does, function by function, phase by phase.

---

## 1. Imports & Setup

```python
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

- **Input**: a `date` object and a `range_config` dict with `start` and `end` keys.
- If `range_config` is empty / missing keys → returns `True` (always active).
- Supports wrap-around ranges (e.g. `01-11` to `31-03`).
- Returns `True`/`False`.

### 3b. `is_scoreable_day(d_date, special_dates_set)`

Determines if a date counts towards weekend / special-date scoring.

- Accepts either a `date` object or a `YYYY-MM-DD` string.
- Returns `True` if:
  - The ISO weekday is **Saturday (6)** or **Sunday (7)**, OR
  - The date string is present in `special_dates_set`, OR
  - The recurring version of the date (`2000-MM-DD`) is present in `special_dates_set`.
- Returns `False` otherwise.

### 3c. `get_staff_users(cursor)`

- Queries the `users` table for `role = 'staff'`, ordered by `seniority ASC, id ASC`.
- Returns a list of `{'id': int, 'name': str}`.

---

## 4. `load_state_for_scheduler(start_date=None)`

Loads all data the scheduler needs from the database into a single dict.

### Steps:
1. Ensures `scheduler_state` and `user_preferences` tables exist.
2. Fetches **employees**, **duties**, **schedule** (within range), **unavailability**, **special_dates**.
3. Fetches **rotation_queues** and **next_round_queues**.
   - **Unified SK Queue**: Uses `sk_all` for ALL weekend/special shifts (Normal & Cover).
   - **Double Population**: The `sk_all` queue is populated by appending the full list of employees **twice** (non-adjacent: `[A, B, C... A, B, C]`).
4. Fetches **user preferences** (specifically `prefer_double_sk`).

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

Calculates score / balance statistics for the **frontend Balance tab**.

### Stat Structure:
```python
{
    'name': str,
    'total': int,            # raw duty score
    'effective_total': int,  # total + handicaps
    'sk_score': int,         # weekend/special-date score
    'special_normal': int,   # count of special dates for normal duties
    'special_offbalance': int, # count of special dates for off-balance duties
    'duty_counts': {...}
}
```

### Logic:
1. **Handicaps**: Adds static offsets from shift config to `effective_total`.
2. **Weekly Duties**:
   - Counts unique weeks.
   - Adds to `sk_score` if on a scoreable day (Sat/Sun/Special).
   - Only scores `total` on scoreable days.
3. **Daily Duties**:
   - Skips `is_off_balance` duties for standard scoring (handled separately).
   - **Protected Default**: Default employees for work-hours duties are NOT scored on weekdays (M-F non-special).
   - Adds 1 to `total` and `effective_total`.
   - Adds 1 to `sk_score` if on a scoreable day.
4. **Special Counts**: Tracks strictly special dates (holidays) separately for Normal vs. Off-Balance duties.

---

## 6. `run_auto_scheduler_logic(db, start_date, end_date)`

The main scheduling algorithm.

### Phase 0: Work-Hours Assignments

Assigns shifts marked as `is_within_hours`.

1. **Default Employee**: Tries to assign the configured `default_employee_id`.
2. **Cover Needed**: If default is unavailable, busy, or excluded on a scoreable day.
3. **Fallback**: Picks from rotation queue.
   - **Scoreable Day (Sat/Sun/Special)**: Uses unified `sk_all` queue.
   - **Weekdays**: Uses `cover_{duty_id}_{sh}`.
4. **Double SK Logic (Sundays)**:
   - If today is **Sunday**: Check if the user assigned to this duty on **Saturday** has `prefer_double_sk = True`.
   - **Force Double**: If Sat was Normal (not Special) and Sun is Normal -> **Force Assign** the same user to Sunday (ignoring "busy yesterday or tomorrow" rule).
      - **Double Duty Check**: Prioritizes candidates with **>= 2 instances** in the `sk_all` queue (along with preference) to facilitate double duty.
   - **Avoid Burnout**: If Sat was Special (Holiday), do NOT force assign but pick an employee who doesn't have a double SK duty preference if possible.

### Phase 1: Weekly Duty Assignments

Assigns weekly duties (non-special, non-work-hours, **non-off-balance**).

1.   - **Continuity Check**: If a week assignment starts mid-month (e.g., month starts on Wednesday), it looks back to the **previous day** (end of last month) to see who was assigned.
     - If found: Extends that user's assignment to the partial first week.
     - If not found: Starts fresh assignment from the first full week.
   - **Full Weeks**: For standard weeks, it checks if the previous week was assigned to the same person (implied continuity, though rare for weekly duties unless forced).assignment.
2. **Rotation**: Picks from queue `weekly_{duty_id}_{sh}`.
3. Assigns for the full week (Mon-Sun), respecting `sunday_active_range`.

### Phase 2: Daily Duty Assignments

Assigns daily duties (non-weekly, non-special, non-work-hours, **non-off-balance**).

1. **Shuffle**: Randomizes slot order for fairness.
2. **Double SK Logic (Sundays)**:
   - If today is **Sunday**: Check if the user assigned to this duty on **Saturday** has `prefer_double_sk = True`.
   - **Force Double**: If Sat was Normal (not Special) and Sun is Normal -> **Force Assign** the same user to Sunday (ignoring "busy yesterday  or tomorrow" rule).
   - **Avoid Burnout**: If Sat was Special (Holiday) **OR** if Sun is Special (Holiday), do NOT force assign. We treat Holidays as standalone shifts to avoid burnout.
4. **Selection**: Picks from rotation queue.
   - **Sat/Sun/Special**: Uses unified `sk_all` queue.
   - **Weekdays**: Uses `normal_{duty_id}_{sh}`.
   - **Double Duty Check**: Prioritizes candidates with **>= 2 instances** in the `sk_all` queue (along with preference) to facilitate double duty.
   

### Phase 5: Special-Date Balancing

**Goal**: Equalize shifts on strictly **Special Dates** (Holidays). Runs twice: for Normal duties, then Off-Balance duties.

- **Threshold**: Difference > 1.
- **Swaps**:
  1. **Daily**: Swap a **Special Shift** (Richest) <-> **Normal Weekend Shift** (Poorest).But tries every possible combination and do not stop until balance is achieved or the same failure happens twice in a row.If the same failure happens twice in a row, make a switch with another rich employee and then try again. This balances holidays without disrupting the total "Weekend/Holiday" count (SK score) too much.
     - Fallback: Swap Special <-> Normal Weekday.
  2. **Weekly**: Swap an **Entire Week**. Requires the Richest's week to have *more* special days than the Poorest's week.

### Phase 6: SK (Weekend) Balancing

**Goal**: Equalize **SK Score** (shifts on Sat/Sun/Special) over a 6-month window.

- **Threshold**: Difference > **2** (Loosened to allow Double Duty users to hold extra weekends).
- **Target**: Only swaps **Normal** duties. Weekly/Special/Off-Balance are protected.
- **Atomic Swaps**:
  - If the Donor (Richest) has a **Double Duty Pair** (Sat+Sun assigned to same duty/shift):
  - Tries to swap **BOTH** shifts together to a Receiver who has 2 available Weekday shifts.
  - This preserves the "Full Weekend" block.
  **Verbose Atomic Swap Logging**: Logs every atomic swap attempt, including the specific dates and duties being swapped, to help diagnostics.
- **Single Swaps**: Fallback standard swap (Weekend Shift <-> Weekday Shift).

- **Loop**: Uses `continue` on failure to ensure all pairs are tried.
- **Stagnation Fallback 1 (Relaxed Diff)**: If balancing stagnates, it relaxes the difference check (`>1` instead of `>2`) to allow swapping from **Max-1** employees.
- **Stagnation Fallback 2 (Weekly Swap)**: If granular swaps fail, it attempts to swap an **entire week** of a Weekly Duty from the Max employee to a Min employee (if eligible and free). This is a "heavy" move to break stagnation.
- **Verbose Stagnation Logging**: Log top 10 failure reasons.

### Phase 7: Off-Balance Duties

Handles duties marked `is_off_balance` (e.g., extra help, standout shifts).

1. **Assign Weekly**: Similar to Phase 1 but for off-balance.
2. **Assign Daily**: Similar to Phase 2 but for off-balance (Double Duty Logic is **NOT** applied).
3. **Balance**: Runs `run_balance` specifically for off-balance duties (Total Count balancing).

### Phase 8: Final Weekday Balancing

**Goal**: Correct total shift counts using **only Weekday (Mon-Fri) non-Special shifts**.
- Runs at the very end of generation.
- Ensures that total shift counts are balanced without disturbing the delicate Weekend/Holiday balance achieved in previous phases.

### Balancing Engine (`run_balance`)

Used for Phase 3 (Normal Total), Phase 4 (Off-Balance Total), Phase 7 (Off-Balance Final), and **Phase 8 (Final Weekday)**.
- **Goal**: Equalize total shift counts.
- **Mechanism**: Swap Any Shift (Donor) <-> Any Shift (Receiver).
- **Atomic Support**: Also supports Atomic Double Swaps for total balancing.
- **Weekday Mode**: Can be restricted to only swap Weekday non-Special shifts (used in Phase 8).

---

## Glossary

| Term | Meaning |
|---|---|
| **Scoreable Day** | Sat, Sun, or Special Date. |
| **SK Score** | Count of duties on Scoreable Days. |
| **Double SK** | User preference to work full weekends (Sat+Sun). |
| **Atomic Swap** | Moving Sat+Sun together to maintain Double Duty blocks. |
| **Off-Balance** | Duties excluded from standard Phase 1/2 assignment and Phase 3/5 balancing. Handled in Phase 7. |
| **Work-Hours** | Shifts with a `default_employee_id`. |

### Queue Persistence (New)
To ensure monthly continuity and reproducibility:
1.  **Storage**: A new table `scheduler_history_state` stores queue states (`rotation_queues`, `next_round_queues`) keyed by **Month** (e.g., `2024-02-01`).
2.  **Saving**: When a schedule is generated for a month (e.g., Feb), the **final** state of the queues is saved with that month's date (`2024-02-01`).
3.  **Loading**: When generating a schedule for the *next* month (e.g., Mar), the scheduler looks for the saved state of the **previous** month (`2024-02-01`).
    -   **If found**: It loads those queues as the starting point.
    -   **If not found**: It initializes queues from scratch (based on seniority).
4.  **Benefit**: Re-running a month yields consistent results (same starting seed), and the rotation chain is preserved across months.
