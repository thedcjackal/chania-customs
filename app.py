from dotenv import load_dotenv
load_dotenv()

import os
import json
import datetime
import random
import psycopg2
import traceback
from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime as dt, timedelta
from psycopg2.extras import RealDictCursor, Json

try:
    from dateutil.relativedelta import relativedelta
except ImportError:
    print("CRITICAL: 'python-dateutil' is missing. Run: pip install python-dateutil")
    exit(1)

app = Flask(__name__)
# Enable CORS for all routes, allowing specific origins
CORS(app, resources={r"/*": {"origins": ["https://customs-client.vercel.app", "http://localhost:3000"]}})

# ==========================================
# 1. DATABASE CONNECTION
# ==========================================
def get_db():
    url = os.environ.get('DATABASE_URL')
    if not url:
        print("❌ ERROR: DATABASE_URL environment variable is MISSING.")
        return None
    
    # Fix for Fly.io/Supabase providing 'postgres://' which some drivers dislike
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
        
    try:
        conn = psycopg2.connect(url)
        return conn
    except Exception as e:
        print(f"❌ DB Connection Failed: {e}")
        return None

# ==========================================
# 2. SHARED HELPER FUNCTIONS
# ==========================================

def is_in_period(date_obj, range_config, logs=None):
    if not range_config or not range_config.get('start') or not range_config.get('end'):
        return True 
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

def get_staff_users(cursor):
    cursor.execute("SELECT id, name, surname, seniority FROM users WHERE role = 'staff' ORDER BY seniority ASC, id ASC")
    users = cursor.fetchall()
    results = []
    for u in users:
        full_name = f"{u['name']} {u['surname'] or ''}".strip()
        results.append({
            'id': int(u['id']), 
            'name': full_name, 
            'seniority': u['seniority'] if u['seniority'] is not None else 999
        })
    return results

def is_scoreable_day(d_date, special_dates_set):
    """ Returns True if date is Saturday (6), Sunday (7), or in Special Dates. """
    if isinstance(d_date, str):
        d_date = dt.strptime(d_date, '%Y-%m-%d').date()
    
    # 1. Weekend Check
    _, _, iso_day = d_date.isocalendar()
    if iso_day in [6, 7]: return True
    
    # 2. Exact Date Check
    if str(d_date) in special_dates_set: return True
    
    # 3. Recurring Check (Year 2000)
    recurring_key = f"2000-{d_date.strftime('%m-%d')}"
    if recurring_key in special_dates_set: return True
    
    return False

# --- UI BALANCE CALCULATION ---
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
        for r in cur.fetchall(): 
            special_dates_set.add(str(r['date']))
    except: pass
    
    conn.close()

    if start_str and end_str:
        view_start = dt.strptime(start_str, '%Y-%m').date().replace(day=1)
        end_dt = dt.strptime(end_str, '%Y-%m').date()
        view_end = (end_dt + relativedelta(months=1)) - timedelta(days=1)
    else:
        view_start = dt.min.date()
        view_end = dt.max.date()

    stats = {}
    for e in employees:
        stats[e['id']] = {
            'name': e['name'], 
            'total': 0,             
            'total_off_balance': 0, 
            'effective_total': 0,   
            'sk_score': 0,          
            'duty_counts': {d['id']: 0 for d in duties},
            '_weekly_tracker': {d['id']: set() for d in duties if d.get('is_weekly')} 
        }

    for e in employees:
        eid_str = str(e['id'])
        for d in duties:
            for conf in d.get('shift_config', []):
                h = int(conf.get('handicaps', {}).get(eid_str, 0))
                if h > 0:
                    stats[e['id']]['effective_total'] += h

    for s in schedule:
        eid = s['employee_id']
        if not eid or eid not in stats: continue
        
        s_date = dt.strptime(str(s['date']), '%Y-%m-%d').date()
        
        if s_date < view_start or s_date > view_end:
            continue

        duty = next((d for d in duties if d['id'] == s['duty_id']), None)
        if not duty: continue
        
        shift_idx = s.get('shift_index', 0)
        conf = {}
        if duty.get('shift_config') and len(duty['shift_config']) > shift_idx:
            conf = duty['shift_config'][shift_idx]

        is_protected_default = False
        if conf.get('is_within_hours') and conf.get('default_employee_id') == eid:
            if not is_scoreable_day(s_date, special_dates_set):
                is_protected_default = True 

        if duty.get('is_weekly'):
            iso_year, iso_week, _ = s_date.isocalendar()
            week_id = (iso_year, iso_week)
            if week_id not in stats[eid]['_weekly_tracker'][duty['id']]:
                stats[eid]['duty_counts'][duty['id']] += 1
                stats[eid]['_weekly_tracker'][duty['id']].add(week_id)
            
            if not is_protected_default and is_scoreable_day(s_date, special_dates_set):
                if duty.get('is_off_balance'):
                    stats[eid]['total_off_balance'] += 1
                else:
                    stats[eid]['total'] += 1
                    stats[eid]['effective_total'] += 1
                
        elif duty.get('is_off_balance'): 
            stats[eid]['duty_counts'][duty['id']] += 1
            if not is_protected_default:
                stats[eid]['total_off_balance'] += 1
        else: 
            stats[eid]['duty_counts'][duty['id']] += 1
            if not is_protected_default:
                stats[eid]['total'] += 1
                stats[eid]['effective_total'] += 1

        is_normal = not duty.get('is_weekly') and not duty.get('is_special') and not duty.get('is_off_balance')
        if is_normal:
            if s_date.weekday() in [5, 6]:
                stats[eid]['sk_score'] += 1

    for eid, stat in stats.items():
        if '_weekly_tracker' in stat: del stat['_weekly_tracker']
                    
    return list(stats.values())

