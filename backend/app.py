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
CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

# ==========================================
# 1. DATABASE CONNECTION
# ==========================================
def get_db():
    url = os.environ.get('DATABASE_URL')
    if not url: return None
    try:
        return psycopg2.connect(url)
    except Exception as e:
        print(f"DB Connection Failed: {e}")
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
    _, _, iso_day = d_date.isocalendar()
    if iso_day in [6, 7]: return True
    if str(d_date) in special_dates_set: return True
    return False

# --- UI BALANCE CALCULATION ---
def calculate_db_balance():
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

    stats = {}
    for e in employees:
        stats[e['id']] = {
            'name': e['name'], 
            'total': 0,             # Normal Score (Main Balance)
            'total_off_balance': 0, # Off-Balance Score (Secondary Balance)
            'effective_total': 0,
            'duty_counts': {d['id']: 0 for d in duties},
            '_weekly_tracker': {d['id']: set() for d in duties if d.get('is_weekly')} 
        }

    for s in schedule:
        eid = s['employee_id']
        if not eid or eid not in stats: continue
        duty = next((d for d in duties if d['id'] == s['duty_id']), None)
        if not duty: continue
        s_date = dt.strptime(str(s['date']), '%Y-%m-%d').date()
        
        # Get Config
        shift_idx = s.get('shift_index', 0)
        conf = {}
        if duty.get('shift_config') and len(duty['shift_config']) > shift_idx:
            conf = duty['shift_config'][shift_idx]

        # Check Default Protection (Weekday Workhours)
        is_protected_default = False
        if conf.get('is_within_hours') and conf.get('default_employee_id') == eid:
            if not is_scoreable_day(s_date, special_dates_set):
                is_protected_default = True # 0 points

        if duty.get('is_weekly'):
            iso_year, iso_week, _ = s_date.isocalendar()
            week_id = (iso_year, iso_week)
            if week_id not in stats[eid]['_weekly_tracker'][duty['id']]:
                stats[eid]['duty_counts'][duty['id']] += 1
                stats[eid]['_weekly_tracker'][duty['id']].add(week_id)
            
            # Weekly Score Logic (Sat/Sun/Special)
            if not is_protected_default and is_scoreable_day(s_date, special_dates_set):
                if duty.get('is_off_balance'):
                    stats[eid]['total_off_balance'] += 1
                else:
                    stats[eid]['total'] += 1
                
        elif duty.get('is_off_balance'): 
            stats[eid]['duty_counts'][duty['id']] += 1
            if not is_protected_default:
                stats[eid]['total_off_balance'] += 1
        else: 
            # Normal Duty
            stats[eid]['duty_counts'][duty['id']] += 1
            if not is_protected_default:
                stats[eid]['total'] += 1

    for eid, stat in stats.items():
        # effective_total is primarily the Normal Score
        stat['effective_total'] = stat['total'] 
        if '_weekly_tracker' in stat: del stat['_weekly_tracker']
                    
    return list(stats.values())

def load_state_for_scheduler():
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

    conn.close()
    rot_q = state['rotation_queues'] if state and state['rotation_queues'] else {}
    next_q = state['next_round_queues'] if state and state['next_round_queues'] else {}

    return {
        "employees": employees, 
        "service_config": {
            "duties": duties, "special_dates": special_dates, 
            "rotation_queues": rot_q, "next_round_queues": next_q
        }, 
        "schedule": schedule, "unavailability": unavail
    }

