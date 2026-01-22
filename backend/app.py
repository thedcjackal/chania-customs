import os
import json
import datetime
import random
import statistics
import re
from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime as dt, timedelta

try:
    from dateutil.relativedelta import relativedelta
except ImportError:
    print("CRITICAL: 'python-dateutil' is missing. Run: pip install python-dateutil")
    exit(1)

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, 'onlinedb.json')

def load_db():
    root_user = { "id": 0, "username": "root", "password": "root", "role": "root_admin", "name": "Super", "surname": "Admin", "contact_number": "", "company": "System", "vessels": [], "allowed_apps": ["fuel", "personnel", "accounts", "services", "announcements"] }
    
    default_data = {
        "users": [ 
            root_user, 
            {"id": 1, "username": "admin", "password": "password", "role": "admin", "name": "Admin", "surname": "User", "allowed_apps": ["fuel", "personnel", "services", "announcements"]}, 
            {"id": 2, "username": "staff", "password": "password", "role": "staff", "name": "Staff", "surname": "One", "allowed_apps": ["fuel", "personnel", "services"]} 
        ],
        "settings": { "lock_rules": {"days_before": 1, "time": "14:00"}, "weekly_schedule": {k: {"open": True, "limit": 10} for k in ["Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο", "Κυριακή"]} },
        "employees": [ {"id": 1, "name": "Υπάλληλος Α", "seniority": 1}, {"id": 2, "name": "Υπάλληλος Β", "seniority": 2} ],
        "service_config": { 
            "duties": [{"id": 1, "name": "Βάρδια", "shifts_per_day": 3, "default_hours": ["00-08", "08-16", "16-24"], "shift_config": [{"is_night":True, "is_within_hours":False}, {"is_night":False, "is_within_hours":True}, {"is_night":False, "is_within_hours":False}], "excluded_ids": [], "handicaps": {}, "is_special": False, "is_weekly": False, "is_off_balance": False}], 
            "special_dates": [], "rotation_queues": {}, "next_round_queues": {} 
        },
        "schedule": [], "unavailability": [], "reservations": [], "announcements": [], "reference_data": {"companies": [], "fuel_types": []}, "daily_status": {}
    }
    
    if not os.path.exists(DB_FILE): save_db(default_data); return default_data
    try:
        with open(DB_FILE, 'r') as f:
            data = json.load(f)
            if not any(u.get('role') == 'root_admin' for u in data.get('users', [])): data['users'].insert(0, root_user)
            if "service_config" not in data: data["service_config"] = default_data["service_config"]
            if "rotation_queues" not in data["service_config"]: data["service_config"]["rotation_queues"] = {}
            if "next_round_queues" not in data["service_config"]: data["service_config"]["next_round_queues"] = {}
            if "schedule" not in data: data["schedule"] = []
            
            for d in data['service_config']['duties']:
                shifts_count = d.get('shifts_per_day', 1)
                current_conf = d.get('shift_config', [])
                if len(current_conf) < shifts_count:
                    for _ in range(shifts_count - len(current_conf)):
                        current_conf.append({})
                for conf in current_conf:
                    if 'excluded_ids' not in conf: conf['excluded_ids'] = []
                    if 'handicaps' not in conf: conf['handicaps'] = {}
                d['shift_config'] = current_conf
                d.pop('shift_weights', None) 
            return data
    except: return default_data

def save_db(data):
    with open(DB_FILE, 'w') as f: json.dump(data, f, indent=4, default=str)

# --- ROBUST DATE CHECKER (DD-MM) ---
def is_in_period(date_obj, range_config, logs=None):
    if not range_config or not range_config.get('start') or not range_config.get('end'):
        return True 
    try:
        y = date_obj.year
        s_parts = re.split(r'[-/.]', str(range_config['start']).strip())
        e_parts = re.split(r'[-/.]', str(range_config['end']).strip())
        
        if len(s_parts) < 2 or len(e_parts) < 2: 
            if logs is not None: logs.append(f"PARSE FAIL: Invalid format {range_config}")
            return True
        
        s_day, s_month = int(s_parts[0]), int(s_parts[1])
        e_day, e_month = int(e_parts[0]), int(e_parts[1])
        
        start_date = dt(y, s_month, s_day).date()
        end_date = dt(y, e_month, e_day).date()
        
        in_range = False
        if start_date > end_date:
            in_range = date_obj >= start_date or date_obj <= end_date
        else:
            in_range = start_date <= date_obj <= end_date
            
        if logs is not None and not in_range:
             logs.append(f"SUNDAY SKIP: {date_obj} outside {range_config['start']} - {range_config['end']}")
        return in_range
    except Exception as e:
        if logs is not None: logs.append(f"Date Check Exception: {str(e)}")
        return True 

