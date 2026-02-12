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
        s_parts = str(range_config['start']).strip().replace('/','-').split('-')
        e_parts = str(range_config['end']).strip().replace('/','-').split('-')
        s_day, s_month = int(s_parts[0]), int(s_parts[1])
        e_day, e_month = int(e_parts[0]), int(e_parts[1])
        start_date = dt(y, s_month, s_day).date()
        end_date = dt(y, e_month, e_day).date()
        if start_date > end_date: return date_obj >= start_date or date_obj <= end_date
        else: return start_date <= date_obj <= end_date
    except: return True 

def is_scoreable_day(d_date, special_dates_set):
    if isinstance(d_date, str): d_date = dt.strptime(d_date, '%Y-%m-%d').date()
    _, _, iso_day = d_date.isocalendar()
    if iso_day in [6, 7]: return True
    if str(d_date) in special_dates_set: return True
    return False

def get_staff_users(cursor):
    cursor.execute("SELECT id, name, surname, seniority FROM users WHERE role = 'staff' ORDER BY seniority ASC, id ASC")
    users = cursor.fetchall()
    return [{'id': int(u['id']), 'name': f"{u['name']} {u['surname'] or ''}".strip()} for u in users]

def load_state_for_scheduler(start_date=None, *args, **kwargs):
    conn = get_db()
    if not conn: return None
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    # --- AUTO-INIT: Ensure Scheduler State Table Exists ---
    try:
        cur.execute("CREATE TABLE IF NOT EXISTS scheduler_state (id SERIAL PRIMARY KEY, rotation_queues JSONB, next_round_queues JSONB)")
        cur.execute("INSERT INTO scheduler_state (id, rotation_queues, next_round_queues) VALUES (1, '{}', '{}') ON CONFLICT (id) DO NOTHING")
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
    
    cur.execute("SELECT * FROM scheduler_state WHERE id = 1")
    state = cur.fetchone()
    
    special_dates = []
    try:
        cur.execute("SELECT date FROM special_dates")
        rows = cur.fetchall()
        special_dates = [str(r['date']) for r in rows]
    except: pass
    
    preferences = {}
    if start_date:
        try:
            m_str = start_date.strftime('%Y-%m')
            cur.execute("CREATE TABLE IF NOT EXISTS user_preferences (user_id INTEGER, month_str TEXT, prefer_double_sk BOOLEAN, PRIMARY KEY (user_id, month_str))")
            conn.commit()
            cur.execute("SELECT user_id FROM user_preferences WHERE month_str = %s AND prefer_double_sk = true", (m_str,))
            rows = cur.fetchall()
            for r in rows: preferences[int(r['user_id'])] = True
        except: pass

    conn.close()
    rot_q = state['rotation_queues'] if state and state['rotation_queues'] else {}
    next_q = state['next_round_queues'] if state and state['next_round_queues'] else {}
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

    # 4. Clean up
    final_stats = []
    for s in stats.values():
        del s['_seen_weeks']
        final_stats.append(s)

    return final_stats