def load_state_for_scheduler(start_date=None):
    conn = get_db()
    if not conn: return None
    cur = conn.cursor(cursor_factory=RealDictCursor)
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
        special_dates = [str(r['date']) for r in cur.fetchall()]
    except: pass
    
    preferences = {}
    try:
        if start_date:
            m_str = start_date.strftime('%Y-%m')
            cur.execute("CREATE TABLE IF NOT EXISTS user_preferences (user_id INTEGER, month_str TEXT, prefer_double_sk BOOLEAN, PRIMARY KEY (user_id, month_str))")
            conn.commit()
            cur.execute("SELECT user_id FROM user_preferences WHERE month_str = %s AND prefer_double_sk = true", (m_str,))
            rows = cur.fetchall()
            for r in rows:
                preferences[int(r['user_id'])] = True
    except Exception as e:
        print(f"Error loading preferences: {e}")

    conn.close()
    rot_q = state['rotation_queues'] if state and state['rotation_queues'] else {}
    next_q = state['next_round_queues'] if state and state['next_round_queues'] else {}

    return {
        "employees": employees, 
        "service_config": {
            "duties": duties, "special_dates": special_dates, 
            "rotation_queues": rot_q, "next_round_queues": next_q
        }, 
        "schedule": schedule, "unavailability": unavail,
        "preferences": preferences
    }