# --- BALANCE CALCULATOR ---
def calculate_db_balance(db):
    duties = db['service_config']['duties']
    stats = {}
    for e in db['employees']:
        stats[e['id']] = {
            'name': e['name'], 
            'total': 0, 'effective_total': 0,
            'duty_counts': {d['id']: 0 for d in duties},
            'effective_duty_counts': {d['id']: 0 for d in duties}
        }
    special_dates = set(db['service_config']['special_dates'])
    
    unique_months = set()
    for s in db['schedule']:
        if s.get('date'): unique_months.add(s['date'][:7])
    month_multiplier = max(len(unique_months), 1)

    for s in db['schedule']:
        if not s.get('employee_id'): continue
        eid = s['employee_id']
        if eid not in stats: continue
        duty = next((d for d in duties if d['id'] == s['duty_id']), None)
        if not duty: continue
        try: s_date = dt.strptime(s['date'], '%Y-%m-%d').date()
        except: continue
        is_spec = s['date'] in special_dates; is_wknd = s_date.weekday() >= 5
        
        if duty.get('is_weekly'):
            if s_date.weekday() == 0: stats[eid]['duty_counts'][duty['id']] += 1
            if is_wknd or is_spec: stats[eid]['total'] += 1
        elif duty.get('is_off_balance'): stats[eid]['duty_counts'][duty['id']] += 1
        else: stats[eid]['total'] += 1

    for eid, stat in stats.items():
        stat['effective_total'] = stat['total']
        for did in stat['duty_counts']: stat['effective_duty_counts'][did] = stat['duty_counts'][did]
        for d in duties:
            handicap_sum = 0
            for shift in d.get('shift_config', []):
                val = int(shift.get('handicaps', {}).get(str(eid), 0))
                handicap_sum += val
            if handicap_sum > 0:
                scaled = handicap_sum * month_multiplier
                stat['effective_duty_counts'][d['id']] += scaled
                if not d.get('is_off_balance'): stat['effective_total'] += scaled
    return list(stats.values())