# ==========================================
# 3. SCHEDULER LOGIC
# ==========================================
def run_auto_scheduler_logic(db, start_date, end_date):
    logs = []
    def log(msg): logs.append(msg)
    
    log(f"🚀 STARTING SCHEDULER: {start_date} to {end_date}")

    employees = [{'id': int(e['id']), 'name': e['name']} for e in db['employees']]
    emp_map = {e['id']: e['name'] for e in employees}
    if not employees:
        log("❌ CRITICAL: No employees found.")
        return [], {"rotation_queues": {}, "next_round_queues": {}, "logs": logs}
    
    duties = db['service_config']['duties']
    special_dates_set = set(db['service_config'].get('special_dates', []))
    log(f"   📅 Loaded {len(special_dates_set)} special dates.")

    # Clean Memory
    raw_schedule = db['schedule']
    schedule = [] 
    history = []
    cleaned = 0
    for s in raw_schedule:
        try:
            s_date = dt.strptime(s['date'], '%Y-%m-%d').date()
            if start_date <= s_date <= end_date:
                if not s.get('manually_locked'): cleaned += 1
                else: schedule.append(s)
            else: history.append(s)
        except: pass
    log(f"   🧹 Cleared {cleaned} old assignments.")

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
        cq = rot_q.get(key, [])
        nq = nxt_q.get(key, [])
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
        cq = rot_q.get(key, [])
        nq = nxt_q.get(key, [])
        cq = [int(x) for x in cq]; nq = [int(x) for x in nq]
        if user_id in cq: cq.remove(user_id); nq.append(user_id)
        elif user_id in nq: nq.remove(user_id); nq.append(user_id)
        rot_q[key] = cq; nxt_q[key] = nq

    # --- PHASE 0: ASSIGN WORKHOURS (PRIORITY) ---
    log("🔹 Phase 0: Workhours Assignments")
    
    workhour_slots = []
    for duty in duties:
        if duty.get('is_special'): continue
        for sh_idx in range(duty['shifts_per_day']):
            conf = duty['shift_config'][sh_idx]
            if conf.get('is_within_hours'):
                workhour_slots.append({'duty': duty, 'sh_idx': sh_idx, 'conf': conf})

    curr = start_date
    while curr <= end_date:
        d_str = curr.strftime('%Y-%m-%d')
        
        for slot in workhour_slots:
            duty = slot['duty']; sh_idx = slot['sh_idx']; conf = slot['conf']
            
            if not is_in_period(curr, duty.get('active_range')): continue
            if not is_in_period(curr, conf.get('active_range')): continue
            if any(s['date'] == d_str and int(s['duty_id']) == int(duty['id']) and int(s['shift_index']) == sh_idx for s in schedule): continue
            if duty.get('is_weekly') and curr.weekday() == 6 and not is_in_period(curr, duty.get('sunday_active_range')): continue

            default_id = conf.get('default_employee_id')
            excl_ids = [int(x) for x in conf.get('excluded_ids', [])]
            cover_key = f"cover_{duty['id']}_{sh_idx}"
            
            chosen_id = None
            needs_cover = False
            if is_scoreable_day(curr, special_dates_set): needs_cover = True
            elif not default_id: needs_cover = True
            elif default_id in excl_ids: needs_cover = True
            elif (default_id, d_str) in unavail_map: needs_cover = True
            elif is_user_busy(default_id, curr, schedule, ignore_yesterday=True): needs_cover = True
            
            if not needs_cover: chosen_id = default_id
            
            if not chosen_id:
                cq, nq = get_q(cover_key, excl_ids)
                candidates = cq + nq
                for cand in candidates:
                    if (cand, d_str) in unavail_map: continue
                    if is_user_busy(cand, curr, schedule, ignore_yesterday=False): continue
                    chosen_id = cand; break
                if chosen_id: rotate_assigned_user(cover_key, chosen_id)

            if chosen_id:
                schedule.append({"date": d_str, "duty_id": duty['id'], "shift_index": sh_idx, "employee_id": chosen_id, "manually_locked": False})
            else:
                log(f"   ⚠️ {d_str} {duty['name']}: No Workhours staff available.")

        curr += timedelta(days=1)

    # --- PHASE 1: WEEKLY DUTIES ---
    weekly_duties = [d for d in duties if d.get('is_weekly') and not d.get('is_special')]
    log(f"🔹 Phase 1: {len(weekly_duties)} Standard Weekly Duties")

    for duty in weekly_duties:
        for sh_idx in range(duty['shifts_per_day']):
            conf = duty['shift_config'][sh_idx]
            if conf.get('is_within_hours'): continue 

            q_key = f"weekly_{duty['id']}_sh_{sh_idx}"
            excl_ids = [int(x) for x in conf.get('excluded_ids', [])]
            
            last_week_end = start_date - timedelta(days=1)
            prev_assignment = next((s for s in (history+schedule) if s['date'] == last_week_end.strftime('%Y-%m-%d') and int(s['duty_id']) == int(duty['id']) and int(s['shift_index']) == sh_idx), None)
            
            if prev_assignment:
                prev_id = int(prev_assignment['employee_id'])
                cq, _ = get_q(q_key, excl_ids)
                if prev_id in cq and cq[0] == prev_id: rotate_assigned_user(q_key, prev_id)

            curr = start_date
            while curr <= end_date:
                days_since_mon = curr.weekday()
                week_start_mon = curr - timedelta(days=days_since_mon)
                week_end_sun = week_start_mon + timedelta(days=6)
                chosen_employee = None
                
                check_day = curr - timedelta(days=1)
                if check_day >= week_start_mon:
                    prev_s = next((s for s in (history+schedule) if s['date'] == check_day.strftime('%Y-%m-%d') and int(s['duty_id']) == int(duty['id']) and int(s['shift_index']) == sh_idx), None)
                    if prev_s: chosen_employee = int(prev_s['employee_id'])

                if not chosen_employee:
                    cq, nq = get_q(q_key, excl_ids)
                    candidates = cq + nq
                    for candidate in candidates:
                        d_str = curr.strftime('%Y-%m-%d')
                        if (candidate, d_str) in unavail_map: continue
                        chosen_employee = candidate; break
                    if chosen_employee: rotate_assigned_user(q_key, chosen_employee)

                if chosen_employee:
                    t_day = curr
                    while t_day <= week_end_sun and t_day <= end_date:
                        if t_day.weekday() == 6 and not is_in_period(t_day, duty.get('sunday_active_range')):
                            t_day += timedelta(days=1); continue
                        d_s = t_day.strftime('%Y-%m-%d')
                        if not any(s['date'] == d_s and int(s['duty_id']) == int(duty['id']) and int(s['shift_index']) == sh_idx for s in schedule):
                            schedule.append({"date": d_s, "duty_id": duty['id'], "shift_index": sh_idx, "employee_id": chosen_employee, "manually_locked": False})
                        t_day += timedelta(days=1)
                curr = week_end_sun + timedelta(days=1)

    # --- PHASE 2: DAILY DUTIES ---
    normal_duties = [d for d in duties if not d.get('is_weekly') and not d.get('is_special')]
    log(f"🔹 Phase 2: {len(normal_duties)} Standard Daily Duties")

    curr = start_date
    while curr <= end_date:
        d_str = curr.strftime('%Y-%m-%d')
        daily_slots = []
        for duty in normal_duties:
            if not is_in_period(curr, duty.get('active_range')): continue
            for sh_idx in range(duty['shifts_per_day']):
                conf = duty['shift_config'][sh_idx]
                if conf.get('is_within_hours'): continue 
                if not is_in_period(curr, conf.get('active_range')): continue
                if any(s['date'] == d_str and int(s['duty_id']) == int(duty['id']) and int(s['shift_index']) == sh_idx for s in schedule): continue
                daily_slots.append({'duty': duty, 'sh_idx': sh_idx, 'conf': conf})

        random.shuffle(daily_slots)

        for slot in daily_slots:
            duty = slot['duty']; sh_idx = slot['sh_idx']; conf = slot['conf']
            q_key = f"normal_{duty['id']}_sh_{sh_idx}"
            excl_ids = [int(x) for x in conf.get('excluded_ids', [])]
            cq, nq = get_q(q_key, excl_ids)
            chosen = None
            candidates = cq + nq
            for candidate in candidates:
                if (candidate, d_str) in unavail_map: continue
                if is_user_busy(candidate, curr, schedule, ignore_yesterday=False): continue
                chosen = candidate; break
            
            if chosen:
                rotate_assigned_user(q_key, chosen)
                schedule.append({"date": d_str, "duty_id": duty['id'], "shift_index": sh_idx, "employee_id": chosen, "manually_locked": False})
            else:
                log(f"   ⚠️ {d_str} {duty['name']}: No staff available.")
        curr += timedelta(days=1)

    # --- PHASE 3 & 4: DUAL BALANCING ---
    score_duties_normal = [d['id'] for d in duties if not d.get('is_off_balance') and not d.get('is_special')]
    score_duties_off = [d['id'] for d in duties if d.get('is_off_balance') and not d.get('is_special')]
    
    def get_detailed_scores(target_duties, return_details=False):
        scores = {e['id']: 0 for e in employees}
        details = {e['id']: [] for e in employees}
        
        for s in history + schedule:
            try:
                did = int(s['duty_id'])
                if did not in target_duties: continue 
                
                s_date = dt.strptime(s['date'], '%Y-%m-%d').date()
                eid = int(s['employee_id'])
                if eid not in scores: continue
                
                d_obj = next((d for d in duties if d['id'] == did), None)
                if not d_obj: continue
                
                conf = d_obj['shift_config'][s.get('shift_index',0)]
                points = 0
                
                # Default Protection: 0 points on Weekdays
                if conf.get('is_within_hours') and conf.get('default_employee_id') == eid:
                    if not is_scoreable_day(s_date, special_dates_set):
                        points = 0 
                    else:
                        points = 1 # Weekend Default
                else:
                    if d_obj.get('is_weekly'):
                        if is_scoreable_day(s_date, special_dates_set): points = 1
                    else:
                        points = 1 

                if points > 0:
                    scores[eid] += points
                    if return_details:
                        details[eid].append(f"{s_date.strftime('%d/%m')} {d_obj['name']}")
            except: pass
            
        if return_details: return scores, details
        return scores

    def balance_dataset(phase_name, target_duties):
        log(f"🔹 {phase_name}: Balancing")
        
        # Log Initial
        init_s, init_d = get_detailed_scores(target_duties, return_details=True)
        sorted_init = sorted(init_s.items(), key=lambda x: x[1], reverse=True)
        log("   📊 Initial Scores:")
        for eid, score in sorted_init:
            det_str = ", ".join(init_d[eid])
            log(f"      - {emp_map.get(eid)}: {score} pts ({det_str})")

        iterations = 0
        while iterations < 100:
            scores = get_detailed_scores(target_duties)
            sorted_ids = sorted(scores.keys(), key=lambda k: scores[k])
            min_id = sorted_ids[0]; max_id = sorted_ids[-1]
            
            if scores[max_id] - scores[min_id] <= 1:
                log("   ✨ Balanced."); break
            
            candidates = [s for s in schedule if int(s['employee_id']) == max_id and not s.get('manually_locked') and int(s['duty_id']) in target_duties]
            candidates = [c for c in candidates if start_date <= dt.strptime(c['date'], '%Y-%m-%d').date() <= end_date]
            random.shuffle(candidates)
            
            swapped = False
            receivers = sorted_ids[:len(sorted_ids)//2 + 1]
            
            for target_id in receivers:
                if target_id == max_id: continue
                if scores[max_id] <= scores[target_id]: continue 
                
                for cand in candidates:
                    c_date = dt.strptime(cand['date'], '%Y-%m-%d').date()
                    d_obj = next((d for d in duties if d['id'] == cand['duty_id']), None)
                    if not d_obj: continue
                    conf = d_obj['shift_config'][cand['shift_index']]
                    
                    # 1. SWAP PROTECTION: Default Weekday
                    if conf.get('is_within_hours') and conf.get('default_employee_id') == max_id:
                        if not is_scoreable_day(c_date, special_dates_set): continue

                    # 2. SWAP PROTECTION: Weekly Duties (Sat/Sun) cannot be swapped
                    if d_obj.get('is_weekly'): continue

                    # Valuable?
                    points = 1 # Normal duty = 1
                    if points == 0: continue 

                    excl = [int(x) for x in conf.get('excluded_ids', [])]
                    if target_id in excl: continue
                    if (target_id, cand['date']) in unavail_map: continue
                    if is_user_busy(target_id, c_date, schedule, ignore_yesterday=False): continue
                    
                    cand['employee_id'] = target_id
                    log(f"     🔄 Swap: {d_obj['name']} {cand['date']} | {emp_map.get(max_id)} -> {emp_map.get(target_id)}")
                    swapped = True
                    break
                if swapped: break
            if not swapped: break
            iterations += 1
            
        final_s, final_d = get_detailed_scores(target_duties, return_details=True)
        sorted_final = sorted(final_s.items(), key=lambda x: x[1], reverse=True)
        log(f"🏁 {phase_name} FINAL:")
        for eid, score in sorted_final:
            det_str = ", ".join(final_d[eid])
            log(f"   - {emp_map.get(eid)}: {score} pts ({det_str})")

    if score_duties_normal:
        balance_dataset("Phase 3 (Normal)", score_duties_normal)
    
    if score_duties_off:
        balance_dataset("Phase 4 (Off-Balance)", score_duties_off)

    return schedule, {"rotation_queues": rot_q, "next_round_queues": nxt_q, "logs": logs}

# ==========================================
# 4. API ROUTES
# ==========================================

@app.route('/api/login', methods=['POST'])
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

@app.route('/api/admin/users', methods=['GET', 'POST', 'PUT', 'DELETE'])
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

@app.route('/api/admin/employees', methods=['GET', 'PUT'])
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

@app.route('/api/announcements', methods=['GET', 'POST', 'DELETE'])
def announcements():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'GET':
            cur.execute("SELECT * FROM announcements ORDER BY date DESC")
            res = cur.fetchall()
            for r in res: r['date'] = str(r['date'])
            return jsonify(res)
        if request.method == 'POST':
            cur.execute("INSERT INTO announcements (text, date) VALUES (%s, CURRENT_DATE)", (request.json.get('text'),))
            conn.commit()
            return jsonify({"success":True})
        if request.method == 'DELETE':
            cur.execute("DELETE FROM announcements WHERE id = %s", (request.args.get('id'),))
            conn.commit()
            return jsonify({"success":True})
    finally:
        conn.close()

@app.route('/api/reservations', methods=['GET', 'POST', 'PUT', 'DELETE'])
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

@app.route('/api/daily_status', methods=['GET','POST'])
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

@app.route('/api/admin/settings', methods=['GET', 'POST'])
def settings():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'GET':
            cur.execute("SELECT * FROM app_settings WHERE id = 1")
            return jsonify(cur.fetchone())
        if request.method == 'POST':
            s = request.json
            cur.execute("""
                UPDATE app_settings SET lock_days=%s, lock_time=%s, weekly_schedule=%s 
                WHERE id=1
            """, (s['lock_rules']['days_before'], s['lock_rules']['time'], Json(s['weekly_schedule'])))
            conn.commit()
            return jsonify(s)
    finally:
        conn.close()

@app.route('/api/admin/reference', methods=['GET', 'POST', 'PUT', 'DELETE'])
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

@app.route('/api/admin/services/config', methods=['GET', 'POST'])
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
                special_dates = [str(r['date']) for r in rows]
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

@app.route('/api/services/schedule', methods=['GET', 'POST'])
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

@app.route('/api/services/run_scheduler', methods=['POST'])
def run_scheduler_route():
    try:
        db = load_state_for_scheduler()
        if not db: return jsonify({"error": "DB Load Failed"}), 500
    except Exception as e:
        print(traceback.format_exc())
        return jsonify({"error": "DB Load Logic Error", "details": str(e)}), 500

    req = request.json
    try:
        start_date = dt.strptime(req['start'] + '-01', '%Y-%m-%d').date()
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

@app.route('/api/services/balance', methods=['GET'])
def get_balance():
    return jsonify(calculate_db_balance())

@app.route('/api/services/unavailability', methods=['GET', 'POST', 'DELETE'])
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

@app.route('/api/services/clear_schedule', methods=['POST'])
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

@app.route('/api/admin/special_dates', methods=['GET', 'POST', 'DELETE'])
def special_dates_route():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'GET':
            cur.execute("SELECT * FROM special_dates ORDER BY date")
            rows = cur.fetchall()
            for r in rows: r['date'] = str(r['date'])
            return jsonify(rows)
        if request.method == 'POST':
            d = request.json.get('date')
            desc = request.json.get('description', '')
            cur.execute("INSERT INTO special_dates (date, description) VALUES (%s, %s) ON CONFLICT (date) DO NOTHING", (d, desc))
            conn.commit()
            return jsonify({"success": True})
        if request.method == 'DELETE':
            d = request.args.get('date')
            cur.execute("DELETE FROM special_dates WHERE date = %s", (d,))
            conn.commit()
            return jsonify({"success": True})
    finally:
        conn.close()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)