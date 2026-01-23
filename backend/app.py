import os
import json
import datetime
import random
import statistics
import re
import psycopg2
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
# Enable CORS for all domains and headers to prevent preflight issues
CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

# ==========================================
# 1. DATABASE CONNECTION
# ==========================================
def get_db():
    url = os.environ.get('DATABASE_URL')
    if not url:
        # Local fallback for development (optional)
        print("WARNING: DATABASE_URL not set.")
        return None
    try:
        return psycopg2.connect(url)
    except Exception as e:
        print(f"DB Connection Failed: {e}")
        return None

# ==========================================
# 2. HELPER FUNCTIONS
# ==========================================

def is_in_period(date_obj, range_config, logs=None):
    """
    Checks if a date is within a DD-MM range.
    Handles wrapping years (e.g. Nov -> Feb).
    """
    if not range_config or not range_config.get('start') or not range_config.get('end'):
        return True 
    try:
        y = date_obj.year
        # Handle various separators
        s_parts = str(range_config['start']).strip().replace('/','-').split('-')
        e_parts = str(range_config['end']).strip().replace('/','-').split('-')
        
        if len(s_parts) < 2 or len(e_parts) < 2: return True
        
        s_day, s_month = int(s_parts[0]), int(s_parts[1])
        e_day, e_month = int(e_parts[0]), int(e_parts[1])
        
        # Construct comparison dates for the current year
        start_date = dt(y, s_month, s_day).date()
        end_date = dt(y, e_month, e_day).date()
        
        if start_date > end_date:
            # Wrap around case (e.g. Nov 15 to Feb 10)
            return date_obj >= start_date or date_obj <= end_date
        else:
            # Standard case (e.g. Mar 01 to Oct 31)
            return start_date <= date_obj <= end_date
    except: return True 

def calculate_db_balance():
    """
    Calculates employee stats (shifts worked, handicaps) from SQL data.
    """
    conn = get_db()
    if not conn: return []
    
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    # Fetch all necessary data
    cur.execute("SELECT * FROM duties")
    duties = cur.fetchall()
    
    cur.execute("SELECT * FROM employees")
    employees = cur.fetchall()
    
    cur.execute("SELECT * FROM schedule")
    schedule = cur.fetchall()
    
    # Convert dates to string just in case, though objects work fine for logic
    special_dates = set() 
    # If you implement special_dates table later:
    # cur.execute("SELECT date FROM special_dates")
    # special_dates = {str(r['date']) for r in cur.fetchall()}

    conn.close()

    # Initialize Stats
    stats = {}
    for e in employees:
        stats[e['id']] = {
            'name': e['name'], 
            'total': 0, 'effective_total': 0,
            'duty_counts': {d['id']: 0 for d in duties},
            'effective_duty_counts': {d['id']: 0 for d in duties}
        }

    # Determine Month Multiplier
    if schedule:
        unique_months = set(str(s['date'])[:7] for s in schedule)
        month_multiplier = max(len(unique_months), 1)
    else:
        month_multiplier = 1

    # 1. Count Actual Shifts
    for s in schedule:
        eid = s['employee_id']
        if not eid or eid not in stats: continue
        
        duty = next((d for d in duties if d['id'] == s['duty_id']), None)
        if not duty: continue
        
        s_date = s['date'] 
        is_spec = str(s_date) in special_dates
        is_wknd = s_date.weekday() >= 5
        
        if duty.get('is_weekly'):
            if s_date.weekday() == 0: stats[eid]['duty_counts'][duty['id']] += 1
            if is_wknd or is_spec: stats[eid]['total'] += 1
        elif duty.get('is_off_balance'): 
            stats[eid]['duty_counts'][duty['id']] += 1
        else: 
            stats[eid]['total'] += 1

    # 2. Add Handicaps
    for eid, stat in stats.items():
        stat['effective_total'] = stat['total']
        for d in duties:
            stat['effective_duty_counts'][d['id']] = stat['duty_counts'][d['id']]
            
            # Sum handicaps from shift config
            handicap_sum = 0
            if d.get('shift_config'):
                for shift in d['shift_config']: 
                    # JSONB comes as list of dicts. Keys might be strings or ints in JSON.
                    # We cast eid to str to match JSON keys usually.
                    val = int(shift.get('handicaps', {}).get(str(eid), 0))
                    handicap_sum += val
            
            if handicap_sum > 0:
                scaled = handicap_sum * month_multiplier
                stat['effective_duty_counts'][d['id']] += scaled
                if not d.get('is_off_balance'): 
                    stat['effective_total'] += scaled
                    
    return list(stats.values())