# --- SCHEDULER ---
def run_auto_scheduler(db, reset_range=None):
    logs = []
    now = dt.now()
    if now.day >= 27: next_month = now + relativedelta(months=1); last_day_next = (next_month + relativedelta(months=1)).replace(day=1) - timedelta(days=1); lock_date = last_day_next.date()
    else: last_day_curr = (now + relativedelta(months=1)).replace(day=1) - timedelta(days=1); lock_date = last_day_curr.date()
    start_date = max(dt.now().date(), lock_date + timedelta(days=1)); end_date = start_date + timedelta(days=180)

    if reset_range:
        user_start = dt.strptime(reset_range['start_date'], '%Y-%m-%d').date()
        user_end = dt.strptime(reset_range['end_date'], '%Y-%m-%d').date()
        start_date = max(dt.now().date(), user_start); end_date = user_end
        db['schedule'] = [s for s in db['schedule'] if not (start_date <= dt.strptime(s['date'], '%Y-%m-%d').date() <= end_date and not s.get('manually_locked', False))]
        logs.append(f"Cleared schedule from {start_date} to {end_date}")

    sched_months = set()
    temp = start_date
    while temp <= end_date: sched_months.add(temp.strftime("%Y-%m")); temp += timedelta(days=1)
    month_mult = max(len(sched_months), 1)

    employees = db['employees']; emp_map = {e['id']: e['name'] for e in employees}
    special_dates = set(db['service_config']['special_dates']); unavail_map = {(u['employee_id'], u['date']) for u in db['unavailability']}
    duties = db['service_config']['duties']
    if 'rotation_queues' not in db['service_config']: db['service_config']['rotation_queues'] = {}
    if 'next_round_queues' not in db['service_config']: db['service_config']['next_round_queues'] = {}
    schedule_map = {} 
    emp_stats = {e['id']: {'total':0, 'weekly_count':0, 'duty_counts': {d['id']: 0 for d in duties}} for e in employees}
    
    def get_queues(q_key, strategy='random'):
        current_q = db['service_config']['rotation_queues'].get(q_key, [])
        next_q = db['service_config']['next_round_queues'].get(q_key, [])
        valid_ids = set(e['id'] for e in employees)
        current_q = [eid for eid in current_q if eid in valid_ids]
        next_q = [eid for eid in next_q if eid in valid_ids]
        known_ids = set(current_q) | set(next_q)
        new_ids = [eid for eid in valid_ids if eid not in known_ids]
        if new_ids:
            if strategy == 'seniority': current_q.extend(new_ids) 
            else: random.shuffle(new_ids); current_q.extend(new_ids) 
        if not current_q and not next_q:
            all_ids = list(valid_ids)
            if strategy == 'seniority': all_ids.sort(key=lambda x: next((e['seniority'] for e in employees if e['id']==x), 999), reverse=True)
            else: random.shuffle(all_ids)
            current_q = all_ids
        if not current_q and next_q: current_q = next_q; next_q = []
        if strategy == 'seniority': current_q.sort(key=lambda x: next((e['seniority'] for e in employees if e['id']==x), 999), reverse=True)
        db['service_config']['rotation_queues'][q_key] = current_q
        db['service_config']['next_round_queues'][q_key] = next_q
        return current_q, next_q

    def save_queues(q_key, curr_q, nxt_q):
        db['service_config']['rotation_queues'][q_key] = curr_q
        db['service_config']['next_round_queues'][q_key] = nxt_q

    for s in db['schedule']:
        try: s_date = dt.strptime(s['date'], '%Y-%m-%d').date()
        except: continue
        key = (s['date'], s['duty_id'], s['shift_index'])
        schedule_map[key] = s
        if not s.get('employee_id'): continue
        eid = s['employee_id']
        duty = next((d for d in duties if d['id'] == s['duty_id']), None)
        if not duty: continue
        is_spec = s['date'] in special_dates; is_wknd = s_date.weekday() >= 5
        if duty.get('is_weekly'):
            if s_date.weekday() == 0: emp_stats[eid]['weekly_count'] += 1
            if is_wknd or is_spec: emp_stats[eid]['total'] += 1
        elif duty.get('is_off_balance'): emp_stats[eid]['duty_counts'][duty['id']] += 1
        else: emp_stats[eid]['total'] += 1

    def assign_from_round_robin(curr_q, nxt_q, check_fn, strategy='random'):
        chosen_id = None
        for idx, cid in enumerate(curr_q):
            if check_fn(cid): chosen_id = cid; curr_q.pop(idx); nxt_q.append(chosen_id); break
        if chosen_id is None and nxt_q:
            for idx, cid in enumerate(nxt_q):
                if check_fn(cid): chosen_id = cid; nxt_q.pop(idx); nxt_q.append(chosen_id); break
        if not curr_q and nxt_q:
            curr_q = nxt_q; nxt_q = []
            if strategy == 'seniority': curr_q.sort(key=lambda x: next((e['seniority'] for e in employees if e['id']==x), 999), reverse=True)
        return chosen_id, curr_q, nxt_q

    logs.append("Phase 0: Carry Over...")
    if start_date.weekday() != 0:
        prev_monday = start_date - timedelta(days=start_date.weekday())
        gap_end = min(start_date + timedelta(days=(6 - start_date.weekday())), end_date)
        check_day = prev_monday
        while check_day < start_date:
            d_str = check_day.strftime('%Y-%m-%d')
            for s in db['schedule']:
                if s['date'] == d_str:
                    duty = next((d for d in duties if d['id'] == s['duty_id']), None)
                    if duty and duty.get('is_weekly') and s.get('employee_id'):
                        fill_curr = start_date
                        while fill_curr <= gap_end:
                            f_str = fill_curr.strftime('%Y-%m-%d')
                            fill_key = (f_str, duty['id'], s['shift_index'])
                            shift_conf = duty['shift_config'][s['shift_index']]
                            if s['employee_id'] in shift_conf.get('excluded_ids', []):
                                fill_curr += timedelta(days=1); continue
                            if fill_curr.weekday() == 6:
                                if not is_in_period(fill_curr, duty.get('sunday_active_range'), logs):
                                    fill_curr += timedelta(days=1); continue
                            is_unavail = (s['employee_id'], f_str) in unavail_map
                            if fill_key not in schedule_map and not is_unavail:
                                entry = {"date": f_str, "duty_id": duty['id'], "shift_index": s['shift_index'], "hours": duty['default_hours'][s['shift_index']], "employee_id": s['employee_id'], "is_locked": False, "manually_locked": False}
                                db['schedule'].append(entry); schedule_map[fill_key] = entry
                                logs.append(f"CARRY: {emp_map.get(s['employee_id'],'')} -> {duty['name']} on {f_str}")
                                is_spec = f_str in special_dates; is_wknd = fill_curr.weekday() >= 5
                                if is_spec or is_wknd: emp_stats[s['employee_id']]['total'] += 1
                            fill_curr += timedelta(days=1)
            check_day += timedelta(days=1)

    logs.append("Phase 1: Weekly...")
    weekly_duties = [d for d in duties if d.get('is_weekly')]
    curr = start_date
    while curr.weekday() != 0: curr += timedelta(days=1)
    while curr <= end_date:
        week_days = [curr + timedelta(days=i) for i in range(7)]
        for duty in weekly_duties:
            for sh_idx in range(duty['shifts_per_day']):
                q_key = f"weekly_{duty['id']}_sh_{sh_idx}"
                curr_q, nxt_q = get_queues(q_key, strategy='random')
                if any((d.strftime('%Y-%m-%d'), duty['id'], sh_idx) in schedule_map for d in week_days): continue
                shift_conf = duty['shift_config'][sh_idx]
                def check_weekly(eid):
                    if eid in shift_conf.get('excluded_ids', []): return False
                    for d_date in week_days:
                        d_str = d_date.strftime('%Y-%m-%d')
                        if (eid, d_str) in unavail_map: return False
                        if any(s['date'] == d_str and s['employee_id'] == eid for s in db['schedule']): return False
                    return True
                chosen, curr_q, nxt_q = assign_from_round_robin(curr_q, nxt_q, check_weekly, strategy='random')
                save_queues(q_key, curr_q, nxt_q)
                if chosen:
                    if week_days[0].weekday() == 0: emp_stats[chosen]['weekly_count'] += 1
                    for d_date in week_days:
                        if d_date.weekday() == 6:
                            if not is_in_period(d_date, duty.get('sunday_active_range'), logs): continue
                        d_str = d_date.strftime('%Y-%m-%d')
                        is_spec = d_str in special_dates; is_wknd = d_date.weekday() >= 5
                        if is_spec or is_wknd: emp_stats[chosen]['total'] += 1
                        entry = {"date": d_str, "duty_id": duty['id'], "shift_index": sh_idx, "hours": duty['default_hours'][sh_idx], "employee_id": chosen, "is_locked": False, "manually_locked": False}
                        db['schedule'].append(entry); schedule_map[(entry['date'], duty['id'], sh_idx)] = entry
                    logs.append(f"Weekly: {emp_map[chosen]} -> {duty['name']}")
        curr += timedelta(days=7)

    logs.append("Phase 2: Normal...")
    normal_duties = [d for d in duties if not d.get('is_weekly') and not d.get('is_off_balance') and not d.get('is_special')]
    curr = start_date
    while curr <= end_date:
        d_str = curr.strftime('%Y-%m-%d'); yesterday = (curr - timedelta(days=1)).strftime('%Y-%m-%d')
        random.shuffle(normal_duties) 
        for duty in normal_duties:
            for sh_idx in range(duty['shifts_per_day']):
                key = (d_str, duty['id'], sh_idx)
                if key in schedule_map: continue
                s_conf = duty['shift_config'][sh_idx]
                if not is_in_period(curr, s_conf.get('active_range'), logs): continue 
                if s_conf.get('is_within_hours'): continue
                q_key = f"normal_{duty['id']}_sh_{sh_idx}"
                curr_q, nxt_q = get_queues(q_key, strategy='seniority')
                def check_normal(eid):
                    if eid in s_conf.get('excluded_ids', []): return False
                    if (eid, d_str) in unavail_map: return False
                    if any(s['date'] == d_str and s['employee_id'] == eid for s in db['schedule']): return False
                    if any(s['date'] == yesterday and s['employee_id'] == eid for s in db['schedule']): return False
                    return True
                chosen, curr_q, nxt_q = assign_from_round_robin(curr_q, nxt_q, check_normal, strategy='seniority')
                save_queues(q_key, curr_q, nxt_q)
                if chosen:
                    emp_stats[chosen]['total'] += 1
                    entry = {"date": d_str, "duty_id": duty['id'], "shift_index": sh_idx, "hours": duty['default_hours'][sh_idx], "employee_id": chosen, "is_locked": False, "manually_locked": False}
                    db['schedule'].append(entry); schedule_map[key] = entry
        curr += timedelta(days=1)

    logs.append("Phase 3: Off-Balance...")
    off_duties = [d for d in duties if d.get('is_off_balance') and not d.get('is_weekly')]
    curr = start_date
    while curr <= end_date:
        d_str = curr.strftime('%Y-%m-%d'); yesterday = (curr - timedelta(days=1)).strftime('%Y-%m-%d')
        for duty in off_duties:
            for sh_idx in range(duty['shifts_per_day']):
                key = (d_str, duty['id'], sh_idx)
                if key in schedule_map: continue
                s_conf = duty['shift_config'][sh_idx]
                if s_conf.get('is_within_hours'): continue
                q_key = f"off_{duty['id']}_sh_{sh_idx}"
                curr_q, nxt_q = get_queues(q_key, strategy='seniority')
                def check_off(eid):
                    if eid in s_conf.get('excluded_ids', []): return False
                    if (eid, d_str) in unavail_map: return False
                    if any(s['date'] == d_str and s['employee_id'] == eid for s in db['schedule']): return False
                    if any(s['date'] == yesterday and s['employee_id'] == eid for s in db['schedule']): return False
                    return True
                chosen, curr_q, nxt_q = assign_from_round_robin(curr_q, nxt_q, check_off, strategy='seniority')
                save_queues(q_key, curr_q, nxt_q)
                if chosen:
                    emp_stats[chosen]['duty_counts'][duty['id']] += 1
                    entry = {"date": d_str, "duty_id": duty['id'], "shift_index": sh_idx, "hours": duty['default_hours'][sh_idx], "employee_id": chosen, "is_locked": False, "manually_locked": False}
                    db['schedule'].append(entry); schedule_map[key] = entry
        curr += timedelta(days=1)

    logs.append("Phase 4: Balancing...")
    def run_balance_loop(allow_consecutive=False):
        for _ in range(1000):
            totals = {e['id']: 0 for e in employees}
            for d in duties:
                if not d.get('is_off_balance'):
                    for shift in d.get('shift_config', []):
                         for eid_str, val in shift.get('handicaps', {}).items():
                             totals[int(eid_str)] += (int(val) * month_mult)
            for s in db['schedule']:
                if not s.get('employee_id'): continue
                eid = s['employee_id']
                d = next((x for x in duties if x['id'] == s['duty_id']), None)
                if not d: continue
                s_dt = dt.strptime(s['date'], '%Y-%m-%d').date()
                if d.get('is_weekly'):
                    if s_dt.weekday() >= 5 or s['date'] in special_dates: totals[eid] += 1
                elif d.get('is_off_balance'): pass 
                else: totals[eid] += 1 
            
            vals = list(totals.values())
            if not vals: break
            min_v, max_v = min(vals), max(vals)
            if (max_v - min_v) <= 1: return True 
            
            rich_ids = [k for k,v in totals.items() if v == max_v]; poor_ids = [k for k,v in totals.items() if v == min_v]
            random.shuffle(rich_ids); random.shuffle(poor_ids)
            iteration_swap = False
            for r_id in rich_ids:
                if iteration_swap: break
                shifts = [s for s in db['schedule'] if s['employee_id'] == r_id and dt.strptime(s['date'], '%Y-%m-%d').date() >= start_date and not s.get('manually_locked')]
                random.shuffle(shifts)
                for s in shifts:
                    d = next((x for x in duties if x['id'] == s['duty_id']), None)
                    if not d or d.get('is_weekly') or d.get('is_off_balance') or d.get('is_special'): continue
                    s_conf = d['shift_config'][s['shift_index']]
                    if s['date'] in special_dates: continue
                    s_dt = dt.strptime(s['date'], '%Y-%m-%d').date()
                    for p_id in poor_ids:
                        prev_d = (s_dt - timedelta(days=1)).strftime('%Y-%m-%d'); next_d = (s_dt + timedelta(days=1)).strftime('%Y-%m-%d')
                        reason = ""
                        if p_id in s_conf.get('excluded_ids', []): reason = "Excluded"
                        elif (p_id, s['date']) in unavail_map: reason = "Unavailable"
                        elif any(x['date'] == s['date'] and x['employee_id'] == p_id for x in db['schedule']): reason = "Double Book"
                        has_consecutive = False
                        if any(x['date'] == prev_d and x['employee_id'] == p_id for x in db['schedule']): has_consecutive = True
                        if any(x['date'] == next_d and x['employee_id'] == p_id for x in db['schedule']): has_consecutive = True
                        if has_consecutive and not allow_consecutive: reason = "Consecutive"
                        if reason: continue
                        s['employee_id'] = p_id; iteration_swap = True; logs.append(f"Swap {s['date']} {emp_map[r_id]}->{emp_map[p_id]}"); break
                    if iteration_swap: break
            if not iteration_swap: break
        return False
    run_balance_loop(False)
    
    logs.append("Phase 4B: Off-Balance...")
    for d_type in [d for d in duties if d.get('is_off_balance')]:
        for _ in range(200):
            counts = {e['id']: 0 for e in employees}
            for shift in d_type.get('shift_config', []):
                 for eid_str, val in shift.get('handicaps', {}).items():
                     counts[int(eid_str)] += (int(val) * month_mult)
            for s in db['schedule']:
                if s['duty_id'] == d_type['id'] and s.get('employee_id'): counts[s['employee_id']] += 1
            vals = list(counts.values())
            if not vals: break
            min_v, max_v = min(vals), max(vals)
            if (max_v - min_v) <= 1: break
            rich = [k for k,v in counts.items() if v == max_v]; poor = [k for k,v in counts.items() if v == min_v]
            random.shuffle(rich); random.shuffle(poor)
            swapped = False
            for r_id in rich:
                if swapped: break
                shifts = [s for s in db['schedule'] if s['employee_id'] == r_id and s['duty_id'] == d_type['id'] and not s.get('manually_locked')]
                random.shuffle(shifts)
                for s in shifts:
                    for p_id in poor:
                        shift_conf = d_type['shift_config'][s['shift_index']]
                        if p_id in shift_conf.get('excluded_ids', []): continue
                        if (p_id, s['date']) in unavail_map: continue
                        if any(x['date'] == s['date'] and x['employee_id'] == p_id for x in db['schedule']): continue
                        s['employee_id'] = p_id; swapped = True; logs.append(f"Swap Off {s['date']}"); break
                    if swapped: break
            if not swapped: break
    return db, logs

