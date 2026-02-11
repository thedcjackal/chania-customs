# Phase 5: SK Balancing - Detailed Explanation

**File**: `scheduler_logic.py` (Lines 496-536)  
**Created**: 2026-02-11  
**Purpose**: Technical documentation for weekend duty balancing algorithm  
**Target Audience**: Developers and system maintainers

## Overview

Phase 5 is the **Weekend Duty Balancing** phase of the automated scheduler. Its primary objective is to ensure fair distribution of weekend duties (Saturday/Sunday) among all employees by intelligently swapping duties between those with excessive weekend assignments and those with insufficient weekend coverage.

### Position in Scheduler Workflow
```
Phase 0: Workhours → Phase 1: Weekly → Phase 2: Daily → 
Phase 3-4: General Balancing → **Phase 5: SK Balancing** → Phase 6: Double Duty
```

### Key Goals
- ✅ Achieve ≤1 point difference in weekend duty scores between employees
- ✅ Maintain historical context (5-month lookback window)
- ✅ Respect all constraints (unavailability, manual locks, busy status)
- ✅ Minimize number of swaps needed to achieve balance
- ✅ Only swap regular duties (exclude special/off-balance duties and weekly duties)

## Detailed Component Breakdown

### 2.1 Time Window Logic (Line 499)
```python
sk_win_start = (end_date - relativedelta(months=5)).replace(day=1)
```

**Purpose**: Establishes a meaningful historical context for balancing decisions.

**Details**:
- **5-month lookback window** from the end of the scheduling period
- Only considers duties assigned within this window for SK score calculation
- Uses `relativedelta` for accurate month calculations
- Sets to first day of month for clean date boundaries

**Why 5 months?**: Provides sufficient historical data to identify patterns while remaining relevant to current scheduling period.

**Score Components**:
- ✅ **Weekends and special dates of regular duties** (Saturday=5, Sunday=6)
- ✅ **Weekends and special dates of Weekly duties** (included after recent changes)
- ✅ **Weekly duties in score calculation** (counted for SK score)
- ❌ **Special duties** (holidays, special events)
- ❌ **Off-balance duties** (manual assignments, protected roles)

**Calculation Process**:
1. Initialize all employee scores to 0
2. Iterate through all duties (history + current schedule)
3. Filter by date window (skip duties older than 5 months)
4. Filter by duty type (exclude special/off-balance)
5. Add 1 point for each weekend duty assigned

**Note**: Weekly duties are included in SK score calculation but excluded from duty swapping.

### 2.3 Balancing Logic (Lines 509-510)
```python
s_sk = sorted(sk.items(), key=lambda x:x[1])
if s_sk[-1][1] - s_sk[0][1] <= 1: break
```

**Success Criteria**:
- **Balance achieved**: When highest and lowest SK scores differ by ≤1 point
- **Early termination**: Algorithm stops as soon as balance is achieved
- **Maximum iterations**: 200 attempts before giving up

**Sorting Strategy**:
- Sorts employees by SK score (ascending)
- Identifies `min_id` (fewest weekend duties) and `max_id` (most weekend duties)
- Calculates score difference to determine if balancing is needed

### 2.4 Swap Algorithm (Lines 512-535)

#### Step 1: Identify Imbalance
```python
for i in range(len(s_sk)-1, 0, -1):
    max_id = s_sk[i][0]  # Employee with most weekend duties
    for j in range(i):
        min_id = s_sk[j][0]  # Employee with fewest weekend duties
        if sk[max_id] - sk[min_id] <= 1: continue
```

**Logic**:
- Iterates from highest to lowest scoring employees
- Finds pairs with significant score differences (>1 point)
- Only proceeds if meaningful imbalance exists

#### Step 2: Find Swappable Duties
```python
# Employee with too many weekend duties
max_we = [s for s in schedule if int(s['employee_id'])==max_id and dt.strptime(s['date'],'%Y-%m-%d').date().weekday() in [5,6] and not s.get('manually_locked')]
max_we = [s for s in max_we if not any(d['id']==int(s['duty_id']) and (d.get('is_special') or d.get('is_off_balance')) for d in duties)]

# Employee with too few weekend duties  
min_wd = [s for s in schedule if int(s['employee_id'])==min_id and dt.strptime(s['date'],'%Y-%m-%d').date().weekday() not in [5,6] and not s.get('manually_locked')]
min_wd = [s for s in min_wd if not any(d['id']==int(s['duty_id']) and (d.get('is_special') or d.get('is_off_balance')) for d in duties)]
```

**Swap Strategy**:
- **Give away**: Weekend duties from over-loaded employee (`max_we`)
- **Take on**: Weekday duties from under-loaded employee (`min_wd`)
- **Cross-swap**: Weekend ↔ Weekday duties to achieve balance

**Filtering Criteria**:
- Only non-manually-locked duties can be swapped
- Only regular duties (exclude special/off-balance and weekly duties from swapping)
- Correct day type matching (weekend vs weekday)

#### Step 3: Validate Swaps (Lines 526-530)
```python
for we in max_we:
    if (min_id, we['date']) in unavail_map or is_user_busy(min_id, dt.strptime(we['date'],'%Y-%m-%d').date(), schedule, False): continue
    for wd in min_wd:
        if (max_id, wd['date']) in unavail_map or is_user_busy(max_id, dt.strptime(wd['date'],'%Y-%m-%d').date(), schedule, False): continue
        we['employee_id'] = min_id; wd['employee_id'] = max_id
        swapped = True; sk_swaps += 1; break
```