# ==========================================
# 3. SCHEDULER LOGIC
# ==========================================
def run_auto_scheduler_logic(db, start_date, end_date):
    logs = []
    def log(msg): logs.append(msg)
    
    # SILENT LOGGING

    employees = [{'id': int(e['id']), 'name': e['name']} for e in db['employees']]
    emp_map = {e['id']: e['name'] for e in employees}
    double_duty_prefs = db.get('preferences', {})

    if not employees:
        log("❌ CRITICAL: No employees found.")
        return [], {"rotation_queues": {}, "next_round_queues": {}, "logs": logs}
    
    duties = db['service_config']['duties']
    special_dates_set = set(db['service_config'].get('special_dates', []))
    
    raw_schedule = db['schedule']; schedule = []; history = []
    cleaned = 0
    for s in raw_schedule:
        try:
            s_date = dt.strptime(s['date'], '%Y-%m-%d').date()
            if start_date <= s_date <= end_date:
                if not s.get('manually_locked'): cleaned += 1
                else: schedule.append(s)
            else: history.append(s)
        except: pass
    
    unavail_map = {(int(u['employee_id']), str(u['date'])) for u in db['unavailability']}
    rot_q = db['service_config']['rotation_queues']
    nxt_q = db['service_config']['next_round_queues']

    for d in duties:
        if d.get('shifts_per_day') is None: d['shifts_per_day'] = 1
        if d.get('shift_config') is None: d['shift_config'] = []
        while len(d['shift_config']) < d['shifts_per_day']: d['shift_config'].append({})

    def is_user_busy(eid, check_date, current_schedule, ignore_yesterday=False):
        d_str = check_date.strftime('%Y-%m-%d')
        prev_str = (check_date - timedelta(days=1)).strftime('%Y-%m-%d')
        for s in current_schedule + history:
            if int(s['employee_id']) == eid:
                if s['date'] == d_str: return "Busy Today"
                if not ignore_yesterday:
                    if s['date'] == prev_str: return "Worked Yesterday"
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

    # PHASE 0: Workhours
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
            needs_cover = is_scoreable_day(curr, special_dates_set) or not default_id or default_id in [int(x) for x in conf.get('excluded_ids',[])] or (default_id, d_str) in unavail_map or is_user_busy(default_id, curr, schedule, True)
            if not needs_cover: chosen_id = default_id
            if not chosen_id:
                cq, nq = get_q(f"cover_{duty['id']}_{sh_idx}", [int(x) for x in conf.get('excluded_ids',[])])
                for cand in (cq+nq):
                    if (cand, d_str) not in unavail_map and not is_user_busy(cand, curr, schedule, False): chosen_id = cand; break
                if chosen_id: rotate_assigned_user(f"cover_{duty['id']}_{sh_idx}", chosen_id)
            if chosen_id: schedule.append({"date": d_str, "duty_id": duty['id'], "shift_index": sh_idx, "employee_id": chosen_id, "manually_locked": False})
            else:
                log(f"⚠️ {d_str} {duty['name']} (Βάρδια {sh_idx+1}): Δεν βρέθηκε διαθέσιμος υπάλληλος.")
        curr += timedelta(days=1)

    # PHASE 1: Weekly
    for duty in [d for d in duties if d.get('is_weekly') and not d.get('is_special')]:
        for sh_idx in range(duty['shifts_per_day']):
            if duty['shift_config'][sh_idx].get('is_within_hours'): continue
            q_key = f"weekly_{duty['id']}_sh_{sh_idx}"; excl = [int(x) for x in duty['shift_config'][sh_idx].get('excluded_ids', [])]
            curr = start_date
            while curr <= end_date:
                w_start = curr - timedelta(days=curr.weekday()); w_end = w_start + timedelta(days=6)
                chosen = None; cq, nq = get_q(q_key, excl)
                for cand in (cq+nq):
                    if (cand, curr.strftime('%Y-%m-%d')) not in unavail_map: chosen = cand; break
                if chosen:
                    rotate_assigned_user(q_key, chosen)
                    t = curr
                    while t <= w_end and t <= end_date:
                        if not (t.weekday()==6 and not is_in_period(t, duty.get('sunday_active_range'))):
                            if not any(s['date']==t.strftime('%Y-%m-%d') and int(s['duty_id'])==int(duty['id']) and int(s['shift_index'])==sh_idx for s in schedule):
                                schedule.append({"date": t.strftime('%Y-%m-%d'), "duty_id": duty['id'], "shift_index": sh_idx, "employee_id": chosen, "manually_locked": False})
                        t += timedelta(days=1)
                else:
                     if curr <= end_date:
                        log(f"⚠️ Εβδομάδα {curr.strftime('%Y-%m-%d')} {duty['name']}: Δεν βρέθηκε διαθέσιμος υπάλληλος.")

                curr = w_end + timedelta(days=1)

    # PHASE 2: Daily
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
            else:
                log(f"⚠️ {d_str} {x['d']['name']} (Βάρδια {x['i']+1}): Δεν βρέθηκε διαθέσιμος υπάλληλος.")
        curr += timedelta(days=1)

    # Balancing Helpers
    lookback_date = (start_date - relativedelta(months=2)).replace(day=1)
    def get_detailed_scores(target_duties):
        sc = {e['id']: 0 for e in employees}
        for e in employees:
            eid_str = str(e['id'])
            for d in duties:
                if d['id'] in target_duties:
                    for c in d.get('shift_config',[]): sc[e['id']] += int(c.get('handicaps',{}).get(eid_str,0))
        for s in history + schedule:
            if int(s['duty_id']) not in target_duties: continue
            s_d = dt.strptime(s['date'], '%Y-%m-%d').date()
            if s_d < lookback_date or s_d > end_date: continue
            d_o = next((d for d in duties if d['id']==int(s['duty_id'])), None)
            conf = d_o['shift_config'][int(s.get('shift_index',0))]
            if conf.get('is_within_hours') and conf.get('default_employee_id')==int(s['employee_id']) and not is_scoreable_day(s_d, special_dates_set): continue
            sc[int(s['employee_id'])] += 1
        return sc

    def run_balance(target):
        for _ in range(100):
            sc = get_detailed_scores(target)
            s_ids = sorted(sc.keys(), key=lambda k: sc[k])
            if sc[s_ids[-1]] - sc[s_ids[0]] <= 1: break
            max_id = s_ids[-1]
            cands = [s for s in schedule if int(s['employee_id'])==max_id and int(s['duty_id']) in target and not s.get('manually_locked')]
            cands = [c for c in cands if start_date <= dt.strptime(c['date'], '%Y-%m-%d').date() <= end_date]
            random.shuffle(cands); swapped = False
            for target_id in s_ids[:len(s_ids)//2+1]:
                if target_id == max_id or sc[max_id] <= sc[target_id]: continue
                for c in cands:
                    c_date = dt.strptime(c['date'], '%Y-%m-%d').date()
                    d_obj = next((d for d in duties if d['id']==int(c['duty_id'])),None)
                    conf = d_obj['shift_config'][int(c.get('shift_index',0))]
                    if conf.get('is_within_hours') and conf.get('default_employee_id')==max_id and not is_scoreable_day(c_date, special_dates_set): continue
                    if d_obj.get('is_weekly'): continue
                    if target_id in [int(x) for x in conf.get('excluded_ids',[])] or (target_id, c['date']) in unavail_map or is_user_busy(target_id, c_date, schedule, False): continue
                    c['employee_id'] = target_id; swapped = True; break
                if swapped: break
            if not swapped: break

    run_balance([d['id'] for d in duties if not d.get('is_off_balance') and not d.get('is_special')])
    run_balance([d['id'] for d in duties if d.get('is_off_balance') and not d.get('is_special')])

    # PHASE 5: SK Balancing
    sk_win_start = (end_date - relativedelta(months=5)).replace(day=1)
    for _ in range(200):
        sk = {e['id']: 0 for e in employees}
        for s in history+schedule:
            if dt.strptime(s['date'],'%Y-%m-%d').date() < sk_win_start: continue
            d_o = next((d for d in duties if d['id']==int(s['duty_id'])),None)
            if not d_o or d_o.get('is_weekly') or d_o.get('is_special') or d_o.get('is_off_balance'): continue
            if dt.strptime(s['date'],'%Y-%m-%d').date().weekday() in [5,6]: sk[int(s['employee_id'])] += 1
        
        s_sk = sorted(sk.items(), key=lambda x:x[1])
        if s_sk[-1][1] - s_sk[0][1] <= 1: break
        
        swapped = False
        for i in range(len(s_sk)-1, 0, -1):
            max_id = s_sk[i][0]
            for j in range(i):
                min_id = s_sk[j][0]
                if sk[max_id] - sk[min_id] <= 1: continue
                
                max_we = [s for s in schedule if int(s['employee_id'])==max_id and dt.strptime(s['date'],'%Y-%m-%d').date().weekday() in [5,6] and not s.get('manually_locked')]
                max_we = [s for s in max_we if not any(d['id']==int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special') or d.get('is_off_balance')) for d in duties)]
                
                min_wd = [s for s in schedule if int(s['employee_id'])==min_id and dt.strptime(s['date'],'%Y-%m-%d').date().weekday() not in [5,6] and not s.get('manually_locked')]
                min_wd = [s for s in min_wd if not any(d['id']==int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special') or d.get('is_off_balance')) for d in duties)]
                
                random.shuffle(max_we); random.shuffle(min_wd)
                for we in max_we:
                    if (min_id, we['date']) in unavail_map or is_user_busy(min_id, dt.strptime(we['date'],'%Y-%m-%d').date(), schedule, False): continue
                    for wd in min_wd:
                        if (max_id, wd['date']) in unavail_map or is_user_busy(max_id, dt.strptime(wd['date'],'%Y-%m-%d').date(), schedule, False): continue
                        we['employee_id'] = min_id; wd['employee_id'] = max_id
                        swapped = True; break
                    if swapped: break
                if swapped: break
            if swapped: break
        if not swapped: break

    # PHASE 6: Double Duty
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

    return schedule, {"rotation_queues": rot_q, "next_round_queues": nxt_q, "logs": logs}

# ==========================================
# 4. API ROUTES
# ==========================================

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    conn = get_db()
    if not conn: return jsonify({"error": "DB Error"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT * FROM users WHERE username = %s AND password = %s", (data.get('username'), data.get('password')))
        user = cur.fetchone()
        if user: return jsonify(user)
        return jsonify({"error": "Auth Failed"}), 401
    finally:
        conn.close()

@app.route('/admin/users', methods=['GET', 'POST', 'PUT', 'DELETE'])
def manage_users():
    conn = get_db()
    if not conn: return jsonify({"error": "DB Error"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'GET':
            cur.execute("SELECT * FROM users ORDER BY id")
            return jsonify(cur.fetchall())
        if request.method == 'POST':
            u = request.json
            cur.execute("""
                INSERT INTO users (username, password, role, name, surname, company, vessels, allowed_apps)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """, (u.get('username'), u.get('password'), u.get('role','user'), u.get('name',''), u.get('surname',''), u.get('company',''), u.get('vessels',[]), u.get('allowed_apps',[])))
            conn.commit()
            return jsonify({"success":True})
        if request.method == 'PUT':
            u = request.json
            cur.execute("""
                UPDATE users SET username=%s, password=%s, role=%s, name=%s, surname=%s, company=%s, vessels=%s, allowed_apps=%s
                WHERE id=%s
            """, (u.get('username'), u.get('password'), u.get('role','user'), u.get('name',''), u.get('surname',''), u.get('company',''), u.get('vessels',[]), u.get('allowed_apps',[]), u.get('id')))
            conn.commit()
            return jsonify({"success":True})
        if request.method == 'DELETE':
            cur.execute("DELETE FROM users WHERE id=%s", (request.args.get('id'),))
            conn.commit()
            return jsonify({"success":True})
    except Exception as e:
        conn.rollback(); return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/admin/employees', methods=['GET', 'PUT'])
def manage_employees():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'GET':
            return jsonify(get_staff_users(cur))
        
        if request.method == 'PUT':
            data = request.json
            if 'reorder' in data:
                for index, user_id in enumerate(data['reorder']):
                    cur.execute("UPDATE users SET seniority = %s WHERE id = %s", (index + 1, user_id))
                conn.commit()
                return jsonify({"success": True})
            return jsonify({"error": "Invalid data"}), 400
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/announcements', methods=['GET', 'POST', 'DELETE', 'PUT'])
def announcements():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Schema migration for new columns
        cur.execute("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS body TEXT")
        cur.execute("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_important BOOLEAN DEFAULT FALSE")
        conn.commit()

        if request.method == 'GET':
            cur.execute("SELECT * FROM announcements ORDER BY date DESC")
            res = cur.fetchall()
            for r in res: r['date'] = str(r['date'])
            return jsonify(res)
        if request.method == 'POST':
            data = request.json
            cur.execute("""
                INSERT INTO announcements (text, body, is_important, date) 
                VALUES (%s, %s, %s, CURRENT_DATE)
            """, (data.get('text'), data.get('body', ''), data.get('is_important', False)))
            conn.commit()
            return jsonify({"success":True})
        if request.method == 'PUT':
            data = request.json
            cur.execute("""
                UPDATE announcements SET text=%s, body=%s, is_important=%s WHERE id=%s
            """, (data.get('text'), data.get('body', ''), data.get('is_important', False), data.get('id')))
            conn.commit()
            return jsonify({"success": True})
        if request.method == 'DELETE':
            cur.execute("DELETE FROM announcements WHERE id = %s", (request.args.get('id'),))
            conn.commit()
            return jsonify({"success":True})
    finally:
        conn.close()

@app.route('/reservations', methods=['GET', 'POST', 'PUT', 'DELETE'])
def reservations():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'GET':
            query = "SELECT * FROM reservations WHERE 1=1"
            params = []
            if request.args.get('date'):
                query += " AND date = %s"
                params.append(request.args.get('date'))
            if request.args.get('company'):
                query += " AND user_company = %s"
                params.append(request.args.get('company'))
            cur.execute(query, tuple(params))
            rows = cur.fetchall()
            for r in rows: r['date'] = str(r['date'])
            return jsonify(rows)
        if request.method == 'POST':
            r = request.json
            cur.execute("""
                INSERT INTO reservations (date, vessel, user_company, supply_company, fuel_type, quantity, payment_method, mrn, status, flags, location_x, location_y, assigned_employee)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """, (r.get('date'), r.get('vessel'), r.get('user_company'), r.get('supply_company'), r.get('fuel_type'), r.get('quantity'), r.get('payment_method'), r.get('mrn'), 'OK', r.get('flags', []), r.get('location', {}).get('x',0), r.get('location', {}).get('y',0), r.get('assigned_employee')))
            conn.commit()
            return jsonify({"success":True})
        if request.method == 'PUT':
            rid = request.json.get('id')
            updates = request.json.get('updates', {})
            fields = []; vals = []
            for k, v in updates.items():
                if k == 'location':
                    fields.append("location_x=%s"); vals.append(v.get('x'))
                    fields.append("location_y=%s"); vals.append(v.get('y'))
                elif k != 'id':
                    fields.append(f"{k}=%s"); vals.append(v)
            if fields:
                vals.append(rid)
                cur.execute(f"UPDATE reservations SET {','.join(fields)} WHERE id=%s", tuple(vals))
                conn.commit()
            return jsonify({"success": True})
        if request.method == 'DELETE':
            cur.execute("DELETE FROM reservations WHERE id = %s", (request.args.get('id'),))
            conn.commit()
            return jsonify({"success": True})
    finally:
        conn.close()

@app.route('/daily_status', methods=['GET','POST'])
def daily_status():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'GET':
            cur.execute("SELECT * FROM daily_status WHERE date = %s", (request.args.get('date'),))
            res = cur.fetchone()
            return jsonify(res if res else {"finalized": False})
        if request.method == 'POST':
            cur.execute("""
                INSERT INTO daily_status (date, finalized) VALUES (%s, %s)
                ON CONFLICT (date) DO UPDATE SET finalized = EXCLUDED.finalized
            """, (request.json.get('date'), request.json.get('finalized')))
            conn.commit()
            return jsonify({"success": True})
    finally:
        conn.close()

# --- ADMIN SETTINGS ROUTES ---

@app.route('/admin/settings', methods=['GET', 'POST'])
def settings():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Ensure new columns exist (Migration logic)
        cur.execute("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS signee_name TEXT")
        cur.execute("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS declaration_deadline INTEGER")
        conn.commit()

        if request.method == 'GET':
            cur.execute("SELECT * FROM app_settings WHERE id = 1")
            row = cur.fetchone()
            # Fix serialization for time objects (Postgres TIME -> Python datetime.time)
            if row and row.get('lock_time'):
                row['lock_time'] = str(row['lock_time'])
            return jsonify(row)
            
        if request.method == 'POST':
            s = request.json
            cur.execute("""
                UPDATE app_settings 
                SET lock_days=%s, lock_time=%s, weekly_schedule=%s, declaration_deadline=%s, signee_name=%s
                WHERE id=1
            """, (s['lock_rules']['days_before'], s['lock_rules']['time'], Json(s['weekly_schedule']), s.get('declaration_deadline'), s.get('signee_name')))
            conn.commit()
            return jsonify(s)
    finally:
        conn.close()

@app.route('/admin/schedule_metadata', methods=['GET', 'POST'])
def schedule_metadata():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("CREATE TABLE IF NOT EXISTS schedule_metadata (month_str TEXT PRIMARY KEY, protocol_num TEXT, protocol_date TEXT)")
        conn.commit()

        if request.method == 'GET':
            m = request.args.get('month')
            cur.execute("SELECT * FROM schedule_metadata WHERE month_str = %s", (m,))
            return jsonify(cur.fetchone() or {})
        
        if request.method == 'POST':
            d = request.json
            cur.execute("""
                INSERT INTO schedule_metadata (month_str, protocol_num, protocol_date)
                VALUES (%s, %s, %s)
                ON CONFLICT (month_str) DO UPDATE 
                SET protocol_num = EXCLUDED.protocol_num, protocol_date = EXCLUDED.protocol_date
            """, (d['month'], d['protocol_num'], d['protocol_date']))
            conn.commit()
            return jsonify({"success": True})
    finally:
        conn.close()

@app.route('/admin/reference', methods=['GET', 'POST', 'PUT', 'DELETE'])
def reference():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'GET':
            cur.execute("SELECT companies, fuel_types FROM app_settings WHERE id = 1")
            res = cur.fetchone()
            return jsonify({"companies": res['companies'], "fuel_types": res['fuel_types']})
        if request.method == 'POST':
            typ = request.json.get('type') 
            val = request.json.get('value')
            if typ == 'companies':
                cur.execute("UPDATE app_settings SET companies = array_append(companies, %s) WHERE id=1", (val,))
            elif typ == 'fuel_types':
                cur.execute("UPDATE app_settings SET fuel_types = array_append(fuel_types, %s) WHERE id=1", (val,))
            conn.commit()
            return jsonify({"success": True})
        if request.method == 'DELETE':
            typ = request.args.get('type'); val = request.args.get('value')
            if typ == 'companies':
                cur.execute("UPDATE app_settings SET companies = array_remove(companies, %s) WHERE id=1", (val,))
            elif typ == 'fuel_types':
                cur.execute("UPDATE app_settings SET fuel_types = array_remove(fuel_types, %s) WHERE id=1", (val,))
            conn.commit()
            return jsonify({"success": True})
        return jsonify({})
    finally:
        conn.close()

@app.route('/admin/services/config', methods=['GET', 'POST'])
def config_route():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'GET':
            cur.execute("SELECT * FROM duties ORDER BY id")
            duties = cur.fetchall()
            cur.execute("SELECT * FROM scheduler_state WHERE id=1")
            state = cur.fetchone()
            
            special_dates = []
            try:
                cur.execute("SELECT * FROM special_dates ORDER BY date")
                rows = cur.fetchall()
                # Return list of objects {date, description}
                special_dates = [{'date': str(r['date']), 'description': r['description']} for r in rows]
            except: pass
            
            return jsonify({
                "duties": duties,
                "special_dates": special_dates,
                "rotation_queues": state['rotation_queues'] if state else {},
                "next_round_queues": state['next_round_queues'] if state else {}
            })
        if request.method == 'POST':
            new_duties = request.json.get('duties', [])
            for d in new_duties:
                safe_shifts = d.get('shifts_per_day')
                if safe_shifts is None: safe_shifts = 1
                
                if 'id' in d and d['id']:
                    cur.execute("""
                        UPDATE duties SET 
                        name=%s, shifts_per_day=%s, default_hours=%s, shift_config=%s, 
                        is_special=%s, is_weekly=%s, is_off_balance=%s, sunday_active_range=%s 
                        WHERE id=%s
                    """, (d['name'], safe_shifts, d['default_hours'], Json(d['shift_config']), d['is_special'], d['is_weekly'], d['is_off_balance'], Json(d.get('sunday_active_range', {})), d['id']))
                else:
                    cur.execute("""
                        INSERT INTO duties (name, shifts_per_day, default_hours, shift_config, is_special, is_weekly, is_off_balance, sunday_active_range)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """, (d['name'], safe_shifts, d['default_hours'], Json(d['shift_config']), d['is_special'], d['is_weekly'], d['is_off_balance'], Json(d.get('sunday_active_range', {}))))
            conn.commit()
            return jsonify({"success": True})
    finally:
        conn.close()

@app.route('/services/schedule', methods=['GET', 'POST'])
def schedule_route():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'GET':
            cur.execute("SELECT * FROM schedule ORDER BY date")
            rows = cur.fetchall()
            for r in rows: r['date'] = str(r['date'])
            return jsonify(rows)
        if request.method == 'POST':
            c = request.json
            cur.execute("""
                INSERT INTO schedule (date, duty_id, shift_index, employee_id, manually_locked)
                VALUES (%s, %s, %s, %s, true)
                ON CONFLICT (date, duty_id, shift_index) 
                DO UPDATE SET employee_id = EXCLUDED.employee_id, manually_locked = true
            """, (c.get('date'), c.get('duty_id'), c.get('shift_index'), c.get('employee_id')))
            conn.commit()
            return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        conn.close()

@app.route('/services/run_scheduler', methods=['POST'])
def run_scheduler_route():
    try:
        req = request.json
        try:
            start_date = dt.strptime(req['start'] + '-01', '%Y-%m-%d').date()
        except:
             return jsonify({"error": "Date Parsing Error"}), 400

        # Pass start_date to load preferences
        db = load_state_for_scheduler(start_date)
        if not db: return jsonify({"error": "DB Load Failed"}), 500

        end_date_month = dt.strptime(req['end'] + '-01', '%Y-%m-%d')
        end_date = (end_date_month + relativedelta(months=1) - timedelta(days=1)).date()
    except Exception as e:
        print(traceback.format_exc())
        return jsonify({"error": "Date Parsing Error", "details": str(e)}), 400
    
    try:
        new_schedule, res_meta = run_auto_scheduler_logic(db, start_date, end_date)
    except Exception as e:
        print("CRASH IN SCHEDULER LOGIC:")
        print(traceback.format_exc())
        return jsonify({"error": "Scheduler Algorithm Crash", "details": str(e)}), 500
    
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM schedule WHERE date >= %s AND date <= %s AND manually_locked = false", (start_date, end_date))
        
        values = []
        for s in new_schedule:
            try:
                s_date = dt.strptime(s['date'], '%Y-%m-%d').date()
                if start_date <= s_date <= end_date and not s.get('manually_locked'):
                    values.append((s['date'], s['duty_id'], s['shift_index'], s['employee_id'], False, False))
            except: pass
        
        if values:
            args_str = ','.join(cur.mogrify("(%s,%s,%s,%s,%s,%s)", x).decode('utf-8') for x in values)
            cur.execute("INSERT INTO schedule (date, duty_id, shift_index, employee_id, is_locked, manually_locked) VALUES " + args_str + " ON CONFLICT (date, duty_id, shift_index) DO NOTHING")

        cur.execute("UPDATE scheduler_state SET rotation_queues = %s, next_round_queues = %s WHERE id = 1", (Json(res_meta['rotation_queues']), Json(res_meta['next_round_queues'])))
        
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(traceback.format_exc())
        return jsonify({"error": "DB Save Error", "details": str(e)}), 500
    finally:
        conn.close()

    return jsonify({"success": True, "logs": res_meta['logs']})

@app.route('/services/balance', methods=['GET'])
def get_balance():
    # Pass params: start & end
    start_str = request.args.get('start')
    end_str = request.args.get('end')
    return jsonify(calculate_db_balance(start_str, end_str))

@app.route('/services/unavailability', methods=['GET', 'POST', 'DELETE'])
def s_unavail():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method=='GET':
            eid=request.args.get('employee_id')
            if eid: cur.execute("SELECT * FROM unavailability WHERE employee_id=%s", (eid,))
            else: cur.execute("SELECT * FROM unavailability")
            res = cur.fetchall()
            for r in res: r['date']=str(r['date'])
            return jsonify(res)
        if request.method=='POST':
            u=request.json
            cur.execute("INSERT INTO unavailability (employee_id, date) VALUES (%s, %s) ON CONFLICT DO NOTHING", (u.get('employee_id'), u.get('date')))
            conn.commit()
            return jsonify({"success":True})
        if request.method=='DELETE':
            cur.execute("DELETE FROM unavailability WHERE employee_id=%s AND date=%s", (request.args.get('employee_id'), request.args.get('date')))
            conn.commit()
            return jsonify({"success":True})
    finally:
        conn.close()

@app.route('/services/preferences', methods=['GET', 'POST'])
def s_prefs():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Ensure table exists
        cur.execute("CREATE TABLE IF NOT EXISTS user_preferences (user_id INTEGER, month_str TEXT, prefer_double_sk BOOLEAN, PRIMARY KEY (user_id, month_str))")
        conn.commit()

        if request.method == 'GET':
            uid = request.args.get('user_id')
            m_str = request.args.get('month')
            cur.execute("SELECT prefer_double_sk FROM user_preferences WHERE user_id = %s AND month_str = %s", (uid, m_str))
            res = cur.fetchone()
            return jsonify({"prefer_double_sk": res['prefer_double_sk'] if res else False})

        if request.method == 'POST':
            d = request.json
            cur.execute("""
                INSERT INTO user_preferences (user_id, month_str, prefer_double_sk) 
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, month_str) 
                DO UPDATE SET prefer_double_sk = EXCLUDED.prefer_double_sk
            """, (d['user_id'], d['month'], d['value']))
            conn.commit()
            return jsonify({"success": True})
    finally:
        conn.close()

@app.route('/services/clear_schedule', methods=['POST'])
def clear_schedule():
    conn = get_db()
    cur = conn.cursor()
    req = request.json
    try:
        start_date = dt.strptime(req['start_date'], '%Y-%m-%d').date() if len(req['start_date']) > 7 else dt.strptime(req['start_date'], '%Y-%m').date()
        end_date = dt.strptime(req['end_date'], '%Y-%m-%d').date() if len(req['end_date']) > 7 else (dt.strptime(req['end_date'], '%Y-%m') + relativedelta(months=1) - timedelta(days=1)).date()
        cur.execute("DELETE FROM schedule WHERE date >= %s AND date <= %s", (start_date, end_date))
        conn.commit()
        return jsonify({"success": True})
    finally:
        conn.close()

@app.route('/admin/special_dates', methods=['GET', 'POST', 'DELETE'])
def special_dates_route():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # FIX: Ensure table exists
        cur.execute("CREATE TABLE IF NOT EXISTS special_dates (date DATE PRIMARY KEY, description TEXT)")
        conn.commit()

        if request.method == 'GET':
            cur.execute("SELECT * FROM special_dates ORDER BY date")
            rows = cur.fetchall()
            for r in rows: r['date'] = str(r['date'])
            return jsonify(rows)
        if request.method == 'POST':
            d = request.json.get('date')
            desc = request.json.get('description', '')
            cur.execute("INSERT INTO special_dates (date, description) VALUES (%s, %s) ON CONFLICT (date) DO UPDATE SET description = EXCLUDED.description", (d, desc))
            conn.commit()
            return jsonify({"success": True})
        if request.method == 'DELETE':
            d = request.args.get('date')
            cur.execute("DELETE FROM special_dates WHERE date = %s", (d,))
            conn.commit()
            return jsonify({"success": True})
    finally:
        conn.close()

# --- DIRECTORY APP ROUTES ---
@app.route('/directory', methods=['GET'])
def get_directory():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 1. Update Schema: Add 'sequence' column if not exists
        cur.execute("CREATE TABLE IF NOT EXISTS directory_departments (id SERIAL PRIMARY KEY, name TEXT UNIQUE, sequence INTEGER DEFAULT 999)")
        cur.execute("CREATE TABLE IF NOT EXISTS directory_phones (id SERIAL PRIMARY KEY, dept_id INTEGER REFERENCES directory_departments(id) ON DELETE CASCADE, number TEXT, is_supervisor BOOLEAN DEFAULT FALSE)")
        
        # Migration: Ensure 'sequence' exists (safe to run multiple times)
        try:
            cur.execute("ALTER TABLE directory_departments ADD COLUMN IF NOT EXISTS sequence INTEGER DEFAULT 999")
            cur.execute("ALTER TABLE directory_phones DROP COLUMN IF EXISTS name") # Remove name column if it exists
        except: pass
        conn.commit()

        # Fetch ordered by sequence
        cur.execute("SELECT * FROM directory_departments ORDER BY sequence ASC, id ASC")
        depts = cur.fetchall()
        
        cur.execute("SELECT * FROM directory_phones ORDER BY is_supervisor DESC, id ASC")
        phones = cur.fetchall()
        
        result = []
        for d in depts:
            d_phones = [p for p in phones if p['dept_id'] == d['id']]
            result.append({**d, 'phones': d_phones})
            
        return jsonify(result)
    finally:
        conn.close()

@app.route('/directory/departments', methods=['POST', 'PUT', 'DELETE'])
def manage_departments():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'POST':
            # Handle Reordering
            if request.json.get('action') == 'reorder':
                id_list = request.json.get('ordered_ids', [])
                for idx, dept_id in enumerate(id_list):
                    cur.execute("UPDATE directory_departments SET sequence = %s WHERE id = %s", (idx, dept_id))
                conn.commit()
                return jsonify({"success": True})
            
            # Normal Create
            name = request.json.get('name')
            # Set sequence to max + 1
            cur.execute("SELECT COALESCE(MAX(sequence), 0) + 1 as next_seq FROM directory_departments")
            next_seq = cur.fetchone()['next_seq']
            cur.execute("INSERT INTO directory_departments (name, sequence) VALUES (%s, %s) RETURNING id", (name, next_seq))
            conn.commit()
            return jsonify({"success": True})

        if request.method == 'PUT':
            cur.execute("UPDATE directory_departments SET name = %s WHERE id = %s", (request.json.get('name'), request.json.get('id')))
            conn.commit()
            return jsonify({"success": True})

        if request.method == 'DELETE':
            cur.execute("DELETE FROM directory_departments WHERE id = %s", (request.args.get('id'),))
            conn.commit()
            return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/directory/phones', methods=['POST', 'PUT', 'DELETE'])
def manage_phones():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'POST':
            d = request.json
            # Name removed
            cur.execute("INSERT INTO directory_phones (dept_id, number, is_supervisor) VALUES (%s, %s, %s)", 
                        (d['dept_id'], d['number'], d.get('is_supervisor', False)))
            conn.commit()
            return jsonify({"success": True})
        if request.method == 'PUT':
            d = request.json
            cur.execute("UPDATE directory_phones SET number=%s, is_supervisor=%s WHERE id=%s", 
                        (d['number'], d.get('is_supervisor', False), d['id']))
            conn.commit()
            return jsonify({"success": True})
        if request.method == 'DELETE':
            cur.execute("DELETE FROM directory_phones WHERE id = %s", (request.args.get('id'),))
            conn.commit()
            return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)