@app.route('/api/services/run_scheduler', methods=['POST'])
def run_scheduler_manual():
    db = load_db(); reset_range = request.json; db, logs = run_auto_scheduler(db, reset_range=reset_range); save_db(db); return jsonify({"success": True, "logs": logs})

@app.route('/api/services/balance', methods=['GET'])
def get_balance_stats():
    db = load_db(); stats = calculate_db_balance(db); return jsonify(stats)

@app.route('/api/services/clear_schedule', methods=['POST'])
def clear_schedule():
    db = load_db(); data = request.json; start_date = dt.strptime(data['start_date'], '%Y-%m-%d').date(); end_date = dt.strptime(data['end_date'], '%Y-%m-%d').date()
    db['schedule'] = [s for s in db['schedule'] if not (start_date <= dt.strptime(s['date'], '%Y-%m-%d').date() <= end_date)]
    save_db(db); return jsonify({"success": True})

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json; db = load_db()
    user = next((u for u in db['users'] if u['username'] == data.get('username') and u['password'] == data.get('password')), None)
    if user:
        if data.get('app_context') and data.get('app_context') not in user.get('allowed_apps', []): return jsonify({"error": "No Access"}), 403
        return jsonify(user)
    return jsonify({"error": "Auth Failed"}), 401

@app.route('/api/announcements', methods=['GET', 'POST', 'DELETE'])
def announcements():
    db = load_db()
    if request.method=='GET': return jsonify(db['announcements'])
    if request.method=='POST': db['announcements'].append({"id": len(db['announcements'])+1, "text": request.json['text'], "date": str(dt.now().date())}); save_db(db); return jsonify({"success":True})
    if request.method=='DELETE': db['announcements']=[a for a in db['announcements'] if a['id']!=int(request.args.get('id'))]; save_db(db); return jsonify({"success":True})