def load_state_for_scheduler():
    """
    Loads SQL data into a dictionary format compatible with the complex scheduler logic.
    """
    conn = get_db()
    if not conn: return None
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    cur.execute("SELECT * FROM employees ORDER BY seniority ASC")
    employees = cur.fetchall()
    
    cur.execute("SELECT * FROM duties ORDER BY id")
    duties = cur.fetchall()
    
    cur.execute("SELECT * FROM schedule")
    schedule = cur.fetchall()
    # Normalize dates for python logic
    for s in schedule: s['date'] = str(s['date'])
    
    cur.execute("SELECT * FROM unavailability")
    unavail = cur.fetchall()
    for u in unavail: u['date'] = str(u['date'])

    cur.execute("SELECT * FROM scheduler_state WHERE id = 1")
    state = cur.fetchone()
    
    conn.close()
    
    return {
        "employees": employees,
        "service_config": {
            "duties": duties,
            "special_dates": [],
            "rotation_queues": state['rotation_queues'] if state else {},
            "next_round_queues": state['next_round_queues'] if state else {}
        },
        "schedule": schedule,
        "unavailability": unavail
    }

# ==========================================
# 3. SCHEDULER LOGIC
# ==========================================
def run_auto_scheduler_logic(db, start_date, end_date):
    logs = []
    
    sched_months = set()
    t = start_date
    while t <= end_date:
        sched_months.add(t.strftime("%Y-%m"))
        t += timedelta(days=1)
    month_mult = max(len(sched_months), 1)
    logs.append(f"Scheduling for {month_mult} months")

    employees = db['employees']
    emp_map = {e['id']: e['name'] for e in employees}
    duties = db['service_config']['duties']
    schedule = db['schedule']
    unavail_map = {(u['employee_id'], str(u['date'])) for u in db['unavailability']}
    
    rot_q = db['service_config']['rotation_queues']
    nxt_q = db['service_config']['next_round_queues']

    schedule_map = {(s['date'], s['duty_id'], s['shift_index']): s for s in schedule}
    emp_stats = {e['id']: {'total':0} for e in employees}

    # --- Helper: Get Queue ---
    def get_q(key, strategy):
        cq = rot_q.get(key, [])
        nq = nxt_q.get(key, [])
        
        valid_ids = set(e['id'] for e in employees)
        cq = [x for x in cq if x in valid_ids]
        nq = [x for x in nq if x in valid_ids]
        
        known = set(cq) | set(nq)
        missing = [e['id'] for e in employees if e['id'] not in known]
        if missing:
            if strategy == 'seniority': missing.sort(key=lambda x: next((e['seniority'] for e in employees if e['id']==x),999))
            else: random.shuffle(missing)
            cq.extend(missing)
        
        if not cq and nxt_q: cq = nq; nq = []
        if not cq: 
            all_e = [e['id'] for e in employees]
            if strategy == 'seniority': all_e.sort(key=lambda x: next((e['seniority'] for e in employees if e['id']==x),999))
            else: random.shuffle(all_e)
            cq = all_e
            
        rot_q[key] = cq; nxt_q[key] = nq
        return cq, nq

    def save_q(key, cq, nq):
        rot_q[key] = cq; nxt_q[key] = nq

    def try_assign(curr_q, nxt_q, check_fn):
        chosen = None
        for idx, eid in enumerate(curr_q):
            if check_fn(eid): chosen = eid; curr_q.pop(idx); nxt_q.append(chosen); break
        if not chosen and nxt_q:
            for idx, eid in enumerate(nxt_q):
                 if check_fn(eid): chosen = eid; nxt_q.pop(idx); nxt_q.append(chosen); break
        return chosen, curr_q, nxt_q

    # --- PHASE 1: WEEKLY ---
    weekly_duties = [d for d in duties if d.get('is_weekly')]
    curr = start_date
    while curr.weekday() != 0: curr += timedelta(days=1) 
    
    while curr <= end_date:
        week_days = [curr + timedelta(days=i) for i in range(7)]
        for duty in weekly_duties:
            for sh_idx in range(duty['shifts_per_day']):
                q_key = f"weekly_{duty['id']}_sh_{sh_idx}"
                cq, nq = get_q(q_key, 'random')
                
                if any((d.strftime('%Y-%m-%d'), duty['id'], sh_idx) in schedule_map for d in week_days): continue
                
                shift_conf = duty['shift_config'][sh_idx]
                
                def check(eid):
                    if eid in shift_conf.get('excluded_ids', []): return False
                    for d_date in week_days:
                        d_s = d_date.strftime('%Y-%m-%d')
                        if (eid, d_s) in unavail_map: return False
                        if any(s['date'] == d_s and s['employee_id'] == eid for s in schedule): return False
                    return True

                chosen, cq, nq = try_assign(cq, nq, check)
                save_q(q_key, cq, nq)
                
                if chosen:
                    logs.append(f"Assigned Weekly: {emp_map.get(chosen, 'Unknown')} to {duty['name']}")
                    for d_date in week_days:
                        if d_date.weekday() == 6:
                            if not is_in_period(d_date, duty.get('sunday_active_range'), logs): continue
                        
                        entry = {
                            "date": d_date.strftime('%Y-%m-%d'),
                            "duty_id": duty['id'],
                            "shift_index": sh_idx,
                            "employee_id": chosen,
                            "manually_locked": False
                        }
                        schedule.append(entry)
                        schedule_map[(entry['date'], duty['id'], sh_idx)] = entry

        curr += timedelta(days=7)

    # --- PHASE 2: NORMAL ---
    normal_duties = [d for d in duties if not d.get('is_weekly') and not d.get('is_off_balance')]
    curr = start_date
    while curr <= end_date:
        d_str = curr.strftime('%Y-%m-%d')
        random.shuffle(normal_duties)
        for duty in normal_duties:
            for sh_idx in range(duty['shifts_per_day']):
                if (d_str, duty['id'], sh_idx) in schedule_map: continue
                
                shift_conf = duty['shift_config'][sh_idx]
                if not is_in_period(curr, shift_conf.get('active_range'), logs): continue
                
                q_key = f"normal_{duty['id']}_sh_{sh_idx}"
                cq, nq = get_q(q_key, 'seniority')
                
                def check(eid):
                    if eid in shift_conf.get('excluded_ids', []): return False
                    if (eid, d_str) in unavail_map: return False
                    if any(s['date'] == d_str and s['employee_id'] == eid for s in schedule): return False
                    return True
                
                chosen, cq, nq = try_assign(cq, nq, check)
                save_q(q_key, cq, nq)
                
                if chosen:
                    entry = {"date": d_str, "duty_id": duty['id'], "shift_index": sh_idx, "employee_id": chosen, "manually_locked": False}
                    schedule.append(entry)
                    schedule_map[(d_str, duty['id'], sh_idx)] = entry
        
        curr += timedelta(days=1)

    # --- PHASE 4: BALANCING ---
    logs.append("Balancing...")
    for _ in range(200): 
        totals = {e['id']: 0 for e in employees}
        for d in duties:
            if not d.get('is_off_balance'):
                for shift in d.get('shift_config', []):
                    for eid_str, val in shift.get('handicaps', {}).items():
                        totals[int(eid_str)] += (int(val) * month_mult)

        for s in schedule:
            if not s.get('employee_id'): continue
            eid = s['employee_id']
            d = next((x for x in duties if x['id'] == s['duty_id']), None)
            if not d: continue
            
            s_dt = dt.strptime(s['date'], '%Y-%m-%d').date()
            if d.get('is_weekly'):
                if s_dt.weekday() >= 5: totals[eid] += 1
            elif d.get('is_off_balance'): pass
            else: totals[eid] += 1

        vals = list(totals.values())
        if not vals: break
        if max(vals) - min(vals) <= 1: break 
        
        rich = [k for k,v in totals.items() if v == max(vals)]
        poor = [k for k,v in totals.items() if v == min(vals)]
        random.shuffle(rich); random.shuffle(poor)
        
        swapped = False
        for r_id in rich:
            if swapped: break
            shifts = [s for s in schedule if s['employee_id'] == r_id and not s.get('manually_locked')]
            random.shuffle(shifts)
            for s in shifts:
                d = next((x for x in duties if x['id'] == s['duty_id']), None)
                if not d or d.get('is_weekly') or d.get('is_off_balance'): continue
                
                s_conf = d['shift_config'][s['shift_index']]
                s_date_str = s['date']
                
                for p_id in poor:
                    if p_id in s_conf.get('excluded_ids', []): continue
                    if (p_id, s_date_str) in unavail_map: continue
                    if any(x['date'] == s_date_str and x['employee_id'] == p_id for x in schedule): continue
                    
                    s['employee_id'] = p_id
                    swapped = True
                    logs.append(f"Swap {s_date_str}: {emp_map.get(r_id)} -> {emp_map.get(p_id)}")
                    break
                if swapped: break
        if not swapped: break

    return schedule, db['service_config']