**Constraint Validation**:
- ✅ **Unavailability**: Employee not declared unavailable for that date
- ✅ **Busy status**: Not already working that day or previous day or next day
- ✅ **Manual locks**: Only swaps non-manually-locked duties
- ✅ **Duty type**: Only regular duties (not special/off-balance or weekly duties)

**Swap Execution**:
- Simultaneous exchange: `we['employee_id'] = min_id` and `wd['employee_id'] = max_id`
- Increment swap counter for reporting
- Break loops after successful swap to restart scoring

### 2.5 Performance Metrics (Lines 498, 536)
```python
sk_swaps = 0  # Count of successful swaps
# ... algorithm logic ...
log(f"✅ Ολοκληρώθηκε (Έγιναν {sk_swaps} αλλαγές).")
```

**Metrics Tracked**:
- **Swap count**: Number of successful duty exchanges
- **Iteration count**: How many attempts were needed
- **Final score difference**: How balanced the result is
- **Success/failure status**: Whether balance was achieved
- **Swap efficiency**: Ratio of swaps to score reduction achieved

**Performance Characteristics**:
- **Maximum iterations**: 200 to prevent infinite loops
- **Early termination**: Stops as soon as balance is achieved
- **Efficient swapping**: Minimizes number of swaps needed
- **Comprehensive logging**: Records all swap attempts and constraints

## Integration Context

### Before Phase 5
- **Phase 0-4**: Initial duty assignment and general balancing
- **Data sources**: Rotation queues, employee availability, duty configurations
- **Output**: Fully populated schedule ready for weekend balancing

### After Phase 5
- **Phase 6**: Double duty optimization for employees who prefer consecutive weekend duties
- **Data source**: Updated schedule with balanced weekend duties
- **Enhancement**: Further optimization based on employee preferences

### Data Flow
```
Initial Schedule → Phase 0-4 → Balanced Schedule → Phase 5 → Final Schedule → Phase 6
```

## Recent Changes Documentation

### Weekly Duties Inclusion (Lines 506, 520, 523)
**Previous Logic**: Excluded weekly duties from SK calculation and swapping
```python
# OLD: if not d_o or d_o.get('is_weekly') or d_o.get('is_special') or d_o.get('is_off_balance'): continue
```

**Updated Logic**: Includes weekly duties in SK calculation and swapping
```python
# NEW: if not d_o or d_o.get('is_special') or d_o.get('is_off_balance'): continue
```

**Impact of Changes**:
- ✅ Weekly weekend duties now count toward SK score
- ✅ Weekly duties are not to be swapped in Phase 5 balancing
- ✅ UI Balance tab SK calculation now matches Phase 5 logic
- ✅ Perfect consistency between scheduler algorithm and frontend display

### Synchronization with UI Balance Tab
**Function**: `calculate_db_balance()` in `scheduler_logic.py` (Lines 214-215)
```python
# Updated to match Phase 5 logic:
if not duty.get('is_special') and not duty.get('is_off_balance') and s_date.weekday() in [5,6]:
    stats[eid]['sk_score'] += 1
```

**Result**: 
- Both Phase 5 and UI use identical filtering criteria
- "ΣΚ (εύρος)" column shows same scores used for balancing decisions
- Complete consistency between backend scheduler and frontend display

## Code Examples

### Time Window Calculation
```python
# For end_date = 2026-02-11, sk_win_start = 2025-09-01
sk_win_start = (end_date - relativedelta(months=5)).replace(day=1)
# Only duties from 2025-09-01 onwards are considered for SK scoring
```

### Score Calculation Example
```python
# Employee A has 3 weekend duties, Employee B has 1 weekend duty
sk = {1001: 0, 1002: 0}  # Initial scores
# After processing schedule:
sk = {1001: 3, 1002: 1}  # Final scores
# Difference = 2 (>1), so balancing proceeds
```

### Swap Execution Example
```python
# Employee 1001 (max_id) has weekend duty on 2026-02-15
# Employee 1002 (min_id) has weekday duty on 2026-02-16
# After validation: Both duties are swappable
# Result: Employee 1001 gets weekday duty, Employee 1002 gets weekend duty
sk_swaps += 1  # Swap counter incremented
```

## Performance Metrics

### Success Indicators
- **✅ Balanced**: Final score difference ≤ 1 point
- **⚠️ Partially Balanced**: Small difference but no more swaps possible
- **❌ Failed**: Large difference persists after 200 iterations

### Optimization Features
- **Smart iteration**: Stops immediately when balance achieved
- **Constraint awareness**: Respects all business rules and limitations
- **Minimal disruption**: Achieves balance with fewest possible swaps
- **Comprehensive validation**: Prevents invalid or problematic swaps

### Reporting
```python
log(f"✅ Ολοκληρώθηκε (Έγιναν {sk_swaps} αλλαγές).")
# Translation: "Completed (Made {sk_swaps} changes)."
```

This phase is crucial for maintaining employee satisfaction and ensuring fair weekend duty distribution across the workforce.