@app.route('/api/admin/users', methods=['GET', 'POST', 'PUT', 'DELETE'])
def manage_users():
    db = load_db()
    if request.method=='GET': return jsonify(db['users'])
    if request.method=='POST': u=request.json; u['id']=max([x['id'] for x in db['users']]+[0])+1; db['users'].append(u); save_db(db); return jsonify(u)
    if request.method=='PUT': u=request.json; [db['users'].__setitem__(i, u) for i,x in enumerate(db['users']) if x['id']==u['id']]; save_db(db); return jsonify({"success":True})
    if request.method=='DELETE': db['users']=[u for u in db['users'] if u['id']!=int(request.args.get('id'))]; save_db(db); return jsonify({"success":True})

@app.route('/api/admin/employees', methods=['GET', 'POST', 'PUT', 'DELETE'])
def manage_employees():
    db = load_db()
    if request.method == 'GET': return jsonify(sorted(db['employees'], key=lambda x: x.get('seniority', 999)))
    if request.method == 'POST': e = request.json; e['id'] = max([x['id'] for x in db['employees']]+[0])+1; e['seniority'] = len(db['employees']) + 1; db['employees'].append(e); save_db(db); return jsonify(e)
    if request.method == 'PUT':
        if 'reorder' in request.json: 
            for idx, eid in enumerate(request.json['reorder']): next((e for e in db['employees'] if e['id'] == eid), {})['seniority'] = idx + 1
        else: e = request.json; [db['employees'].__setitem__(i, e) for i,x in enumerate(db['employees']) if x['id'] == e['id']]
        save_db(db); return jsonify({"success":True})
    if request.method == 'DELETE': db['employees'] = [x for x in db['employees'] if x['id'] != int(request.args.get('id'))]; save_db(db); return jsonify({"success":True})