# ==========================================
# 4. API ROUTES
# ==========================================

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    conn = get_db()
    if not conn: return jsonify({"error": "Database Connection Failed"}), 500
    
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
            # Use .get() with defaults to prevent KeyErrors from crashing the backend
            cur.execute("""
                INSERT INTO users (username, password, role, name, surname, company, vessels, allowed_apps)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """, (
                u.get('username'), 
                u.get('password'), 
                u.get('role', 'user'), 
                u.get('name', ''), 
                u.get('surname', ''), 
                u.get('company', ''), 
                u.get('vessels', []), 
                u.get('allowed_apps', [])
            ))
            new_id = cur.fetchone()['id']
            conn.commit()
            u['id'] = new_id
            return jsonify(u)
            
        if request.method == 'PUT':
            u = request.json
            cur.execute("""
                UPDATE users SET username=%s, password=%s, role=%s, name=%s, surname=%s, company=%s, vessels=%s, allowed_apps=%s
                WHERE id=%s
            """, (
                u.get('username'), 
                u.get('password'), 
                u.get('role', 'user'), 
                u.get('name'), 
                u.get('surname'), 
                u.get('company'), 
                u.get('vessels', []), 
                u.get('allowed_apps', []), 
                u.get('id')
            ))
            conn.commit()
            return jsonify({"success": True})
            
        if request.method == 'DELETE':
            cur.execute("DELETE FROM users WHERE id = %s", (request.args.get('id'),))
            conn.commit()
            return jsonify({"success": True})
            
    except Exception as e:
        conn.rollback()
        print(f"User API Error: {e}") 
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/admin/employees', methods=['GET', 'POST', 'PUT', 'DELETE'])
def manage_employees():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'GET':
            cur.execute("SELECT * FROM employees ORDER BY seniority")
            return jsonify(cur.fetchall())
        if request.method == 'POST':
            e = request.json
            cur.execute("INSERT INTO employees (name, phone, email) VALUES (%s, %s, %s) RETURNING id", (e.get('name'), e.get('phone'), e.get('email')))
            e['id'] = cur.fetchone()['id']
            conn.commit()
            return jsonify(e)
        if request.method == 'PUT':
            if 'reorder' in request.json:
                for idx, eid in enumerate(request.json['reorder']):
                    cur.execute("UPDATE employees SET seniority = %s WHERE id = %s", (idx + 1, eid))
            else:
                e = request.json
                cur.execute("UPDATE employees SET name=%s, phone=%s, email=%s WHERE id=%s", (e.get('name'), e.get('phone'), e.get('email'), e.get('id')))
            conn.commit()
            return jsonify({"success":True})
        if request.method == 'DELETE':
            cur.execute("DELETE FROM employees WHERE id = %s", (request.args.get('id'),))
            conn.commit()
            return jsonify({"success":True})
    except Exception as e:
        conn.rollback(); return jsonify({"error": str(e)}), 500
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
            r['id'] = cur.fetchone()['id']
            conn.commit()
            return jsonify(r)
            
        if request.method == 'PUT':
            rid = request.json.get('id')
            updates = request.json.get('updates', {})
            fields = []
            vals = []
            for k, v in updates.items():
                if k == 'location':
                    fields.append("location_x=%s"); vals.append(v.get('x'))
                    fields.append("location_y=%s"); vals.append(v.get('y'))
                elif k != 'id':
                    fields.append(f"{k}=%s")
                    vals.append(v)
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
            typ = request.args.get('type')
            val = request.args.get('value')
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
            return jsonify({
                "duties": duties,
                "special_dates": [],
                "rotation_queues": state['rotation_queues'] if state else {},
                "next_round_queues": state['next_round_queues'] if state else {}
            })
        if request.method == 'POST':
            new_duties = request.json.get('duties', [])
            for d in new_duties:
                if 'id' in d and d['id']:
                    cur.execute("""
                        UPDATE duties SET 
                        name=%s, shifts_per_day=%s, default_hours=%s, shift_config=%s, 
                        is_special=%s, is_weekly=%s, is_off_balance=%s, sunday_active_range=%s 
                        WHERE id=%s
                    """, (
                        d['name'], d['shifts_per_day'], d['default_hours'], Json(d['shift_config']),
                        d['is_special'], d['is_weekly'], d['is_off_balance'], Json(d.get('sunday_active_range', {})),
                        d['id']
                    ))
                else:
                    cur.execute("""
                        INSERT INTO duties (name, shifts_per_day, default_hours, shift_config, is_special, is_weekly, is_off_balance, sunday_active_range)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        d['name'], d['shifts_per_day'], d['default_hours'], Json(d['shift_config']),
                        d['is_special'], d['is_weekly'], d['is_off_balance'], Json(d.get('sunday_active_range', {}))
                    ))
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
    db = load_state_for_scheduler()
    if not db: return jsonify({"error": "DB Load Failed"}), 500

    req = request.json
    if req and 'start' in req:
        try:
            start_date = dt.strptime(req['start'] + '-01', '%Y-%m-%d').date()
            end_date_month = dt.strptime(req['end'] + '-01', '%Y-%m-%d')
            end_date = (end_date_month + relativedelta(months=1) - timedelta(days=1)).date()
        except:
            return jsonify({"error": "Invalid date format"}), 400
    else:
        start_date = dt.now().date()
        end_date = start_date + timedelta(days=30)
    
    new_schedule, new_config = run_auto_scheduler_logic(db, start_date, end_date)
    
    conn = get_db()
    cur = conn.cursor()
    
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

    cur.execute("UPDATE scheduler_state SET rotation_queues = %s, next_round_queues = %s WHERE id = 1", 
               (Json(new_config['rotation_queues']), Json(new_config['next_round_queues'])))
    
    conn.commit()
    conn.close()
    
    return jsonify({"success": True, "logs": ["Scheduler executed successfully"]})

@app.route('/api/services/balance', methods=['GET'])
def get_balance():
    stats = calculate_db_balance()
    return jsonify(stats)

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
        start_date = dt.strptime(req['start_date'], '%Y-%m').date() # Usually comes as YYYY-MM
        # Fix format if full date sent
        if len(req['start_date']) > 7: start_date = dt.strptime(req['start_date'], '%Y-%m-%d').date()
        
        # End date logic logic
        if len(req['end_date']) > 7: end_date = dt.strptime(req['end_date'], '%Y-%m-%d').date()
        else: end_date = (dt.strptime(req['end_date'], '%Y-%m') + relativedelta(months=1) - timedelta(days=1)).date()

        cur.execute("DELETE FROM schedule WHERE date >= %s AND date <= %s", (start_date, end_date))
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        conn.close()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)