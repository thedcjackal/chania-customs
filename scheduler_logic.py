import os
import json
import random
import psycopg2
import logging
from datetime import datetime as dt, timedelta
from dateutil.relativedelta import relativedelta
from psycopg2.extras import RealDictCursor

# Setup logger for this module
logger = logging.getLogger("customs_api")

# ==========================================
# DATABASE CONNECTION (Duplicated for standalone access)
# ==========================================
def get_db():
    url = os.environ.get('DATABASE_URL')
    if not url:
        # In a real scenario you might log error here, but following strict copy logic:
        return None
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    if "sslmode=" not in url:
        joiner = "&" if "?" in url else "?"
        url = f"{url}{joiner}sslmode=require"
    try:
        return psycopg2.connect(url)
    except Exception as e:
        print(f"DB Connection Failed in Scheduler: {e}")
        return None

# ==========================================
# SCHEDULER HELPER FUNCTIONS
# ==========================================

def is_in_period(date_obj, range_config):
    if not range_config or not range_config.get('start') or not range_config.get('end'): return True 
    try:
        y = date_obj.year
        s_str = str(range_config['start']).strip()
        e_str = str(range_config['end']).strip()
        
        # Handle YYYY-MM-DD
        if '-' in s_str and len(s_str.split('-')) == 3:
             start_date = dt.strptime(s_str, '%Y-%m-%d').date()
        else:
             # Assume DD/MM or DD-MM
             s_parts = s_str.replace('/','-').split('-')
             s_day, s_month = int(s_parts[0]), int(s_parts[1])
             start_date = dt(y, s_month, s_day).date()

        if '-' in e_str and len(e_str.split('-')) == 3:
             end_date = dt.strptime(e_str, '%Y-%m-%d').date()
        else:
             e_parts = e_str.replace('/','-').split('-')
             e_day, e_month = int(e_parts[0]), int(e_parts[1])
             end_date = dt(y, e_month, e_day).date()
             
        if start_date > end_date: return date_obj >= start_date or date_obj <= end_date
        else: return start_date <= date_obj <= end_date
    except: return True 

def is_scoreable_day(d_date, special_dates_set):
    if isinstance(d_date, str): d_date = dt.strptime(d_date, '%Y-%m-%d').date()
    _, _, iso_day = d_date.isocalendar()
    if iso_day in [6, 7]: return True
    if str(d_date) in special_dates_set: return True
    # Also check recurring dates stored with year 2000
    recurring_key = f"2000-{d_date.strftime('%m-%d')}"
    if recurring_key in special_dates_set: return True
    return False

def get_staff_users(cursor):
    # Updated: Ordered by seniority ASC (Least Senior First) as requested
    cursor.execute("SELECT id, name, surname, seniority FROM users WHERE role = 'staff' ORDER BY seniority ASC, id ASC")
    users = cursor.fetchall()
    return [{
        'id': int(u['id']), 
        'name': f"{u['name']} {u['surname'] or ''}".strip(),
        'real_name': u['name'],
        'surname': u['surname'] or ''
    } for u in users]

def load_state_for_scheduler(start_date=None, *args, **kwargs):
    conn = get_db()
    if not conn: return None
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    # --- AUTO-INIT: Ensure Scheduler State Tables Exist ---
    try:
        # Legacy single-row state (keep for backward compatibility or simple usage)
        cur.execute("CREATE TABLE IF NOT EXISTS scheduler_state (id SERIAL PRIMARY KEY, rotation_queues JSONB, next_round_queues JSONB)")
        cur.execute("INSERT INTO scheduler_state (id, rotation_queues, next_round_queues) VALUES (1, '{}', '{}') ON CONFLICT (id) DO NOTHING")
        
        # New History State Table
        cur.execute("CREATE TABLE IF NOT EXISTS scheduler_history_state (month DATE PRIMARY KEY, rotation_queues JSONB, next_round_queues JSONB)")
        
        conn.commit()
    except Exception as e:
        print(f"Error initializing table: {e}", flush=True)
        conn.rollback()

    employees = get_staff_users(cur)
    cur.execute("SELECT * FROM duties ORDER BY id")
    duties = cur.fetchall()
    cur.execute("SELECT * FROM schedule")
    schedule = cur.fetchall()
    for s in schedule: s['date'] = str(s['date'])
    cur.execute("SELECT * FROM unavailability")
    unavail = cur.fetchall()
    for u in unavail: u['date'] = str(u['date'])
    
    # --- LOAD STATE (PERSISTENCE LOGIC) ---
    rot_q = {}
    next_q = {}
    
    if start_date:
        # 1. Calculate Previous Month
        # start_date is expected to be e.g. 2024-03-01
        prev_month = (start_date - relativedelta(months=1)).replace(day=1)
        
        try:
            cur.execute("SELECT rotation_queues, next_round_queues FROM scheduler_history_state WHERE month = %s", (prev_month,))
            hist_state = cur.fetchone()
            
            if hist_state:
                rot_q = hist_state['rotation_queues'] if hist_state['rotation_queues'] else {}
                next_q = hist_state['next_round_queues'] if hist_state['next_round_queues'] else {}
                print(f"DEBUG: Loaded queue state from HISTORY for {prev_month}", flush=True)
            else:
                print(f"DEBUG: No history found for {prev_month}. Starting with FRESH queues (Seniority-based).", flush=True)
                # Fallback: Do NOT load from legacy 'scheduler_state' id=1, primarily use history chain.
                # If we wanted to fallback to legacy:
                # cur.execute("SELECT * FROM scheduler_state WHERE id = 1") ...
        except Exception as e:
            print(f"Error loading history state: {e}", flush=True)

    
    special_dates = []
    try:
        cur.execute("SELECT date FROM special_dates")
        rows = cur.fetchall()
        special_dates = [str(r['date']) for r in rows]
    except: pass
    
    preferences = {}
    preferences = {}
    if start_date:
        try:
            # Persistent preferences (Global)
            cur.execute("CREATE TABLE IF NOT EXISTS user_preferences (user_id INTEGER, prefer_double_sk BOOLEAN, PRIMARY KEY (user_id))")
            conn.commit()
            cur.execute("SELECT user_id FROM user_preferences WHERE prefer_double_sk = true")
            rows = cur.fetchall()
            for r in rows: preferences[int(r['user_id'])] = True
        except: pass

    conn.close()
    return { "employees": employees, "service_config": { "duties": duties, "special_dates": special_dates, "rotation_queues": rot_q, "next_round_queues": next_q }, "schedule": schedule, "unavailability": unavail, "preferences": preferences }

def calculate_db_balance(start_str=None, end_str=None):
    conn = get_db()
    if not conn: return []
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    cur.execute("SELECT * FROM duties")
    duties = cur.fetchall()
    employees = get_staff_users(cur)
    cur.execute("SELECT * FROM schedule")
    schedule = cur.fetchall()
    
    special_dates_set = set()
    try:
        cur.execute("SELECT date FROM special_dates")
        for r in cur.fetchall(): special_dates_set.add(str(r['date']))
    except: pass
    conn.close()
    
    # 1. Determine Date Range
    if start_str and end_str:
        view_start = dt.strptime(start_str, '%Y-%m').date().replace(day=1)
        end_dt = dt.strptime(end_str, '%Y-%m').date()
        view_end = (end_dt + relativedelta(months=1)) - timedelta(days=1)
    else:
        view_start = dt.min.date(); view_end = dt.max.date()

    # 2. Initialize Stats
    stats = {
        e['id']: {
            'name': e['name'], 
            'total': 0, 
            'effective_total': 0, 
            'sk_score': 0, 
            'duty_counts': {d['id']: 0 for d in duties},
            'special_date_counts': {d['id']: 0 for d in duties},
            '_seen_weeks': set() 
        } 
        for e in employees
    }
    
    # --- STEP A: APPLY BASE HANDICAPS (Static Offset) ---
    for e in employees:
        eid_str = str(e['id'])
        for d in duties:
            if d.get('is_off_balance'): continue 
            
            for conf in d.get('shift_config', []):
                val = int(conf.get('handicaps', {}).get(eid_str, 0))
                if val > 0:
                    stats[e['id']]['effective_total'] += val

    # Helper for strict special date check
    def check_special(d_date):
        if str(d_date) in special_dates_set: return True
        recurring_key = f"2000-{d_date.strftime('%m-%d')}"
        if recurring_key in special_dates_set: return True
        return False

    # --- STEP B: PROCESS SCHEDULE ---
    for s in schedule:
        eid = s['employee_id']
        if not eid or eid not in stats: continue
        
        try:
            s_date = dt.strptime(str(s['date']), '%Y-%m-%d').date()
            if s_date < view_start or s_date > view_end: continue
            
            duty = next((d for d in duties if d['id'] == s['duty_id']), None)
            if not duty: continue
            
            shift_idx = int(s.get('shift_index', 0))
            conf = duty['shift_config'][shift_idx] if duty.get('shift_config') and len(duty['shift_config']) > shift_idx else {}

            # --- LOGIC A: WEEKLY DUTIES ---
            if duty.get('is_weekly'):
                # 1. Update Counter (Count unique weeks for display)
                iso_year, iso_week, _ = s_date.isocalendar()
                week_key = f"{duty['id']}_{iso_year}_{iso_week}"
                
                if week_key not in stats[eid]['_seen_weeks']:
                    stats[eid]['duty_counts'][duty['id']] += 1
                    stats[eid]['_seen_weeks'].add(week_key)

                # 1b. Special-date counter (each individual strictly special day)
                if check_special(s_date):
                    stats[eid]['special_date_counts'][duty['id']] += 1

                # 2. Update Score (Only on Scoreable Days: Sat/Sun/Special)
                if not duty.get('is_off_balance'):
                    if is_scoreable_day(s_date, special_dates_set):
                        stats[eid]['total'] += 1
                        stats[eid]['effective_total'] += 1
                        # SK Score: weekly duties on scoreable days count
                        if not duty.get('is_special'):
                            stats[eid]['sk_score'] += 1
                
                continue # Done with Weekly

            # --- LOGIC B: DAILY DUTIES ---
            
            # Counter
            stats[eid]['duty_counts'][duty['id']] += 1

            # Special-date counter (each individual strictly special day)
            if check_special(s_date):
                stats[eid]['special_date_counts'][duty['id']] += 1
            
            # Checks for Score
            if duty.get('is_off_balance'): 
                continue
            
            # Protected Default Logic: Don't score M-F for default owner
            if conf.get('is_within_hours') and conf.get('default_employee_id') == eid:
                if not is_scoreable_day(s_date, special_dates_set):
                    continue

            # Add Score
            stats[eid]['total'] += 1
            stats[eid]['effective_total'] += 1 
            
            # SK Score (Weekends for Weekly and Daily duties)
            if not duty.get('is_special') and not duty.get('is_off_balance') and is_scoreable_day(s_date, special_dates_set):
                stats[eid]['sk_score'] += 1

        except: pass

    # 4. Clean up and compute combined special scores
    final_stats = []
    normal_ids = set(d['id'] for d in duties if not d.get('is_off_balance') and not d.get('is_special'))
    offbal_ids = set(d['id'] for d in duties if d.get('is_off_balance') and not d.get('is_special'))
    for s in stats.values():
        del s['_seen_weeks']
        s['special_normal'] = sum(v for k, v in s['special_date_counts'].items() if k in normal_ids)
        s['special_offbalance'] = sum(v for k, v in s['special_date_counts'].items() if k in offbal_ids)
        final_stats.append(s)

    return final_stats