@app.route('/api/reservations', methods=['GET', 'POST', 'PUT', 'DELETE'])
def resv():
    db = load_db()
    if request.method == 'GET': return jsonify([r for r in db['reservations'] if (not request.args.get('date') or r['date']==request.args.get('date')) and (not request.args.get('company') or r['user_company']==request.args.get('company'))])
    if request.method == 'POST': r=request.json; r['id']=len(db['reservations'])+1; r['flags'] = [] if request.json.get('mrn') else ['Οφειλή']; r['status']='OK'; db['reservations'].append(r); save_db(db); return jsonify(r)
    if request.method == 'PUT': t=next((r for r in db['reservations'] if r['id']==request.json.get('id')),None); t and t.update(request.json.get('updates')); save_db(db); return jsonify({"success":True})
    if request.method == 'DELETE': db['reservations']=[r for r in db['reservations'] if r['id']!=int(request.args.get('id'))]; save_db(db); return jsonify({"success":True})

@app.route('/api/daily_status', methods=['GET','POST'])
def ds():
    db=load_db(); 
    if request.method=='GET': return jsonify(db['daily_status'].get(request.args.get('date'), {"finalized":False}))
    if request.method=='POST': db['daily_status'][request.json.get('date')]={'finalized':request.json.get('finalized')}; save_db(db); return jsonify({"success":True})