# ==========================================
# 6. SCHEDULER ALGORITHM (TRANSLATED & CLEAN LOGS)
# ==========================================
def run_auto_scheduler_logic(db, start_date, end_date):
    logs = []
    
    def log(msg):
        logs.append(msg)
        print(f"[SCHEDULER] {msg}", flush=True) 
    
    employees = [{'id': int(e['id']), 'name': e['name']} for e in db['employees']]
    emp_map = {e['id']: e['name'] for e in employees}
    double_duty_prefs = db.get('preferences', {})
    
    if not employees:
        log("❌ ΣΦΑΛΜΑ: Δεν βρέθηκαν υπάλληλοι.")
        return [], {"rotation_queues": {}, "next_round_queues": {}, "logs": logs}
    
    log(f"🏁 Εκκίνηση Χρονοπρογραμματιστή για {start_date.strftime('%Y-%m')}")
    
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
    def is_user_busy(eid, check_date, current_schedule, ignore_yesterday=False):
        d_str = check_date.strftime('%Y-%m-%d')
        prev_str = (check_date - timedelta(days=1)).strftime('%Y-%m-%d')
        next_str = (check_date + timedelta(days=1)).strftime('%Y-%m-%d')
        for s in current_schedule + history:
            if int(s['employee_id']) == eid:
                # Only normal and weekly duties count — off-balance and special are ignored
                d_o = next((d for d in duties if d['id']==int(s['duty_id'])), None)
                if d_o and (d_o.get('is_off_balance') or d_o.get('is_special')): continue
                if s['date'] == d_str: return "Εργάζεται"
                if not ignore_yesterday and s['date'] == prev_str: return "Εργάστηκε Χθες"
                if s['date'] == next_str: return "Εργάζεται Αύριο"
        return False

    def get_q(key, excluded_ids=[]):
        cq = rot_q.get(key, []); nq = nxt_q.get(key, [])
        valid_ids = set(e['id'] for e in employees)
        cq = [int(x) for x in cq if int(x) in valid_ids and int(x) not in excluded_ids]
        nq = [int(x) for x in nq if int(x) in valid_ids and int(x) not in excluded_ids]
        known = set(cq) | set(nq)
        missing = [e['id'] for e in employees if e['id'] not in known and e['id'] not in excluded_ids]
        if missing: cq.extend(missing)
        if not cq: 
            if nq: cq = [e['id'] for e in employees if e['id'] in nq]; nq = []
            else: cq = [e['id'] for e in employees if e['id'] not in excluded_ids]
        rot_q[key] = cq; nxt_q[key] = nq
        return cq, nq

    def rotate_assigned_user(key, user_id):
        cq = rot_q.get(key, []); nq = nxt_q.get(key, [])
        cq = [int(x) for x in cq]; nq = [int(x) for x in nq]
        if user_id in cq: cq.remove(user_id); nq.append(user_id)
        elif user_id in nq: nq.remove(user_id); nq.append(user_id)
        rot_q[key] = cq; nxt_q[key] = nq

    # --- PHASE 0: Workhours ---
    workhour_slots = []
    for duty in duties:
        if duty.get('is_special'): continue
        for sh_idx in range(duty['shifts_per_day']):
            if duty['shift_config'][sh_idx].get('is_within_hours'): workhour_slots.append({'duty': duty, 'sh_idx': sh_idx, 'conf': duty['shift_config'][sh_idx]})
    
    curr = start_date
    while curr <= end_date:
        d_str = curr.strftime('%Y-%m-%d')
        for slot in workhour_slots:
            duty = slot['duty']; sh_idx = slot['sh_idx']; conf = slot['conf']
            if not is_in_period(curr, duty.get('active_range')) or not is_in_period(curr, conf.get('active_range')): continue
            if any(s['date']==d_str and int(s['duty_id'])==int(duty['id']) and int(s['shift_index'])==sh_idx for s in schedule): continue
            if duty.get('is_weekly') and curr.weekday()==6 and not is_in_period(curr, duty.get('sunday_active_range')): continue
            
            chosen_id = None
            default_id = conf.get('default_employee_id')
            default_excluded = default_id in [int(x) for x in conf.get('excluded_ids',[])]
            needs_cover = not default_id or (default_id, d_str) in unavail_map or is_user_busy(default_id, curr, schedule, True) or (is_scoreable_day(curr, special_dates_set) and default_excluded)
            if not needs_cover: chosen_id = default_id
            if not chosen_id:
                cq, nq = get_q(f"cover_{duty['id']}_{sh_idx}", [int(x) for x in conf.get('excluded_ids',[])])
                for cand in (cq+nq):
                    if (cand, d_str) not in unavail_map and not is_user_busy(cand, curr, schedule, False): chosen_id = cand; break
                if chosen_id: rotate_assigned_user(f"cover_{duty['id']}_{sh_idx}", chosen_id)
            if chosen_id: schedule.append({"date": d_str, "duty_id": duty['id'], "shift_index": sh_idx, "employee_id": chosen_id, "manually_locked": False})
            else: log(f"⚠️ {d_str} {duty['name']}: Δεν βρέθηκε διαθέσιμος υπάλληλος (Ωράριο).")
        curr += timedelta(days=1)

    # --- PHASE 1: Weekly ---
    log("▶️ Φάση 1: Ανάθεση Εβδομαδιαίων Υπηρεσιών...")
    for duty in [d for d in duties if d.get('is_weekly') and not d.get('is_special')]:
        for sh_idx in range(duty['shifts_per_day']):
            if duty['shift_config'][sh_idx].get('is_within_hours'): continue
            q_key = f"weekly_{duty['id']}_sh_{sh_idx}"; excl = [int(x) for x in duty['shift_config'][sh_idx].get('excluded_ids', [])]
            curr = start_date
            while curr <= end_date:
                w_start = curr - timedelta(days=curr.weekday()); w_end = w_start + timedelta(days=6)
                chosen = None

                # Continuity Check
                if w_start < start_date:
                    prev_day = start_date - timedelta(days=1)
                    p_str = prev_day.strftime('%Y-%m-%d')
                    for h in db['schedule']: 
                        if h['date'] == p_str and int(h['duty_id']) == int(duty['id']) and int(h.get('shift_index',0)) == sh_idx:
                            chosen = int(h['employee_id'])
                            break
                
                if not chosen:
                    cq, nq = get_q(q_key, excl)
                    for cand in (cq+nq):
                        if (cand, curr.strftime('%Y-%m-%d')) not in unavail_map: chosen = cand; break
                    if chosen: rotate_assigned_user(q_key, chosen)

                if chosen:
                    t = curr
                    while t <= w_end and t <= end_date:
                        if not (t.weekday()==6 and not is_in_period(t, duty.get('sunday_active_range'))):
                            if not any(s['date']==t.strftime('%Y-%m-%d') and int(s['duty_id'])==int(duty['id']) and int(s['shift_index'])==sh_idx for s in schedule):
                                schedule.append({"date": t.strftime('%Y-%m-%d'), "duty_id": duty['id'], "shift_index": sh_idx, "employee_id": chosen, "manually_locked": False})
                        t += timedelta(days=1)
                else:
                    log(f"⚠️ {curr.strftime('%Y-%m-%d')} {duty['name']}: Δεν βρέθηκε διαθέσιμος υπάλληλος για εβδομαδιαία.")
                curr = w_end + timedelta(days=1)

    # --- PHASE 2: Daily ---
    log("▶️ Φάση 2: Ανάθεση Καθημερινών Υπηρεσιών...")
    curr = start_date
    while curr <= end_date:
        d_str = curr.strftime('%Y-%m-%d')
        slots = []
        for d in [x for x in duties if not x.get('is_weekly') and not x.get('is_special')]:
             if is_in_period(curr, d.get('active_range')):
                 for i in range(d['shifts_per_day']):
                     if not d['shift_config'][i].get('is_within_hours') and is_in_period(curr, d['shift_config'][i].get('active_range')):
                         if not any(s['date']==d_str and int(s['duty_id'])==int(d['id']) and int(s['shift_index'])==i for s in schedule):
                             slots.append({'d':d, 'i':i, 'c':d['shift_config'][i]})
        random.shuffle(slots)
        for x in slots:
            cq, nq = get_q(f"normal_{x['d']['id']}_sh_{x['i']}", [int(z) for z in x['c'].get('excluded_ids',[])])
            chosen = None
            for cand in (cq+nq):
                if (cand, d_str) not in unavail_map and not is_user_busy(cand, curr, schedule, False): chosen = cand; break
            if chosen:
                rotate_assigned_user(f"normal_{x['d']['id']}_sh_{x['i']}", chosen)
                schedule.append({"date": d_str, "duty_id": x['d']['id'], "shift_index": x['i'], "employee_id": chosen, "manually_locked": False})
            else: log(f"⚠️ {d_str} {x['d']['name']}: Δεν βρέθηκε διαθέσιμος υπάλληλος.")
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
        log(f"⚖️ Εξισορρόπηση {label}...")
        
        swaps_performed = 0
        stagnation_limit = 3
        stagnation_count = 0
        
        for iteration in range(500): 
            sc = get_detailed_scores(target)
            s_ids = sorted(sc.keys(), key=lambda k: sc[k])
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
                donor_shifts = [c for c in donor_shifts if start_date <= dt.strptime(c['date'], '%Y-%m-%d').date() <= end_date]
                random.shuffle(donor_shifts)
                
                if not donor_shifts: continue

                for shift in donor_shifts:
                    s_date = dt.strptime(shift['date'], '%Y-%m-%d').date()
                    d_obj = next((d for d in duties if d['id']==int(shift['duty_id'])),None)
                    conf = d_obj.get('shift_config', [{}])[int(shift.get('shift_index',0))] if d_obj else {}
                    
                    if conf.get('is_within_hours') and conf.get('default_employee_id')==donor_id and not is_scoreable_day(s_date, special_dates_set): 
                        if stagnation_count >= stagnation_limit: diagnostics.append(f"Βάρδια {shift['date']}: Κλειδωμένο Ωράριο")
                        continue
                    
                    if d_obj and d_obj.get('is_weekly'): 
                        if stagnation_count >= stagnation_limit: diagnostics.append(f"Βάρδια {shift['date']}: Κλειδωμένη Εβδομαδιαία")
                        continue
                    
                    valid_receivers = [uid for uid in s_ids if sc[uid] < sc[donor_id] - 1]
                    
                    for rec_id in valid_receivers:
                        if rec_id == donor_id: continue
                        if rec_id in [int(x) for x in conf.get('excluded_ids',[])]: 
                            if stagnation_count >= stagnation_limit: diagnostics.append(f"Ο/Η {emp_map[rec_id]} Εξαιρείται")
                            continue
                        if (rec_id, shift['date']) in unavail_map: 
                            if stagnation_count >= stagnation_limit: diagnostics.append(f"Ο/Η {emp_map[rec_id]} έχει δηλώσει κώλυμα στις {shift['date']}")
                            continue
                        
                        busy_status = is_user_busy(rec_id, s_date, schedule, False)
                        if busy_status: 
                            if stagnation_count >= stagnation_limit: diagnostics.append(f"Ο/Η {emp_map[rec_id]} {busy_status} στις {shift['date']}")
                            continue
                        
                        shift['employee_id'] = rec_id
                        swaps_performed += 1
                        move_made = True
                        stagnation_count = 0 
                        break 
                    if move_made: break 
                if move_made: break 
            
            if not move_made:
                stagnation_count += 1
                if stagnation_count > stagnation_limit:
                    log(f"⚠️ Η Εξισορρόπηση σταμάτησε (Διαφορά: {diff}). Αιτίες που δεν μειώθηκε η διαφορά:")
                    for d in list(set(diagnostics))[:5]: 
                        log(f"      - {d}")
                    break

    run_balance([d['id'] for d in duties if not d.get('is_off_balance') and not d.get('is_special')], "Κανονικών Υπηρεσιών")
    run_balance([d['id'] for d in duties if d.get('is_off_balance') and not d.get('is_special')], "Υπηρεσιών Εκτός Ισοζυγίου")

    # --- PHASE 5: SK Balancing ---
    log("▶️ Φάση 5: Εξισορρόπηση Σαββατοκύριακων...")
    sk_swaps = 0
    sk_win_start = (end_date - relativedelta(months=5)).replace(day=1)
    
    # Determine employees excluded from ALL shifts of ALL normal duties
    normal_duties = [d for d in duties if not d.get('is_off_balance') and not d.get('is_special')]
    sk_excluded = set(e['id'] for e in employees)
    for d in normal_duties:
        for conf in d.get('shift_config', [{}]):
            exc = set(int(x) for x in conf.get('excluded_ids', []))
            sk_excluded -= (set(e['id'] for e in employees) - exc)
    
    for _ in range(200):
        sk = {e['id']: 0 for e in employees if e['id'] not in sk_excluded}
        for s in history+schedule:
            if dt.strptime(s['date'],'%Y-%m-%d').date() < sk_win_start: continue
            d_o = next((d for d in duties if d['id']==int(s['duty_id'])),None)
            if not d_o or d_o.get('is_special') or d_o.get('is_off_balance'): continue
            eid = int(s['employee_id'])
            if eid in sk and is_scoreable_day(s['date'], special_dates_set): sk[eid] += 1
        
        s_sk = sorted(sk.items(), key=lambda x:x[1])
        if s_sk[-1][1] - s_sk[0][1] <= 1: break
        
        swapped = False
        for i in range(len(s_sk)-1, 0, -1):
            max_id = s_sk[i][0]
            for j in range(i):
                min_id = s_sk[j][0]
                if sk[max_id] - sk[min_id] <= 1: continue
                
                max_we = [s for s in schedule if int(s['employee_id'])==max_id and is_scoreable_day(s['date'], special_dates_set) and not s.get('manually_locked')]
                max_we = [s for s in max_we if not any(d['id']==int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special') or d.get('is_off_balance')) for d in duties)]
                
                min_wd = [s for s in schedule if int(s['employee_id'])==min_id and not is_scoreable_day(s['date'], special_dates_set) and not s.get('manually_locked')]
                min_wd = [s for s in min_wd if not any(d['id']==int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special') or d.get('is_off_balance')) for d in duties)]
                
                random.shuffle(max_we); random.shuffle(min_wd)
                for we in max_we:
                    # Check min_id is not excluded from this specific shift
                    we_d = next((d for d in duties if d['id']==int(we['duty_id'])), None)
                    we_conf = we_d.get('shift_config', [{}])[int(we.get('shift_index',0))] if we_d else {}
                    if min_id in [int(x) for x in we_conf.get('excluded_ids', [])]: continue
                    if (min_id, we['date']) in unavail_map or is_user_busy(min_id, dt.strptime(we['date'],'%Y-%m-%d').date(), schedule, False): continue
                    for wd in min_wd:
                        # Check max_id is not excluded from this specific shift
                        wd_d = next((d for d in duties if d['id']==int(wd['duty_id'])), None)
                        wd_conf = wd_d.get('shift_config', [{}])[int(wd.get('shift_index',0))] if wd_d else {}
                        if max_id in [int(x) for x in wd_conf.get('excluded_ids', [])]: continue
                        if (max_id, wd['date']) in unavail_map or is_user_busy(max_id, dt.strptime(wd['date'],'%Y-%m-%d').date(), schedule, False): continue
                        we['employee_id'] = min_id; wd['employee_id'] = max_id
                        swapped = True; sk_swaps += 1; break
                    if swapped: break
                if swapped: break
            if swapped: break
        if not swapped:
            # Log diagnostics for why no swap was possible
            max_id = s_sk[-1][0]; min_id = s_sk[0][0]
            log(f"⚠️ SK: Δεν βρέθηκε εφικτή ανταλλαγή. {emp_map.get(max_id,'?')} (SK:{sk[max_id]}) ↔ {emp_map.get(min_id,'?')} (SK:{sk[min_id]})")
            max_we_count = len([s for s in schedule if int(s['employee_id'])==max_id and is_scoreable_day(s['date'], special_dates_set) and not s.get('manually_locked') and not any(d['id']==int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special') or d.get('is_off_balance')) for d in duties)])
            min_wd_count = len([s for s in schedule if int(s['employee_id'])==min_id and not is_scoreable_day(s['date'], special_dates_set) and not s.get('manually_locked') and not any(d['id']==int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special') or d.get('is_off_balance')) for d in duties)])
            log(f"   ├─ {emp_map.get(max_id,'?')}: {max_we_count} διαθέσιμες ΣΚ βάρδιες")
            log(f"   └─ {emp_map.get(min_id,'?')}: {min_wd_count} διαθέσιμες καθημερινές βάρδιες")
            break
    log(f"✅ Ολοκληρώθηκε (Έγιναν {sk_swaps} αλλαγές).")

    # --- PHASE 6: Double Duty ---
    log("▶️ Φάση 6: Βελτιστοποίηση Διπλοβάρδιων (ΣΚ)...")
    dd_count = 0
    target_users = [uid for uid in double_duty_prefs if any(int(s['employee_id'])==uid for s in schedule)]
    for uid in target_users:
        my_we = [s for s in schedule if int(s['employee_id'])==uid and dt.strptime(s['date'],'%Y-%m-%d').date().weekday() in [5,6] and not any(d['id']==int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special') or d.get('is_off_balance')) for d in duties)]
        if len(my_we) != 2: continue
        d1 = dt.strptime(my_we[0]['date'], '%Y-%m-%d').date(); d2 = dt.strptime(my_we[1]['date'], '%Y-%m-%d').date()
        if abs((d1-d2).days) == 1: continue
        
        needed = d1 + timedelta(days=1) if d1.weekday()==5 else d1 - timedelta(days=1)
        target = next((s for s in schedule if s['date']==needed.strftime('%Y-%m-%d') and not s.get('manually_locked') and not any(d['id']==int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special') or d.get('is_off_balance')) for d in duties)), None)
        move = my_we[1]
        
        if not target:
             needed = d2 + timedelta(days=1) if d2.weekday()==5 else d2 - timedelta(days=1)
             target = next((s for s in schedule if s['date']==needed.strftime('%Y-%m-%d') and not s.get('manually_locked') and not any(d['id']==int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special') or d.get('is_off_balance')) for d in duties)), None)
             move = my_we[0]
        
        if target:
            oid = int(target['employee_id'])
            if (oid, move['date']) not in unavail_map and not is_user_busy(oid, dt.strptime(move['date'],'%Y-%m-%d').date(), schedule, False):
                 if (uid, target['date']) not in unavail_map and not is_user_busy(uid, dt.strptime(target['date'],'%Y-%m-%d').date(), schedule, False):
                     move['employee_id'] = oid; target['employee_id'] = uid
                     dd_count += 1
    log(f"✅ Ολοκληρώθηκε (Δημιουργήθηκαν {dd_count} διπλοβάρδιες).")

    log("✅ Ο Χρονοπρογραμματισμός ολοκληρώθηκε επιτυχώς.")
    return schedule, {"rotation_queues": rot_q, "next_round_queues": nxt_q, "logs": logs}