# ==========================================
# 6. SCHEDULER ALGORITHM (TRANSLATED & CLEAN LOGS)
# ==========================================
def run_auto_scheduler_logic(db, start_date, end_date):
    logs = []
    
    def log(msg):
        timestamp = dt.now().strftime('%H:%M:%S.%f')[:-3]
        log_entry = f"[{timestamp}] {msg}"
        logs.append(log_entry)
        print(f"[SCHEDULER] {log_entry}", flush=True) 
    
    employees = [{'id': int(e['id']), 'name': e['name']} for e in db['employees']]
    emp_map = {e['id']: e['name'] for e in employees}
    double_duty_prefs = db.get('preferences', {})
    
    if not employees:
        log("❌ ΣΦΑΛΜΑ: Δεν βρέθηκαν υπάλληλοι.")
        return [], {"rotation_queues": {}, "next_round_queues": {}, "logs": logs}
    
    log(f"🏁 ΕΚΚΙΝΗΣΗ ΧΡΟΝΟΠΡΟΓΡΑΜΜΑΤΙΣΤΗ: {start_date.strftime('%Y-%m')}")
    log(f"ℹ️  Υπάλληλοι: {len(employees)}")
    log(f"ℹ️  Σειρά Εργαζομένων (Top 5): {[e['name'] for e in employees[:5]]}")
    log(f"ℹ️  Προτιμήσεις Διπλοβάρδιας: {len(double_duty_prefs)} άτομα")
    
    duties = db['service_config']['duties']
    special_dates_set = set(db['service_config'].get('special_dates', []))
    
    raw_schedule = db['schedule']; schedule = []; history = []
    
    locked_count = 0
    for s in raw_schedule:
        try:
            s_date = dt.strptime(s['date'], '%Y-%m-%d').date()
            if start_date <= s_date <= end_date:
                if s.get('manually_locked'): 
                    schedule.append(s)
                    locked_count += 1
            else: 
                history.append(s)
        except: pass
        
    log(f"🔒 Διατηρήθηκαν {locked_count} κλειδωμένες βάρδιες.")

    unavail_map = {(int(u['employee_id']), str(u['date'])) for u in db['unavailability']}
    rot_q = db['service_config']['rotation_queues']
    nxt_q = db['service_config']['next_round_queues']

    for d in duties:
        if d.get('shifts_per_day') is None: d['shifts_per_day'] = 1
        if d.get('shift_config') is None: d['shift_config'] = []
        while len(d['shift_config']) < d['shifts_per_day']: d['shift_config'].append({})

    # --- Helpers ---
    def is_user_busy(eid, check_date, current_schedule, ignore_yesterday=False, ignore_tomorrow=False):
        d_str = check_date.strftime('%Y-%m-%d')
        prev_str = (check_date - timedelta(days=1)).strftime('%Y-%m-%d')
        next_str = (check_date + timedelta(days=1)).strftime('%Y-%m-%d')
        for s in current_schedule + history:
            if int(s['employee_id']) == eid:
                # Only normal and weekly duties count — off-balance and special are ignored
                d_o = next((d for d in duties if d['id']==int(s['duty_id'])), None)
                if d_o and (d_o.get('is_off_balance') or d_o.get('is_special')): continue
                if s['date'] == d_str: return f"Εργάζεται σήμερα ({d_o.get('name', 'Unknown')})"
                if not ignore_yesterday and s['date'] == prev_str: return f"Εργάστηκε χθες ({d_o.get('name', 'Unknown')})"
                if not ignore_tomorrow and s['date'] == next_str: return f"Έχει βάρδια αύριο ({d_o.get('name', 'Unknown')})"
        return False

    def get_q(key, excluded_ids=[]):
        cq = rot_q.get(key, []); nq = nxt_q.get(key, [])
        valid_ids = set(e['id'] for e in employees)
        
        # New Logic: SK Queues
        is_sk_queue = key == "sk_all"
        
        # Log queue state before
        log(f"   🔢 [Queue {key}] Initial CQ: {[emp_map.get(x, x) for x in cq]}, NQ: {[emp_map.get(x, x) for x in nq]}")

        # HEALING: Universal Queue Normalization
        # - SK Queues: Target = 2 instances per employee (for Double Duty logic)
        # - Other Queues: Target = 1 instance per employee
        
        target_count = 2 if is_sk_queue else 1
        
        # 1. Prune Excess (> target_count)
        # Remove from END of combined queue (NQ first, then CQ)
        counts = {}
        for x in cq + nq:
            counts[x] = counts.get(x, 0) + 1
        
        for eid, c in counts.items():
            if c > target_count:
                excess = c - target_count
                log(f"   ✂️ [Queue {key}] Pruning {excess} excess instances of {emp_map.get(eid, eid)} (Target: {target_count})")
                for _ in range(excess):
                    if eid in nq:
                        idx = len(nq) - 1 - nq[::-1].index(eid)
                        nq.pop(idx)
                    elif eid in cq:
                        idx = len(cq) - 1 - cq[::-1].index(eid)
                        cq.pop(idx)
                        
        # 2. Add Missing (< target_count)
        all_instances = cq + nq
        valid_targets = [eid for eid in valid_ids if eid not in excluded_ids]
        to_add = []
        for eid in valid_targets:
            count = all_instances.count(eid)
            if count < target_count:
                needed = target_count - count
                to_add.extend([eid] * needed)
        
        if to_add:
             log(f"   🩹 [Queue {key}] Inflating Queue with missing instances (Target {target_count}): {[emp_map.get(x,x) for x in to_add]}")
             cq.extend(to_add)

        cq = [int(x) for x in cq if int(x) in valid_ids and int(x) not in excluded_ids]
        nq = [int(x) for x in nq if int(x) in valid_ids and int(x) not in excluded_ids]
        
        # Note: The previous logic that calculated 'known' and 'missing' sets is now redundant
        # because step #2 above ensures every valid employee has at least target_count instances.
        
        if not cq: 
            if nq: 
                log(f"   🆙 [Queue {key}] CQ empty. PROMOTING NQ -> CQ.")
                cq = [e['id'] for e in employees if e['id'] in nq]
                nq = [] 
            else: 
                # Re-populate from scratch
                log(f"   🔄 [Queue {key}] Empty. Repopulating full list.")
                
                # Determine source list based on queue type
                # Default: Least Senior First (employees is already sorted this way)
                source_employees = employees
                
                # Off-Balance Check: Sort by Surname ASC
                if key.startswith("off_") or key.startswith("weekly_off_"):
                     # Sort by surname, then name (Default is ASC)
                     source_employees = sorted(employees, key=lambda x: (x['surname'], x['real_name']))
                
                if is_sk_queue:
                    valid_all = [e['id'] for e in source_employees if e['id'] not in excluded_ids]
                    # Append Full List TWICE (non-adjacent)
                    cq = valid_all + valid_all
                else:
                    cq = [e['id'] for e in source_employees if e['id'] not in excluded_ids]
        
        rot_q[key] = cq; nxt_q[key] = nq
        return cq, nq

    def rotate_assigned_user(key, user_id):
        cq = rot_q.get(key, []); nq = nxt_q.get(key, [])
        cq = [int(x) for x in cq]; nq = [int(x) for x in nq]
        if user_id in cq: cq.remove(user_id); nq.append(user_id)
        elif user_id in nq: nq.remove(user_id); nq.append(user_id)
        rot_q[key] = cq; nxt_q[key] = nq

    # --- PHASE 0: Workhours ---
    log("▶️ Φάση 0: Ανάθεση Ωραρίου Γραφείου...")
    workhour_slots = []
    for duty in duties:
        if duty.get('is_special') or duty.get('is_weekly') or duty.get('is_off_balance'): continue
        for sh_idx in range(duty['shifts_per_day']):
            if duty['shift_config'][sh_idx].get('is_within_hours'): workhour_slots.append({'duty': duty, 'sh_idx': sh_idx, 'conf': duty['shift_config'][sh_idx]})
    
    curr = start_date
    while curr <= end_date:
        d_str = curr.strftime('%Y-%m-%d')
        for slot in workhour_slots:
            duty = slot['duty']; sh_idx = slot['sh_idx']; conf = slot['conf']
            if not is_in_period(curr, duty.get('active_range')) or not is_in_period(curr, conf.get('active_range')): continue
            if any(s['date']==d_str and int(s['duty_id'])==int(duty['id']) and int(s['shift_index'])==sh_idx for s in schedule): continue
            
            chosen_id = None
            default_id = conf.get('default_employee_id')
            default_excluded = default_id in [int(x) for x in conf.get('excluded_ids',[])]
            
            busy_reason_def = is_user_busy(default_id, curr, schedule, True) if default_id else "No Default"
            needs_cover = not default_id or (default_id, d_str) in unavail_map or busy_reason_def != False or (is_scoreable_day(curr, special_dates_set) and default_excluded)
            
            if not needs_cover: chosen_id = default_id
            else:
                if default_id:
                     log(f"      ⚠️ {d_str} {duty['name']}: Default {emp_map.get(default_id)} skipped. Busy: {busy_reason_def}, Unavail: {(default_id, d_str) in unavail_map}, Excl: {default_excluded}")

            if not chosen_id:
                # Use SK queue if scoreable day (Sat/Sun/Special)
                is_sk = is_scoreable_day(curr, special_dates_set)
                
                # MERGE: Use unified 'sk_all' queue for ALL SK assignments
                if is_sk:
                    q_key = "sk_all"
                else:
                    q_key = f"cover_{duty['id']}_{sh_idx}"

                # --- Double Duty Logic (Cover) ---
                # 1. SUNDAY LOOKBACK
                is_strict_special = d_str in special_dates_set or f"2000-{d_str[5:]}" in special_dates_set
                if is_sk and curr.weekday() == 6 and not is_strict_special: # Sunday AND Not Special
                    yesterday_str = (curr - timedelta(days=1)).strftime('%Y-%m-%d')
                    log(f"      🕵️ [Phase 0] Sunday {d_str}: Checking Double Duty for {duty['name']} (Lookback to {yesterday_str})...")
                    
                    prev_s = next((s for s in schedule if s['date']==yesterday_str and int(s['duty_id'])==int(duty['id']) and int(s['shift_index'])==sh_idx), None)
                    if prev_s:
                        p_uid = int(prev_s['employee_id'])
                        log(f"      🔎 [Phase 0] Found Saturday Worker: {emp_map.get(p_uid)} (ID: {p_uid})")

                        p_uid = int(prev_s['employee_id'])
                        if p_uid in double_duty_prefs:
                            # Check availability AND if they have quota left in SK Queue (>= 1 instance)
                             quota_left = (rot_q.get('sk_all',[]) + nxt_q.get('sk_all',[])).count(p_uid)
                             
                             log(f"      🔍 [Phase 0] Checking Double Duty for {emp_map.get(p_uid)} (Sat {yesterday_str}). Quota: {quota_left}, Pref: True")
                             
                             if quota_left > 0:
                                 is_unavail = (p_uid, d_str) in unavail_map
                                 busy_reason = is_user_busy(p_uid, curr, schedule, True)
                                 
                                 if not is_unavail and not busy_reason:
                                     chosen_id = p_uid
                                     log(f"      🔗 {d_str} {duty['name']}: Double Duty (Cover Sun) -> {emp_map.get(chosen_id)}")
                                 else:
                                     log(f"      ❌ [Phase 0] Double Duty Failed for {emp_map.get(p_uid)}: Unavail={is_unavail}, Busy={busy_reason}")
                             else:
                                 log(f"      ❌ [Phase 0] Double Duty Failed for {emp_map.get(p_uid)}: No Quota Left ({quota_left})")
                        else:
                             log(f"      ℹ️ [Phase 0] Sat worker {emp_map.get(p_uid)} does NOT want Double Duty.")

                if not chosen_id:
                    cq, nq = get_q(q_key, [int(x) for x in conf.get('excluded_ids',[])])
                    candidates = cq + nq
                    
                    # Sort by Double Duty Preference if Saturday AND quota >= 2
                    if is_sk and curr.weekday() == 5: # Saturday
                         # Prioritize if they want Double Duty AND have >= 2 instances in queue
                         candidates.sort(key=lambda x: (
                             1 if x in double_duty_prefs and candidates.count(x) >= 2 else 0, 
                             random.random()
                         ), reverse=True)
                    else:
                         candidates.sort(key=lambda x: double_duty_prefs.get(x, False), reverse=True)

                    for cand in candidates:
                        busy_r = is_user_busy(cand, curr, schedule, False)
                        if (cand, d_str) not in unavail_map and not busy_r: 
                            chosen_id = cand; break
                    
                    if chosen_id: rotate_assigned_user(q_key, chosen_id)

                if chosen_id and is_sk and curr.weekday() == 5: # Saturday
                     # REMOVED Lookahead as per user request (Doc update)
                     pass
            
            if chosen_id: 
                schedule.append({"date": d_str, "duty_id": duty['id'], "shift_index": sh_idx, "employee_id": chosen_id, "manually_locked": False})
                log(f"      ✅ {d_str} {duty['name']} -> {emp_map.get(chosen_id)}")
            else: 
                log(f"      ❌ {d_str} {duty['name']}: Δεν βρέθηκε διαθέσιμος υπάλληλος (Ωράριο).")
        curr += timedelta(days=1)

    # --- PHASE 1: Weekly ---
    log("▶️ Φάση 1: Ανάθεση Εβδομαδιαίων Υπηρεσιών...")
    for duty in [d for d in duties if d.get('is_weekly') and not d.get('is_special') and not d.get('is_off_balance')]:
        for sh_idx in range(duty['shifts_per_day']):
            if duty['shift_config'][sh_idx].get('is_within_hours'): continue
            q_key = f"weekly_{duty['id']}_{sh_idx}"; excl = [int(x) for x in duty['shift_config'][sh_idx].get('excluded_ids', [])]
            
            curr = start_date
            while curr <= end_date:
                # Check if this is the start day of the week for this duty
                # Default to Monday (0) if day_index is missing
                target_day = duty['shift_config'][sh_idx].get('day_index', 0) 
                
                # --- FIX: Handle Partial First Week ---
                # If we are at start_date and it's NOT the target start day (e.g. Month starts on Wed, but Duty starts Mon)
                # We must look back at the previous day (end of prev month) and continue that user's assignment.
                if curr == start_date and curr.weekday() != target_day:
                    log(f"      ℹ️ {curr.strftime('%Y-%m-%d')} {duty['name']}: Μερική εβδομάδα έναρξης. Έλεγχος για προηγούμενο ανάδοχο...")
                    prev_date = curr - timedelta(days=1)
                    p_str = prev_date.strftime('%Y-%m-%d')
                    
                    # Look in HISTORY (or schedule if manual)
                    prev_s = next((s for s in history + schedule if s['date'] == p_str and int(s['duty_id']) == duty['id'] and int(s.get('shift_index',0)) == sh_idx), None)
                    
                    if prev_s:
                        prev_uid = int(prev_s['employee_id'])
                        log(f"      ↪️ Βρέθηκε προηγούμενος: {emp_map.get(prev_uid)}. Επέκταση έως την επόμενη {target_day}...")
                        
                        # Fill until we hit the target day or end_date
                        while curr <= end_date and curr.weekday() != target_day:
                            d_str = curr.strftime('%Y-%m-%d')
                            if not any(s['date'] == d_str and int(s['duty_id']) == duty['id'] for s in schedule):
                                # Skip if Sunday and not in active range? (Keep consistent with main logic)
                                if not (curr.weekday()==6 and not is_in_period(curr, duty.get('sunday_active_range'))):
                                     schedule.append({"date": d_str, "duty_id": duty['id'], "shift_index": sh_idx, "employee_id": prev_uid, "manually_locked": False})
                                     log(f"      ✅ {d_str} {duty['name']} -> {emp_map.get(prev_uid)} (Extension)")
                            curr += timedelta(days=1)
                        continue # Now curr matches target_day (or end_date), main loop continues
                    else:
                        log(f"      ⚠️ Δεν βρέθηκε προηγούμενος για {p_str}. Η μερική εβδομάδα θα παραμείνει κενή.")

                if curr.weekday() != target_day:
                    curr += timedelta(days=1); continue

                d_str = curr.strftime('%Y-%m-%d')
                if any(s['date'] == d_str and int(s['duty_id']) == duty['id'] for s in schedule):
                    curr += timedelta(days=1); continue

                w_start = curr; w_end = w_start + timedelta(days=6) # logic might differ if day_index != 0
                
                chosen = None

                # Continuity Check (Standard - for full weeks)
                if w_start > start_date:
                    prev_day = w_start - timedelta(days=1)
                    p_str = prev_day.strftime('%Y-%m-%d')
                    prev_s = next((s for s in schedule if s['date'] == p_str and int(s['duty_id']) == duty['id']), None)
                    if prev_s:
                        cand = int(prev_s['employee_id'])
                        if (cand, d_str) not in unavail_map and not is_user_busy(cand, curr, schedule, False):
                            chosen = cand
                            log(f"      🔄 {d_str} {duty['name']}: Συνέχιση από {emp_map.get(chosen)}")

                if not chosen:
                    cq, nq = get_q(q_key, excl)
                    for cand in (cq+nq):
                        if (cand, d_str) not in unavail_map and not is_user_busy(cand, curr, schedule, False): 
                            chosen = cand; break
                    if chosen: rotate_assigned_user(q_key, chosen)

                if chosen:
                    schedule.append({"date": d_str, "duty_id": duty['id'], "shift_index": sh_idx, "employee_id": chosen, "manually_locked": False})
                    log(f"      ✅ {d_str} {duty['name']} -> {emp_map.get(chosen)}")
                    
                    t = curr + timedelta(days=1)
                    while t <= w_end and t <= end_date:
                         # Skip if Sunday and not in range 
                         if not (t.weekday()==6 and not is_in_period(t, duty.get('sunday_active_range'))):
                             if not any(s['date']==t.strftime('%Y-%m-%d') and int(s['duty_id'])==int(duty['id']) for s in schedule):
                                 schedule.append({"date": t.strftime('%Y-%m-%d'), "duty_id": duty['id'], "shift_index": sh_idx, "employee_id": chosen, "manually_locked": False})
                         t += timedelta(days=1)
                else:
                    log(f"      ❌ {d_str} {duty['name']}: Δεν βρέθηκε διαθέσιμος υπάλληλος.")
                
                curr = w_end + timedelta(days=1)

    # --- PHASE 2: Daily ---
    log("▶️ Φάση 2: Ανάθεση Καθημερινών Υπηρεσιών...")
    curr = start_date
    while curr <= end_date:
        d_str = curr.strftime('%Y-%m-%d')
        iso_weekday = curr.weekday() # 0=Mon ... 6=Sun
        is_sat = (iso_weekday == 5)
        is_sun = (iso_weekday == 6)
        is_special = is_scoreable_day(curr, special_dates_set)
        
        # Gather today's needs (Normal Daily Only)
        slots = []
        for d in [x for x in duties if not x.get('is_weekly') and not x.get('is_special') and not x.get('is_off_balance')]:
             if is_in_period(curr, d.get('active_range')):
                 for i in range(d['shifts_per_day']):
                     if not d['shift_config'][i].get('is_within_hours') and is_in_period(curr, d['shift_config'][i].get('active_range')):
                         if not any(s['date']==d_str and int(s['duty_id'])==int(d['id']) and int(s['shift_index'])==i for s in schedule):
                             slots.append({'d':d, 'i':i, 'c':d['shift_config'][i]})
        
        random.shuffle(slots)

        for x in slots:
            duty = x['d']; duty_id = duty['id']
            sh_idx = x['i']
            conf = x['c']
            
            q_prefix = "sk_" if (is_sat or is_sun) else "" 
            # MERGE: Unified 'sk_all' for normal weekend shifts
            if is_sat or is_sun:
                 q_key = "sk_all"
            else:
                 q_key = f"normal_{duty_id}_sh_{sh_idx}"
                 
            excluded_ids = [int(z) for z in conf.get('excluded_ids',[])]
            
            cq, nq = get_q(q_key, excluded_ids)
            chosen = None
            
            # 1. SUNDAY: Check Saturday (Lookback)
            is_strict_special = d_str in special_dates_set or f"2000-{d_str[5:]}" in special_dates_set
            if is_sun and not is_strict_special:
                yesterday_str = (curr - timedelta(days=1)).strftime('%Y-%m-%d')
                log(f"      🕵️ [Phase 2] Sunday {d_str}: Checking Double Duty for {duty['name']} (Lookback to {yesterday_str})...")

                prev_assignment = next((s for s in schedule + history if s['date']==yesterday_str and int(s['duty_id'])==int(duty_id) and int(s.get('shift_index',0))==sh_idx), None)
                
                if prev_assignment:

                    prev_uid = int(prev_assignment['employee_id'])
                    sat_is_scoreable = is_scoreable_day(curr - timedelta(days=1), special_dates_set)
                    sun_is_scoreable = is_scoreable_day(curr, special_dates_set)
                    wants_double = prev_uid in double_duty_prefs
                    
                    if wants_double and sat_is_scoreable and sun_is_scoreable:
                         is_unavail = (prev_uid, d_str) in unavail_map
                         is_busy = is_user_busy(prev_uid, curr, schedule, True, False)
                         
                         log(f"      🔍 [Phase 2] Checking Double Duty for {emp_map.get(prev_uid)} (Sat {yesterday_str}). Unavail={is_unavail}, Busy={is_busy}")
                         
                         if not is_unavail and not is_busy:
                              chosen = prev_uid
                              log(f"      🔄 {d_str} {duty['name']}: Double Duty (Sun) -> {emp_map.get(chosen)} (Linked to Sat)")
                         else:
                              log(f"      ❌ [Phase 2] Double Duty Failed for {emp_map.get(prev_uid)}: Busy/Unavail")
                    else:
                         if not wants_double: log(f"      ℹ️ [Phase 2] Sat worker {emp_map.get(prev_uid)} does NOT want Double Duty ({wants_double}).")
                         if not sat_is_scoreable: log(f"      ℹ️ [Phase 2] Yesterday ({yesterday_str}) is NOT scoreable.")
                         if not sun_is_scoreable: log(f"      ℹ️ [Phase 2] Today ({d_str}) is NOT scoreable.")

            ignore_tmr = False
            
            if not chosen:
                candidates = cq + nq
                
                # Sorting Logic
                def sort_priority(uid):
                    if is_sat:
                         sun_date = curr + timedelta(days=1)
                         sun_is_scoreable = is_scoreable_day(sun_date, special_dates_set)
                         sat_is_scoreable = is_scoreable_day(curr, special_dates_set)
                         # Priority if Double Duty Pref AND has quota (>=2 instances)
                         has_quota = candidates.count(uid) >= 2
                         if uid in double_duty_prefs and sat_is_scoreable and sun_is_scoreable and has_quota:
                             return -100 
                    if is_sun:
                        yesterday_str = (curr - timedelta(days=1)).strftime('%Y-%m-%d')
                        if yesterday_str in special_dates_set and uid in double_duty_prefs:
                            return 50 
                    return 0
                
                candidates.sort(key=sort_priority)
                
                for cand in candidates:
                    if (cand, d_str) in unavail_map: continue
                    
                    busy_r = is_user_busy(cand, curr, schedule, False, False)
                    if not busy_r:
                        chosen = cand; break
            
            if chosen:
                schedule.append({"date": d_str, "duty_id": duty_id, "shift_index": sh_idx, "employee_id": chosen, "manually_locked": False})
                rotate_assigned_user(q_key, chosen)
                log(f"      ✅ {d_str} {duty['name']} -> {emp_map.get(chosen)}")
            else: 
                log(f"      ❌ {d_str} {duty['name']}: Δεν βρέθηκε διαθέσιμος υπάλληλος.")
        curr += timedelta(days=1)


    # --- BALANCING LOGIC ---
    lookback_date = (start_date - relativedelta(months=2)).replace(day=1)
    
    def get_detailed_scores(target_duties):
        # Determine employees excluded from ALL shifts of ALL target duties
        globally_excluded = set(e['id'] for e in employees)
        for d in duties:
            if d['id'] not in target_duties: continue
            for conf in d.get('shift_config', [{}]):
                exc = set(int(x) for x in conf.get('excluded_ids', []))
                globally_excluded -= (set(e['id'] for e in employees) - exc)
        
        sc = {e['id']: 0 for e in employees if e['id'] not in globally_excluded}
        for e in employees:
            if e['id'] in globally_excluded: continue
            eid_str = str(e['id'])
            for d in duties:
                if d['id'] in target_duties:
                    for c in d.get('shift_config',[]): sc[e['id']] += int(c.get('handicaps',{}).get(eid_str,0))
        for s in history + schedule:
            if int(s['duty_id']) not in target_duties: continue
            s_d = dt.strptime(s['date'], '%Y-%m-%d').date()
            if s_d < lookback_date or s_d > end_date: continue
            d_o = next((d for d in duties if d['id']==int(s['duty_id'])), None)
            if not d_o: continue
            if d_o.get('is_weekly') and not is_scoreable_day(s_d, special_dates_set): continue
            conf = d_o['shift_config'][int(s.get('shift_index',0))]
            if conf.get('is_within_hours') and conf.get('default_employee_id')==int(s['employee_id']) and not is_scoreable_day(s_d, special_dates_set): continue
            eid = int(s['employee_id'])
            if eid in sc: sc[eid] += 1
        return sc

    def run_balance(target, label):
        if not target: return
        log(f"⚖️ Εξισορρόπηση {label}...")
        
        swaps_performed = 0
        stagnation_limit = 2
        stagnation_count = 0
        
        for iteration in range(500): 
            sc = get_detailed_scores(target)
            if not sc: break
            
            if iteration == 0:
                 s_init = sorted(sc.items(), key=lambda x: x[1])
                 log(f"   📊 [Initial Balance] Min: {s_init[0][1]} | Max: {s_init[-1][1]} | Range: {s_init[-1][1] - s_init[0][1]}")
                 log(f"   📊 [Initial Scores]: {[(emp_map.get(k, k), v) for k,v in s_init]}")
            s_ids = sorted(sc.keys(), key=lambda k: sc[k])
            if len(s_ids) < 2: break
            min_id, max_id = s_ids[0], s_ids[-1]
            diff = sc[max_id] - sc[min_id]
            
            if diff <= 1:
                log(f"✅ Η Εξισορρόπηση ολοκληρώθηκε επιτυχώς (Διαφορά: {diff}).")
                break
                
            move_made = False
            diagnostics = []
            
            potential_donors = [uid for uid in s_ids if sc[uid] > sc[min_id] + 1]
            potential_donors.reverse()
            
            for donor_id in potential_donors:
                donor_shifts = [s for s in schedule if int(s['employee_id'])==donor_id and int(s['duty_id']) in target and not s.get('manually_locked')]
                if label.endswith("(Weekday Only)"):
                    # Phase 8: Filter for strictly Weekday non-Special shifts
                    donor_shifts = [c for c in donor_shifts 
                                    if start_date <= dt.strptime(c['date'], '%Y-%m-%d').date() <= end_date
                                    and dt.strptime(c['date'], '%Y-%m-%d').date().weekday() not in [5, 6]
                                    and not is_scoreable_day(c['date'], special_dates_set)]
                else:
                    donor_shifts = [c for c in donor_shifts if start_date <= dt.strptime(c['date'], '%Y-%m-%d').date() <= end_date]
                
                random.shuffle(donor_shifts)
                
                if not donor_shifts: continue

                for shift in donor_shifts:
                    if int(shift['employee_id']) != donor_id: continue

                    s_date = dt.strptime(shift['date'], '%Y-%m-%d').date()
                    d_obj = next((d for d in duties if d['id']==int(shift['duty_id'])),None)
                    conf = d_obj.get('shift_config', [{}])[int(shift.get('shift_index',0))] if d_obj else {}
                    
                    if conf.get('is_within_hours') and conf.get('default_employee_id')==donor_id and not is_scoreable_day(s_date, special_dates_set): 
                        if stagnation_count >= stagnation_limit: diagnostics.append(f"Βάρδια {shift['date']}: Κλειδωμένο Ωράριο")
                        continue
                    
                    if d_obj and d_obj.get('is_weekly'): 
                        if stagnation_count >= stagnation_limit: diagnostics.append(f"Βάρδια {shift['date']}: Κλειδωμένη Εβδομαδιαία")
                        continue
                    
                    # --- ATOMIC SWAP LOGIC ---
                    is_pair = False
                    partner_shift = None
                    
                    if donor_id in double_duty_prefs:
                        wd = s_date.weekday()
                        target_offset = 0
                        if wd == 5: target_offset = 1 
                        elif wd == 6: target_offset = -1 
                        
                        if target_offset != 0:
                            partner_date = s_date + timedelta(days=target_offset)
                            partner_str = partner_date.strftime('%Y-%m-%d')
                            partner_shift = next((s for s in schedule 
                                                  if s['date'] == partner_str 
                                                  and int(s['employee_id']) == donor_id 
                                                  and int(s['duty_id']) == int(shift['duty_id'])
                                                  and not s.get('manually_locked')), None)
                            if partner_shift:
                                is_pair = True
                    
                    valid_receivers = [uid for uid in s_ids if sc[uid] < sc[donor_id] - 1]
                    
                    swap_success = False
                    
                    for rec_id in valid_receivers:
                        if rec_id == donor_id: continue
                        if rec_id in [int(x) for x in conf.get('excluded_ids',[])]: 
                            if stagnation_count >= stagnation_limit: diagnostics.append(f"Ο/Η {emp_map[rec_id]} Εξαιρείται")
                            continue
                        
                        if (rec_id, shift['date']) in unavail_map: 
                             if stagnation_count >= stagnation_limit: diagnostics.append(f"Ο/Η {emp_map[rec_id]} κώλυμα {shift['date']}")
                             continue
                        if is_user_busy(rec_id, s_date, schedule, False): 
                             if stagnation_count >= stagnation_limit: diagnostics.append(f"Ο/Η {emp_map[rec_id]} απασχολημένος {shift['date']}")
                             continue

                        if is_pair and partner_shift:
                            p_date = dt.strptime(partner_shift['date'], '%Y-%m-%d').date()
                            if (rec_id, partner_shift['date']) in unavail_map: continue
                            if is_user_busy(rec_id, p_date, schedule, False): continue
                            
                            shift['employee_id'] = rec_id
                            partner_shift['employee_id'] = rec_id
                            swaps_performed += 2
                            sc[donor_id] -= 2; sc[rec_id] += 2
                            move_made = True
                            log(f"   🔄 Double Swap: {emp_map.get(donor_id)} ({shift['date']}/{partner_shift['date']}) -> {emp_map.get(rec_id)}")
                            swap_success = True
                            stagnation_count = 0
                            break
                        
                        elif not is_pair:
                            shift['employee_id'] = rec_id
                            swaps_performed += 1
                            sc[donor_id] -= 1; sc[rec_id] += 1
                            move_made = True
                            swap_success = True
                            log(f"   🔄 Swap: {emp_map.get(donor_id)} ({shift['date']}) -> {emp_map.get(rec_id)}")
                            stagnation_count = 0
                            break
                    
                    if swap_success: break 
                if move_made: break 
            
            if not move_made:
                stagnation_count += 1
                if stagnation_count >= stagnation_limit:
                    log(f"⚠️ Η Εξισορρόπηση σταμάτησε (Διαφορά: {diff}). Αιτίες που δεν μειώθηκε η διαφορά:")
                    for d in list(set(diagnostics))[:5]: 
                        log(f"      - {d}")
                    break

        # Final Score Log
        final_sc = get_detailed_scores(target)
        if final_sc:
            s_fin = sorted(final_sc.items(), key=lambda x: x[1])
            log(f"   🏁 [Final Balance] Min: {s_fin[0][1]} | Max: {s_fin[-1][1]} | Range: {s_fin[-1][1] - s_fin[0][1]}")
            log(f"   🏁 [Final Scores]: {[(emp_map.get(k, k), v) for k,v in s_fin]}")

    run_balance([d['id'] for d in duties if not d.get('is_off_balance') and not d.get('is_special')], "Κανονικών Υπηρεσιών")
    run_balance([d['id'] for d in duties if d.get('is_off_balance') and not d.get('is_special')], "Υπηρεσιών Εκτός Ισοζυγίου")

    # --- PHASE 5: Special-Date Balancing ---
    def is_special_date_only(d_str, sp_set):
        d = dt.strptime(d_str, '%Y-%m-%d').date() if isinstance(d_str, str) else d_str
        if str(d) in sp_set: return True
        recurring = f"2000-{d.strftime('%m-%d')}"
        if recurring in sp_set: return True
        return False

    def run_special_date_balance(target_duty_ids, label):
        log(f"▶️ Φάση 5: Εξισορρόπηση Αργιών ({label})...")
        sd_swaps = 0
        stagnation_limit = 2
        stagnation_count = 0

        sd_excluded = set(e['id'] for e in employees)
        for d in duties:
            if d['id'] not in target_duty_ids: continue
            for conf in d.get('shift_config', [{}]):
                exc = set(int(x) for x in conf.get('excluded_ids', []))
                sd_excluded -= (set(e['id'] for e in employees) - exc)

        for _ in range(200):
            sd_sc = {e['id']: 0 for e in employees if e['id'] not in sd_excluded}
            for s in history + schedule:
                s_d = dt.strptime(s['date'], '%Y-%m-%d').date()
                d_id = int(s['duty_id'])
                d_o = next((d for d in duties if d['id'] == d_id), None)
                if not d_o or d_o.get('is_special'): continue
                if d_o['id'] not in target_duty_ids: continue
                eid = int(s['employee_id'])
                if eid not in sd_sc: continue
                if is_special_date_only(s_d, special_dates_set):
                    sd_sc[eid] += 1

            s_sd = sorted(sd_sc.items(), key=lambda x: x[1])
            
            if _ == 0:
                 log(f"   📊 [Initial Special Balance] Min: {s_sd[0][1]} | Max: {s_sd[-1][1]}")
                 log(f"   📊 [Initial Special Scores]: {[(emp_map.get(k, k), v) for k,v in s_sd]}")
            if not s_sd or s_sd[-1][1] - s_sd[0][1] <= 1: break

            swapped = False
            for i in range(len(s_sd) - 1, 0, -1):
                max_id = s_sd[i][0]
                for j in range(i):
                    min_id = s_sd[j][0]
                    if sd_sc[max_id] - sd_sc[min_id] <= 1: continue

                    max_special = [s for s in schedule if int(s['employee_id']) == max_id
                                   and int(s['duty_id']) in target_duty_ids
                                   and is_scoreable_day(s['date'], special_dates_set)
                                   and not s.get('manually_locked')
                                   and start_date <= dt.strptime(s['date'], '%Y-%m-%d').date() <= end_date]
                    max_special = [s for s in max_special if not any(d['id'] == int(s['duty_id']) and d.get('is_special') for d in duties)]

                    max_special_weekly = [s for s in max_special if any(d['id'] == int(s['duty_id']) and d.get('is_weekly') for d in duties)]
                    max_special_daily = [s for s in max_special if not any(d['id'] == int(s['duty_id']) and d.get('is_weekly') for d in duties)]

                    min_weekend_nonspecial = [s for s in schedule if int(s['employee_id']) == min_id
                                              and int(s['duty_id']) in target_duty_ids
                                              and is_scoreable_day(s['date'], special_dates_set)
                                              and not is_special_date_only(s['date'], special_dates_set)
                                              and not s.get('manually_locked')
                                              and start_date <= dt.strptime(s['date'], '%Y-%m-%d').date() <= end_date]
                    min_weekend_nonspecial = [s for s in min_weekend_nonspecial if not any(d['id'] == int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special')) for d in duties)]

                    random.shuffle(max_special_daily); random.shuffle(min_weekend_nonspecial)
                    for sd_shift in max_special_daily:
                        sd_d = next((d for d in duties if d['id'] == int(sd_shift['duty_id'])), None)
                        sd_conf = sd_d.get('shift_config', [{}])[int(sd_shift.get('shift_index', 0))] if sd_d else {}
                        if min_id in [int(x) for x in sd_conf.get('excluded_ids', [])]: continue
                        if (min_id, sd_shift['date']) in unavail_map or is_user_busy(min_id, dt.strptime(sd_shift['date'], '%Y-%m-%d').date(), schedule, False): continue
                        
                        for we_shift in min_weekend_nonspecial:
                            we_d = next((d for d in duties if d['id'] == int(we_shift['duty_id'])), None)
                            we_conf = we_d.get('shift_config', [{}])[int(we_shift.get('shift_index', 0))] if we_d else {}
                            if max_id in [int(x) for x in we_conf.get('excluded_ids', [])]: continue
                            if (max_id, we_shift['date']) in unavail_map or is_user_busy(max_id, dt.strptime(we_shift['date'], '%Y-%m-%d').date(), schedule, False): continue
                            sd_shift['employee_id'] = min_id; we_shift['employee_id'] = max_id
                            swapped = True; sd_swaps += 1; stagnation_count = 0; break
                        if swapped: break

                        sk_max = sum(1 for s in schedule if int(s['employee_id']) == max_id and is_scoreable_day(s['date'], special_dates_set) and not any(d['id']==int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special') or d.get('is_off_balance')) for d in duties))
                        sk_min = sum(1 for s in schedule if int(s['employee_id']) == min_id and is_scoreable_day(s['date'], special_dates_set) and not any(d['id']==int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special') or d.get('is_off_balance')) for d in duties))
                        
                        if sk_max > sk_min:
                            min_weekday = [s for s in schedule if int(s['employee_id']) == min_id
                                           and int(s['duty_id']) in target_duty_ids
                                           and not is_scoreable_day(s['date'], special_dates_set)
                                           and not s.get('manually_locked')
                                           and start_date <= dt.strptime(s['date'], '%Y-%m-%d').date() <= end_date]
                            min_weekday = [s for s in min_weekday if not any(d['id'] == int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special')) for d in duties)]
                            random.shuffle(min_weekday)
                            
                            for wd_shift in min_weekday:
                                wd_d = next((d for d in duties if d['id'] == int(wd_shift['duty_id'])), None)
                                wd_conf = wd_d.get('shift_config', [{}])[int(wd_shift.get('shift_index', 0))] if wd_d else {}
                                if max_id in [int(x) for x in wd_conf.get('excluded_ids', [])]: continue
                                if (max_id, wd_shift['date']) in unavail_map or is_user_busy(max_id, dt.strptime(wd_shift['date'], '%Y-%m-%d').date(), schedule, False): continue
                                sd_shift['employee_id'] = min_id; wd_shift['employee_id'] = max_id
                                swapped = True; sd_swaps += 1; stagnation_count = 0;
                                log(f"   ↪️ Fallback Swap: Special (from {emp_map.get(max_id)}) ↔ Weekday (from {emp_map.get(min_id)})")
                                break
                        if swapped: break
                    if swapped: break

                    if not swapped and max_special_weekly:
                        weekly_weeks = {}
                        for ws in max_special_weekly:
                            ws_date = dt.strptime(ws['date'], '%Y-%m-%d').date()
                            iso_y, iso_w, _ = ws_date.isocalendar()
                            wk = (int(ws['duty_id']), int(ws.get('shift_index', 0)), iso_y, iso_w)
                            weekly_weeks.setdefault(wk, []).append(ws)

                        for wk_key, wk_shifts in weekly_weeks.items():
                            duty_id, sh_idx, iso_y, iso_w = wk_key
                            wk_duty = next((d for d in duties if d['id'] == duty_id), None)
                            wk_conf = wk_duty.get('shift_config', [{}])[sh_idx] if wk_duty else {}
                            if min_id in [int(x) for x in wk_conf.get('excluded_ids', [])]: continue

                            max_wk_special = sum(1 for s in wk_shifts if is_scoreable_day(s['date'], special_dates_set) and is_special_date_only(s['date'], special_dates_set))
                            if max_wk_special == 0: continue

                            min_wk_candidates = []
                            min_all_shifts = [s for s in schedule if int(s['employee_id']) == min_id and int(s['duty_id']) == duty_id and int(s.get('shift_index', 0)) == sh_idx and not s.get('manually_locked')]
                            
                            min_weeks_map = {}
                            for ms in min_all_shifts:
                                ms_d = dt.strptime(ms['date'], '%Y-%m-%d').date()
                                iso_y_m, iso_w_m, _ = ms_d.isocalendar()
                                min_weeks_map.setdefault((iso_y_m, iso_w_m), []).append(ms)

                            for (m_y, m_w), m_shifts in min_weeks_map.items():
                                m_spec_count = sum(1 for s in m_shifts if is_scoreable_day(s['date'], special_dates_set) and is_special_date_only(s['date'], special_dates_set))
                                if m_spec_count < max_wk_special:
                                    min_wk_candidates.append((m_shifts, m_spec_count))
                            
                            min_wk_candidates.sort(key=lambda x: x[1])

                            for cand_shifts, _ in min_wk_candidates:
                                can_swap_week = True
                                for s_max in wk_shifts:
                                    if (min_id, s_max['date']) in unavail_map or is_user_busy(min_id, dt.strptime(s_max['date'], '%Y-%m-%d').date(), schedule, False):
                                        can_swap_week = False; break
                                if not can_swap_week: continue
                                
                                for s_min in cand_shifts:
                                    if (max_id, s_min['date']) in unavail_map or is_user_busy(max_id, dt.strptime(s_min['date'], '%Y-%m-%d').date(), schedule, False):
                                         can_swap_week = False; break
                                if not can_swap_week: continue

                                for s in wk_shifts: s['employee_id'] = min_id
                                for s in cand_shifts: s['employee_id'] = max_id
                                swapped = True; sd_swaps += 1; stagnation_count = 0
                                log(f"   ↪️ Εβδομαδιαία Ανταλλαγή: {emp_map.get(max_id)} (Week {iso_w}) ↔ {emp_map.get(min_id)}")
                                break
                            if swapped: break
                        if swapped: break
                    if swapped: break
                if swapped: break
            
            if not swapped:
                stagnation_count += 1
                if stagnation_count >= stagnation_limit: break
    
        # Final Special Score Log
        sd_sc_fin = {e['id']: 0 for e in employees if e['id'] not in sd_excluded}
        for s in history + schedule:
             s_d = dt.strptime(s['date'], '%Y-%m-%d').date()
             d_id = int(s['duty_id'])
             d_o = next((d for d in duties if d['id'] == d_id), None)
             if not d_o or d_o.get('is_special'): continue
             if d_o['id'] not in target_duty_ids: continue
             eid = int(s['employee_id'])
             if eid in sd_sc_fin:
                 if is_special_date_only(s_d, special_dates_set):
                     sd_sc_fin[eid] += 1
        
        s_sd_fin = sorted(sd_sc_fin.items(), key=lambda x: x[1])
        if s_sd_fin:
             log(f"   🏁 [Final Special Balance] Min: {s_sd_fin[0][1]} | Max: {s_sd_fin[-1][1]} | Range: {s_sd_fin[-1][1] - s_sd_fin[0][1]}")
             log(f"   🏁 [Final Special Scores]: {[(emp_map.get(k, k), v) for k,v in s_sd_fin]}")

        log(f"✅ Ολοκληρώθηκε (Έγιναν {sd_swaps} ανταλλαγές).")

    normal_duty_ids = [d['id'] for d in duties if not d.get('is_off_balance') and not d.get('is_special')]
    if normal_duty_ids: run_special_date_balance(normal_duty_ids, "Normal")

    off_balance_duty_ids = [d['id'] for d in duties if d.get('is_off_balance') and not d.get('is_special')]
    if off_balance_duty_ids: run_special_date_balance(off_balance_duty_ids, "Off-Balance")

    # --- PHASE 6: SK Balancing ---
    log("▶️ Φάση 6: Εξισορρόπηση Σαββατοκύριακων...")
    sk_swaps = 0
    sk_win_start = (end_date - relativedelta(months=5)).replace(day=1)
    
    normal_duties = [d for d in duties if not d.get('is_off_balance') and not d.get('is_special')]
    sk_excluded = set(e['id'] for e in employees)
    for d in normal_duties:
        for conf in d.get('shift_config', [{}]):
            exc = set(int(x) for x in conf.get('excluded_ids', []))
            sk_excluded -= (set(e['id'] for e in employees) - exc)
    
    sk_stagnation_count = 0 
    sk_stagnation_limit = 2
    
    for _ in range(200):
        sk = {e['id']: 0 for e in employees if e['id'] not in sk_excluded}
        for s in history+schedule:
            if dt.strptime(s['date'],'%Y-%m-%d').date() < sk_win_start: continue
            d_o = next((d for d in duties if d['id']==int(s['duty_id'])),None)
            if not d_o or d_o.get('is_special') or d_o.get('is_off_balance'): continue
            eid = int(s['employee_id'])
            if eid in sk and is_scoreable_day(s['date'], special_dates_set): sk[eid] += 1
        
        s_sk = sorted(sk.items(), key=lambda x:x[1])
        
        if _ == 0:
             log(f"   📊 [Initial SK Balance] Min: {s_sk[0][1]} | Max: {s_sk[-1][1]} | Range: {s_sk[-1][1] - s_sk[0][1]}")
             log(f"   📊 [Initial SK Scores]: {[(emp_map.get(k, k), v) for k,v in s_sk]}")
             
        if s_sk[-1][1] - s_sk[0][1] <= 2: break
        
        swapped = False
        max_swaps_per_iter = 5
        iter_swaps = 0
        failure_log = [] # Track reasons for failures in this iteration
        
        
        true_max = s_sk[-1][1]
        for i in range(len(s_sk)-1, 0, -1):
            max_id = s_sk[i][0]
            if s_sk[i][1] < true_max - 1:
                 # User constraint: detailed balancing only for top tiers (Max and Max-1)
                 break
                 
            if iter_swaps >= max_swaps_per_iter: break
            
            for j in range(i):
                min_id = s_sk[j][0]
                
                # Check diff. If stagnation_count > 0, we relax diff to > 1
                required_diff = 2 if sk_stagnation_count == 0 else 1
                if sk[max_id] - sk[min_id] <= required_diff: continue
                
                max_we = [s for s in schedule if int(s['employee_id'])==max_id 
                          and dt.strptime(s['date'], '%Y-%m-%d').date().weekday() in [5, 6] 
                          and not s.get('manually_locked')]
                max_we = [s for s in max_we if not any(d['id']==int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special') or d.get('is_off_balance')) for d in duties)]
                
                if not max_we:
                     failure_log.append(f"No swappable weekend shifts for {emp_map.get(max_id)}")
                
                # Double Duty Debugging
                if max_id in double_duty_prefs:
                    log(f"   🔍 Check Double Duty for {emp_map.get(max_id)} in SK Balance...")

                min_wd = [s for s in schedule if int(s['employee_id'])==min_id 
                          and dt.strptime(s['date'], '%Y-%m-%d').date().weekday() not in [5, 6] 
                          and not is_special_date_only(s['date'], special_dates_set)
                          and not s.get('manually_locked')]
                min_wd = [s for s in min_wd if not any(d['id']==int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special') or d.get('is_off_balance')) for d in duties)]
                if not min_wd:
                     failure_log.append(f"No swappable weekday shifts for {emp_map.get(min_id)}")
                
                random.shuffle(max_we); random.shuffle(min_wd)
                for we in max_we:
                    if int(we['employee_id']) != max_id: continue 
                    
                    is_double_pair = False
                    partner = None
                    if max_id in double_duty_prefs:
                         we_date = dt.strptime(we['date'], '%Y-%m-%d').date()
                         if we_date.weekday() == 5: 
                             partner_date = we_date + timedelta(days=1)
                             partner = next((s for s in schedule if s['date']==partner_date.strftime('%Y-%m-%d') and int(s['employee_id'])==max_id and int(s['duty_id'])==int(we['duty_id']) and s.get('shift_index')==we.get('shift_index') and not s.get('manually_locked')), None)
                         elif we_date.weekday() == 6: 
                             partner_date = we_date - timedelta(days=1)
                             partner = next((s for s in schedule if s['date']==partner_date.strftime('%Y-%m-%d') and int(s['employee_id'])==max_id and int(s['duty_id'])==int(we['duty_id']) and s.get('shift_index')==we.get('shift_index') and not s.get('manually_locked')), None)
                         
                         if partner: 
                             is_double_pair = True
                             log(f"     Found Double Pair for {emp_map.get(max_id)}: {we['date']} & {partner['date']}")
                         else:
                             log(f"     No Partner found for {emp_map.get(max_id)} on {we['date']}")

                    if is_double_pair and partner:
                        log(f"      🔎 Attempting Atomic Swap for {emp_map.get(max_id)}: Sat {we['date']} + Sun {partner['date']}")
                        if len(min_wd) < 2: 
                             failure_log.append(f"Not enough weekday shifts for {emp_map.get(min_id)} to swap atomic pair")
                             continue 
                        
                        p_d = next((d for d in duties if d['id']==int(partner['duty_id'])), None)
                        p_conf = p_d.get('shift_config', [{}])[int(partner.get('shift_index',0))] if p_d else {}
                        
                        we_d = next((d for d in duties if d['id']==int(we['duty_id'])), None)
                        we_conf = we_d.get('shift_config', [{}])[int(we.get('shift_index',0))] if we_d else {}
                        
                        if min_id in [int(x) for x in p_conf.get('excluded_ids', [])]: 
                            failure_log.append(f"{emp_map.get(min_id)} excluded from partner duty {partner['duty_id']}")
                            continue
                        if min_id in [int(x) for x in we_conf.get('excluded_ids', [])]: 
                            failure_log.append(f"{emp_map.get(min_id)} excluded from duty {we['duty_id']}")
                            continue

                        if (min_id, partner['date']) in unavail_map or is_user_busy(min_id, dt.strptime(partner['date'],'%Y-%m-%d').date(), schedule, False): 
                             failure_log.append(f"{emp_map.get(min_id)} busy/unavail on {partner['date']}")
                             continue
                        if (min_id, we['date']) in unavail_map or is_user_busy(min_id, dt.strptime(we['date'],'%Y-%m-%d').date(), schedule, False): 
                             failure_log.append(f"{emp_map.get(min_id)} busy/unavail on {we['date']}")
                             continue

                        found_wd_pair = []
                        for wd in min_wd:
                            wd_d = next((d for d in duties if d['id']==int(wd['duty_id'])), None)
                            wd_conf = wd_d.get('shift_config', [{}])[int(wd.get('shift_index',0))] if wd_d else {}
                            if max_id in [int(x) for x in wd_conf.get('excluded_ids', [])]: continue
                            if (max_id, wd['date']) in unavail_map or is_user_busy(max_id, dt.strptime(wd['date'],'%Y-%m-%d').date(), schedule, False): continue
                            found_wd_pair.append(wd)
                            if len(found_wd_pair) == 2: break
                        
                        if len(found_wd_pair) == 2:
                            we['employee_id'] = min_id
                            partner['employee_id'] = min_id
                            found_wd_pair[0]['employee_id'] = max_id
                            found_wd_pair[1]['employee_id'] = max_id
                            
                            swapped = True; sk_swaps += 2; iter_swaps += 1
                            sk[max_id] -= 2; sk[min_id] += 2
                            log(f"   🔄 Atomic Double Swap: {emp_map.get(max_id)} (Sat {we['date']} + Sun {partner['date']}) -> {emp_map.get(min_id)}")
                            sk_stagnation_count = 0
                            break
                        else:
                            continue 
                    
                    else:
                        we_d = next((d for d in duties if d['id']==int(we['duty_id'])), None)
                        we_conf = we_d.get('shift_config', [{}])[int(we.get('shift_index',0))] if we_d else {}
                        if min_id in [int(x) for x in we_conf.get('excluded_ids', [])]: 
                            failure_log.append(f"{emp_map.get(min_id)} excluded from {we['duty_id']}")
                            continue
                        if (min_id, we['date']) in unavail_map or is_user_busy(min_id, dt.strptime(we['date'],'%Y-%m-%d').date(), schedule, False): 
                            failure_log.append(f"{emp_map.get(min_id)} busy on {we['date']}")
                            continue
                        
                        for wd in min_wd:
                            wd_d = next((d for d in duties if d['id']==int(wd['duty_id'])), None)
                            wd_conf = wd_d.get('shift_config', [{}])[int(wd.get('shift_index',0))] if wd_d else {}
                            if max_id in [int(x) for x in wd_conf.get('excluded_ids', [])]: continue
                            if (max_id, wd['date']) in unavail_map or is_user_busy(max_id, dt.strptime(wd['date'],'%Y-%m-%d').date(), schedule, False): continue
                            
                            we['employee_id'] = min_id; wd['employee_id'] = max_id
                            swapped = True; sk_swaps += 1; iter_swaps += 1
                            sk[max_id] -= 1; sk[min_id] += 1
                            log(f"   🔄 Single Swap: {emp_map.get(max_id)} ({we['date']}) -> {emp_map.get(min_id)}")
                            sk_stagnation_count = 0
                            break
                        if swapped: break 
                if swapped: break 
            if swapped: break 
            
        if not swapped:
            # --- Last Resort: Weekly Duty Swap ---
            # If granular swaps failed, try to offload an ENTIRE week of a Weekly Duty from Max to Min.
            log(f"      ⚠️ Granular swaps failed via {emp_map.get(max_id)}. Attempting Weekly Duty Swap...")
            
            # 1. Find all Weekly Duty assignments for max_id
            max_weekly_shifts = [s for s in schedule if int(s['employee_id'])==max_id 
                                 and any(d['id']==int(s['duty_id']) and d.get('is_weekly') for d in duties)
                                 and not s.get('manually_locked')]
            
            # Group by (DutyID, WeekStart)
            weekly_groups = {}
            for s in max_weekly_shifts:
                s_date = dt.strptime(s['date'], '%Y-%m-%d').date()
                # Find start of week (Monday)
                week_start = s_date - timedelta(days=s_date.weekday())
                key = (int(s['duty_id']), week_start)
                if key not in weekly_groups: weekly_groups[key] = []
                weekly_groups[key].append(s)

            # 2. Try to swap a whole group to a Min ID
            for (did_id, w_start), shifts in weekly_groups.items():
                if swapped: break
                
                duty_obj = next((d for d in duties if d['id']==did_id), None)
                if not duty_obj: continue
                # We assume all shifts in a weekly duty have same config/exclusions for simplicity, 
                # or we check the specific shift index of the first shift.
                # Weekly duties usually use shift_index 0 or consistent configs.
                
                # Check Min Candidates
                # We iterate standard min_ids from the SK list
                for j in range(i): 
                    min_candidate = s_sk[j][0]
                    
                    # Check Exclusions
                    # Check exclusion for *every* shift in the group (strict)
                    is_excluded = False
                    for s in shifts:
                         conf = duty_obj.get('shift_config', [{}])[int(s.get('shift_index',0))]
                         if min_candidate in [int(x) for x in conf.get('excluded_ids', [])]:
                             is_excluded = True; break
                    if is_excluded: continue

                    # Check Availability / Busy for ALL dates in the group
                    is_busy_any = False
                    for s in shifts:
                        s_date = dt.strptime(s['date'], '%Y-%m-%d').date()
                        if (min_candidate, s['date']) in unavail_map: 
                            is_busy_any = True; break
                        if is_user_busy(min_candidate, s_date, schedule, False):
                            is_busy_any = True; break
                    
                    if is_busy_any: continue

                    # PERFORM SWAP
                    score_change = 0
                    for s in shifts:
                        s['employee_id'] = min_candidate
                        if is_scoreable_day(s['date'], special_dates_set):
                            score_change += 1
                    
                    swapped = True
                    sk[max_id] -= score_change
                    sk[min_candidate] += score_change
                    sk_swaps += score_change # Approximate swap count
                    sk_stagnation_count = 0
                    
                    log(f"      🔄 WEEKLY SWAP: {emp_map.get(max_id)} -> {emp_map.get(min_candidate)} | Duty {duty_obj['name']} | Week of {w_start}")
                    break # Found a min candidate
            
            if not swapped:
                sk_stagnation_count += 1
                if sk_stagnation_count >= sk_stagnation_limit:
                    log(f"⚠️ SK: Η Εξισορρόπηση σταμάτησε (Stagnation). Reasons:")
                    for fai in failure_log[:10]: # Show top 10 reasons
                        log(f"   - {fai}")
                    break
            
    # Final SK Score Log
    sk_fin = {e['id']: 0 for e in employees if e['id'] not in sk_excluded}
    for s in history+schedule:
        if dt.strptime(s['date'],'%Y-%m-%d').date() < sk_win_start: continue
        d_o = next((d for d in duties if d['id']==int(s['duty_id'])),None)
        if not d_o or d_o.get('is_special') or d_o.get('is_off_balance'): continue
        eid = int(s['employee_id'])
        if eid in sk_fin and is_scoreable_day(s['date'], special_dates_set): sk_fin[eid] += 1
    
    s_sk_fin = sorted(sk_fin.items(), key=lambda x:x[1])
    if s_sk_fin:
         log(f"   🏁 [Final SK Balance] Min: {s_sk_fin[0][1]} | Max: {s_sk_fin[-1][1]} | Range: {s_sk_fin[-1][1] - s_sk_fin[0][1]}")
         log(f"   🏁 [Final SK Scores]: {[(emp_map.get(k, k), v) for k,v in s_sk_fin]}")

    log(f"✅ Ολοκληρώθηκε (Έγιναν {sk_swaps} αλλαγές).")

    # --- PHASE 7: Off-Balance Duties (Assignments & Balancing) ---
    log("▶️ Φάση 7: Ανάθεση & Εξισορρόπηση Υπηρεσιών Εκτός Ισοζυγίου...")
    
    off_weekly = [d for d in duties if d.get('is_weekly') and d.get('is_off_balance') and not d.get('is_special')]
    for duty in off_weekly:
        for sh_idx in range(duty['shifts_per_day']):
            curr = start_date
            while curr <= end_date:
                if curr.weekday() == duty['shift_config'][sh_idx]['day_index']:
                    d_str = curr.strftime('%Y-%m-%d')
                    if not any(s['date'] == d_str and int(s['duty_id']) == duty['id'] for s in schedule):
                        def_emp = duty['shift_config'][sh_idx].get('default_employee_id')
                        chosen = def_emp if def_emp and (def_emp,d_str) not in unavail_map and not is_user_busy(def_emp, curr, schedule, False) else None
                        if not chosen:
                             excl = [int(x) for x in duty['shift_config'][sh_idx].get('excluded_ids', [])]
                             cq, nq = get_q(f"weekly_off_{duty['id']}_{sh_idx}", excl)
                             for c in cq+nq:
                                 if (c,d_str) not in unavail_map and not is_user_busy(c, curr, schedule, False): chosen=c; break
                        if chosen: schedule.append({"date": d_str, "duty_id": duty['id'], "shift_index": 0, "employee_id": chosen, "manually_locked": False})
                curr += timedelta(days=1)

    off_daily = [d for d in duties if not d.get('is_weekly') and d.get('is_off_balance') and not d.get('is_special')]
    curr = start_date
    while curr <= end_date:
         d_str = curr.strftime('%Y-%m-%d')
         for duty in off_daily:
             if is_in_period(curr, duty.get('active_range')):
                  for i in range(duty['shifts_per_day']):
                      if not duty['shift_config'][i].get('is_within_hours') and is_in_period(curr, duty['shift_config'][i].get('active_range')):
                          if not any(s['date']==d_str and int(s['duty_id'])==int(duty['id']) and int(s['shift_index'])==i for s in schedule):
                                log(f"      [Phase 7] Checking {d_str} for {duty['name']}...")
                                chosen = None
                                
                                excl = [int(x) for x in duty['shift_config'][i].get('excluded_ids', [])]
                                cq, nq = get_q(f"off_{duty['id']}_{i}", excl)
                                for c in cq+nq:
                                    if (c,d_str) not in unavail_map and not is_user_busy(c, curr, schedule, False): chosen=c; break
                                
                                if chosen:
                                    schedule.append({"date": d_str, "duty_id": duty['id'], "shift_index": i, "employee_id": chosen, "manually_locked": False})
                                    rotate_assigned_user(f"off_{duty['id']}_{i}", chosen)
         curr += timedelta(days=1)

    off_ids = [d['id'] for d in duties if d.get('is_off_balance') and not d.get('is_special')]
    if off_ids:
        run_balance(off_ids, "Υπηρεσιών Εκτός Ισοζυγίου (Final)")

    # --- PHASE 8: Final Weekday Balancing ---
    log("▶️ Φάση 8: Τελική Εξισορρόπηση (Μόνο Καθημερινές)...")
    if normal_duty_ids: 
        run_balance(normal_duty_ids, "Κανονικών Υπηρεσιών (Weekday Only)")
    if off_balance_duty_ids:
        run_balance(off_balance_duty_ids, "Υπηρεσιών Εκτός Ισοζυγίου (Weekday Only)")

    log("✅ Ο Χρονοπρογραμματισμός ολοκληρώθηκε επιτυχώς.")
    return schedule, {"rotation_queues": rot_q, "next_round_queues": nxt_q, "logs": logs}