@app.route('/api/admin/settings', methods=['GET', 'POST'])
def settings():
    db = load_db()
    if request.method=='GET': return jsonify(db['settings'])
    if request.method=='POST': db['settings'].update(request.json); save_db(db); return jsonify(db['settings'])

@app.route('/api/admin/reference', methods=['GET','POST','PUT','DELETE'])
def ref():
    db=load_db()
    if request.method=='GET': return jsonify(db['reference_data'])
    if request.method=='POST': db['reference_data'][request.json['type']].append(request.json['value']); save_db(db); return jsonify(db['reference_data'])
    if request.method=='DELETE': db['reference_data'][request.args.get('type')].remove(request.args.get('value')); save_db(db); return jsonify(db['reference_data'])
    return jsonify({})

@app.route('/api/vessel_map', methods=['GET'])
def vm(): db=load_db(); m={}; [m.update({u['company']:u['vessels']}) for u in db['users'] if u['role']=='user']; return jsonify(m)

@app.route('/api/user/vessels', methods=['POST'])
def uv():
    d=request.json; db=load_db(); next((u for u in db['users'] if u['id']==d['id']), {})['vessels']=d['vessels']; save_db(db); return jsonify({"success":True})

@app.route('/api/admin/services/config', methods=['GET', 'POST'])
def s_conf():
    db=load_db()
    if request.method=='GET': return jsonify(db['service_config'])
    if request.method=='POST': db['service_config'].update(request.json); db, _=run_auto_scheduler(db); save_db(db); return jsonify(db['service_config'])

@app.route('/api/services/schedule', methods=['GET', 'POST'])
def s_sched():
    db=load_db()
    if request.method=='GET': return jsonify(db['schedule'])
    if request.method=='POST':
        c=request.json
        duty = next((d for d in db['service_config']['duties'] if d['id'] == c['duty_id']), None)
        if duty and c['employee_id'] in duty.get('excluded_ids', []): return jsonify({"error": "Excluded"}), 400
        if duty and duty.get('is_special'):
            q = db['service_config']['rotation_queues'].get(str(duty['id']), [e['id'] for e in db['employees']])
            if c['employee_id'] in q: q.remove(c['employee_id']); q.append(c['employee_id']); db['service_config']['rotation_queues'][str(duty['id'])] = q
        t=next((s for s in db['schedule'] if s['date']==c['date'] and s['duty_id']==c['duty_id'] and s['shift_index']==c['shift_index']), None)
        if t: t['employee_id']=c['employee_id']; t['manually_locked']=True
        else: c['manually_locked']=True; c['is_locked']=False; db['schedule'].append(c)
        db, _=run_auto_scheduler(db); save_db(db); return jsonify({"success":True})

@app.route('/api/services/unavailability', methods=['GET', 'POST', 'DELETE'])
def s_unavail():
    db=load_db()
    if request.method=='GET':
        eid=request.args.get('employee_id'); return jsonify([u for u in db['unavailability'] if u['employee_id']==int(eid)]) if eid else jsonify(db['unavailability'])
    if request.method=='POST':
        req=request.json; now=dt.now(); r_date=dt.strptime(req['date'], '%Y-%m-%d').date()
        if now.day>=27 and r_date.month==(now+relativedelta(months=1)).month: return jsonify({"error":"Locked"}), 403
        if sum(1 for u in db['unavailability'] if u['employee_id']==req['employee_id'] and u['date'].startswith(req['date'][:7]))>=20: return jsonify({"error":"Limit"}), 400
        db['unavailability'].append(req); 
        if any(s['date']==req['date'] and s['employee_id']==req['employee_id'] for s in db['schedule']): db, _=run_auto_scheduler(db)
        save_db(db); return jsonify({"success":True})
    if request.method=='DELETE':
        db['unavailability'] = [u for u in db['unavailability'] if not (u['employee_id']==int(request.args.get('employee_id')) and u['date']==request.args.get('date'))]
        db, _=run_auto_scheduler(db); save_db(db); return jsonify({"success":True})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)