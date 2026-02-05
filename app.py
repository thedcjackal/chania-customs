from dotenv import load_dotenv
load_dotenv()

import os
import json
import datetime
import random
import psycopg2
import traceback
import re
import logging
import sys
from flask import Flask, request, jsonify, g, make_response
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from datetime import datetime as dt, timedelta
from psycopg2.extras import RealDictCursor, Json
from supabase import create_client, Client
from functools import wraps

# ==========================================
# 0. LOGGING CONFIGURATION (FORCED STDOUT)
# ==========================================
class SensitiveDataFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        msg = re.sub(r'(Bearer\s+)([a-zA-Z0-9\-\._~+/]+=*)', r'\1[REDACTED_TOKEN]', msg)
        msg = re.sub(r'([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)', r'[REDACTED_EMAIL]', msg)
        msg = re.sub(r"('password':\s*')[^']+'", r"\1[REDACTED]'", msg)
        record.msg = msg
        return True

# Force logging to system output (Console) so you can see it in Fly.io/Terminal
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("customs_api")
if logger.hasHandlers(): logger.handlers.clear()
handler = logging.StreamHandler(sys.stdout) # Write directly to console
handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
logger.addHandler(handler)
logger.addFilter(SensitiveDataFilter())

try:
    from dateutil.relativedelta import relativedelta
except ImportError:
    logger.critical("CRITICAL: 'python-dateutil' is missing. Run: pip install python-dateutil")
    exit(1)

app = Flask(__name__)

# ==========================================
# 1. SECURITY & CONFIGURATION
# ==========================================
ALLOWED_ORIGINS = [
    "http://localhost:3000",                  
    "https://customs-client.vercel.app"       
]

CORS(app, 
     resources={r"/*": {"origins": ALLOWED_ORIGINS}}, 
     supports_credentials=True,
     allow_headers=["Authorization", "Content-Type"],
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"]
)

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["2000 per day", "500 per hour"],
    storage_uri="memory://" 
)

@limiter.request_filter
def ignore_options():
    return request.method == 'OPTIONS'

# ==========================================
# 2. SUPABASE SETUP
# ==========================================
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") 

supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        logger.warning(f"Supabase Init Failed: {e}")
else:
    logger.warning("SUPABASE_URL or SUPABASE_KEY missing in .env")

# ==========================================
# 3. DATABASE CONNECTION
# ==========================================
def get_db():
    url = os.environ.get('DATABASE_URL')
    if not url:
        logger.error("DATABASE_URL environment variable is MISSING.")
        return None
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    if "sslmode=" not in url:
        joiner = "&" if "?" in url else "?"
        url = f"{url}{joiner}sslmode=require"
    try:
        return psycopg2.connect(url)
    except Exception as e:
        logger.error(f"DB Connection Failed: {e}")
        return None

# ==========================================
# 4. AUTH MIDDLEWARE
# ==========================================
def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        if 'access_token' in request.cookies:
            token = request.cookies.get('access_token')
        if not token:
            auth_header = request.headers.get('Authorization')
            if auth_header and "Bearer" in auth_header:
                token = auth_header.split(" ")[1]
        if not token:
            return jsonify({"error": "Missing Session"}), 401
        
        try:
            if supabase:
                user_response = supabase.auth.get_user(token)
                g.auth_id = user_response.user.id
            else:
                return jsonify({"error": "Server Config Error"}), 500
                
            conn = get_db()
            if conn:
                try:
                    cur = conn.cursor(cursor_factory=RealDictCursor)
                    cur.execute("SELECT role FROM users WHERE auth_id = %s", (g.auth_id,))
                    u_data = cur.fetchone()
                    g.current_user_role = u_data['role'] if u_data else 'user'
                finally:
                    conn.close()
            else:
                g.current_user_role = 'user'
        except Exception as e:
            logger.warning(f"Auth failed: {e}")
            return jsonify({"error": "Session Expired"}), 401

        return f(current_user={'role': g.current_user_role, 'auth_id': g.auth_id}, *args, **kwargs)
    return decorated

# ==========================================
# 5. HELPER FUNCTIONS
# ==========================================
def validate_input(data, required_fields):
    if not data: return False, "No data provided"
    for field, rules in required_fields.items():
        value = data.get(field)
        if not rules.get('optional', False) and (value is None or value == ""):
            return False, f"Field '{field}' is required"
        if rules.get('optional', False) and (value is None or value == ""):
            continue
        expected_type = rules.get('type')
        if expected_type and not isinstance(value, expected_type):
            return False, f"Field '{field}' must be {expected_type.__name__}"
        if 'regex' in rules and isinstance(value, str) and not re.match(rules['regex'], value):
            return False, f"Field '{field}' has invalid format"
    return True, None

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
    
    if start_str and end_str:
        view_start = dt.strptime(start_str, '%Y-%m').date().replace(day=1)
        end_dt = dt.strptime(end_str, '%Y-%m').date()
        view_end = (end_dt + relativedelta(months=1)) - timedelta(days=1)
    else:
        view_start = dt.min.date(); view_end = dt.max.date()

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
    
    # --- STEP A: APPLY BASE HANDICAPS ---
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
                # 1. Count Weeks (Visual)
                iso_year, iso_week, _ = s_date.isocalendar()
                week_key = f"{duty['id']}_{iso_year}_{iso_week}"
                
                if week_key not in stats[eid]['_seen_weeks']:
                    stats[eid]['duty_counts'][duty['id']] += 1
                    stats[eid]['_seen_weeks'].add(week_key)

                # 2. Score Points (Strictly Weekends/Holidays)
                if not duty.get('is_off_balance'):
                    if is_scoreable_day(s_date, special_dates_set):
                        stats[eid]['total'] += 1
                        stats[eid]['effective_total'] += 1
                
                continue 

            # --- LOGIC B: DAILY DUTIES ---
            stats[eid]['duty_counts'][duty['id']] += 1
            
            if duty.get('is_off_balance'): continue
            
            if conf.get('is_within_hours') and conf.get('default_employee_id') == eid:
                if not is_scoreable_day(s_date, special_dates_set): continue

            stats[eid]['total'] += 1
            stats[eid]['effective_total'] += 1 
            
            if not duty.get('is_special') and s_date.weekday() in [5,6]:
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
        for s in current_schedule + history:
            if int(s['employee_id']) == eid:
                if s['date'] == d_str: return "Εργάζεται"
                if not ignore_yesterday and s['date'] == prev_str: return "Εργάστηκε Χθες"
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
            needs_cover = is_scoreable_day(curr, special_dates_set) or not default_id or default_id in [int(x) for x in conf.get('excluded_ids',[])] or (default_id, d_str) in unavail_map or is_user_busy(default_id, curr, schedule, True)
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
            if not d_o: continue
            if d_o.get('is_weekly') and not is_scoreable_day(s_d, special_dates_set): continue
            conf = d_o['shift_config'][int(s.get('shift_index',0))]
            if conf.get('is_within_hours') and conf.get('default_employee_id')==int(s['employee_id']) and not is_scoreable_day(s_d, special_dates_set): continue
            sc[int(s['employee_id'])] += 1
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
                    conf = d_obj['shift_config'][int(shift.get('shift_index',0))]
                    
                    if conf.get('is_within_hours') and conf.get('default_employee_id')==donor_id and not is_scoreable_day(s_date, special_dates_set): 
                        if stagnation_count >= stagnation_limit: diagnostics.append(f"Βάρδια {shift['date']}: Κλειδωμένο Ωράριο")
                        continue
                    
                    if d_obj.get('is_weekly'): 
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
                        swapped = True; sk_swaps += 1; break
                    if swapped: break
                if swapped: break
            if swapped: break
        if not swapped: break
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

# ==========================================
# 7. ROUTES
# ==========================================
@app.errorhandler(429)
def ratelimit_handler(e):
    return jsonify(error="ratelimit_exceeded", message="Too many requests. Please try again later."), 429

@app.route('/')
@limiter.limit("60 per minute")
def home():
    return "Customs API is Secure & Running!"

@app.route('/api/debug/ssl', methods=['GET'])
def check_ssl():
    conn = get_db()
    if not conn: return jsonify({"error": "No DB connection"}), 500
    try:
        is_ssl = conn.info.ssl_in_use
        return jsonify({
            "client_ssl_active": is_ssl,
            "message": "SECURE (Client-side Verified)" if is_ssl else "NOT SECURE"
        })
    except Exception as e:
        return jsonify({"error": str(e)})
    finally:
        conn.close()

# --- AUTH SESSION MANAGEMENT (COOKIES) ---
@app.route('/api/auth/session', methods=['POST'])
@limiter.limit("10 per minute")
def set_session():
    token = request.json.get('access_token')
    if not token:
        return jsonify({"error": "Token required"}), 400
    try:
        user = supabase.auth.get_user(token)
        resp = make_response(jsonify({"success": True, "status": "Session Secured"}))
        resp.set_cookie(
            'access_token', 
            token, 
            httponly=True, 
            secure=True, 
            samesite='None',
            max_age=60*60*24*7 
        )
        return resp
    except Exception as e:
        logger.warning(f"Session set failed: {e}")
        return jsonify({"error": "Invalid Token"}), 401

@app.route('/api/auth/logout', methods=['POST'])
def logout_session():
    resp = make_response(jsonify({"success": True}))
    resp.set_cookie('access_token', '', expires=0, secure=True, httponly=True, samesite='None')
    return resp

# --- LOGIN HANDSHAKE ---
@app.route('/api/auth/exchange', methods=['GET'])
@limiter.limit("10 per minute")
@require_auth
def auth_exchange(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT * FROM users WHERE auth_id = %s", (g.auth_id,))
        user = cur.fetchone()
        if user:
            # user.pop('password', None) # Column does not exist anymore
            return jsonify(user)
        else:
            return jsonify({"error": "User profile not linked. Please contact admin."}), 404
    finally:
        conn.close()

# --- ANNOUNCEMENTS ---
@app.route('/api/announcements', methods=['GET', 'POST', 'DELETE', 'PUT'])
@limiter.limit("60 per minute")
def announcements():
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("CREATE TABLE IF NOT EXISTS announcements (id SERIAL PRIMARY KEY, date DATE, text TEXT, body TEXT, is_important BOOLEAN DEFAULT FALSE)")
        try:
            cur.execute("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS body TEXT")
            cur.execute("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_important BOOLEAN DEFAULT FALSE")
        except: 
            conn.rollback() 
        conn.commit()

        if request.method == 'GET':
            cur.execute("SELECT * FROM announcements ORDER BY date DESC")
            res = cur.fetchall()
            for r in res: r['date'] = str(r['date'])
            return jsonify(res)

        token = request.headers.get('Authorization')
        if not token: 
            if 'access_token' in request.cookies:
                token = request.cookies.get('access_token')
            else:
                return jsonify({"error": "Unauthorized"}), 401
        
        try:
             clean_token = token.split(" ")[1] if "Bearer" in token else token
             supabase.auth.get_user(clean_token)
        except: return jsonify({"error": "Invalid Token"}), 401

        if request.method == 'POST':
            data = request.json
            is_valid, error = validate_input(data, {
                'text': {'type': str, 'max_length': 200},
                'body': {'type': str, 'max_length': 5000, 'optional': True},
                'is_important': {'type': bool, 'optional': True}
            })
            if not is_valid: return jsonify({"error": error}), 400
            cur.execute("INSERT INTO announcements (text, body, is_important, date) VALUES (%s, %s, %s, CURRENT_DATE)", 
                        (data.get('text'), data.get('body', ''), data.get('is_important', False)))
            conn.commit()
            return jsonify({"success":True})
        
        if request.method == 'PUT':
            data = request.json
            is_valid, error = validate_input(data, {
                'id': {'type': int},
                'text': {'type': str, 'max_length': 200},
                'body': {'type': str, 'max_length': 5000, 'optional': True}
            })
            if not is_valid: return jsonify({"error": error}), 400
            cur.execute("UPDATE announcements SET text=%s, body=%s, is_important=%s WHERE id=%s", 
                        (data.get('text'), data.get('body', ''), data.get('is_important', False), data.get('id')))
            conn.commit()
            return jsonify({"success": True})
        
        if request.method == 'DELETE':
            cur.execute("DELETE FROM announcements WHERE id = %s", (request.args.get('id'),))
            conn.commit()
            return jsonify({"success":True})
    finally:
        conn.close()

# --- ADMIN ROUTES (USER MANAGEMENT UPDATED) ---
@app.route('/api/admin/users', methods=['GET', 'POST', 'PUT', 'DELETE'])
@limiter.limit("30 per minute")
@require_auth
def manage_users(current_user): 
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # --- GET: List Users ---
        if request.method == 'GET':
            cur.execute("SELECT * FROM users ORDER BY id")
            users = cur.fetchall()
            return jsonify(users)

        # --- POST: Create User (Supabase + DB) ---
        if request.method == 'POST':
            u = request.json
            username_to_save = u.get('email') or u.get('username')
            password = u.get('password')

            # Validation
            is_valid, error = validate_input(u, {
                'role': {'type': str, 'optional': True},
                'name': {'type': str, 'max_length': 100},
                'surname': {'type': str, 'max_length': 100}
            })
            if not is_valid: return jsonify({"error": error}), 400
            if not username_to_save: return jsonify({"error": "Email/Username is required"}), 400
            if not password: return jsonify({"error": "Password is required"}), 400

            # 1. Create User in Supabase Auth (Needs Service Role Key)
            new_auth_id = None
            try:
                user_attributes = {
                    "email": username_to_save,
                    "password": password,
                    "email_confirm": True
                }
                sb_res = supabase.auth.admin.create_user(user_attributes)
                new_auth_id = sb_res.user.id
            except Exception as e:
                logger.error(f"Supabase Create User Failed: {e}")
                return jsonify({"error": f"Failed to create auth user: {str(e)}"}), 400

            # 2. Insert Profile into Database
            try:
                cur.execute("""
                    INSERT INTO users (auth_id, username, role, name, surname, company, vessels, allowed_apps)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
                """, (
                    new_auth_id,
                    username_to_save,
                    u.get('role', 'user'), 
                    u.get('name', ''), 
                    u.get('surname', ''), 
                    u.get('company', ''), 
                    u.get('vessels', []), 
                    u.get('allowed_apps', [])
                ))
                conn.commit()
            except Exception as e:
                # If DB insert fails, try to cleanup Supabase user to keep sync
                try:
                    supabase.auth.admin.delete_user(new_auth_id)
                except: pass
                raise e

            return jsonify({"success": True})

        # --- PUT: Update User ---
        if request.method == 'PUT':
            u = request.json
            user_id = u.get('id')

            if not user_id: return jsonify({"error": "User ID required"}), 400

            # 1. Check existing user
            cur.execute("SELECT role FROM users WHERE id = %s", (user_id,))
            existing_user = cur.fetchone()
            
            if not existing_user: return jsonify({"error": "User not found"}), 404

            # 2. Role Change Security Check
            new_role = u.get('role')
            current_role_in_db = existing_user['role']

            if new_role and new_role != current_role_in_db:
                if current_user.get('role') != 'root_admin':
                    return jsonify({"error": "Security violation: Only Root Admins can change roles"}), 403

            # 3. Update DB (Profile only)
            cur.execute("""
                UPDATE users 
                SET role=%s, name=%s, surname=%s, company=%s, vessels=%s, allowed_apps=%s
                WHERE id=%s
            """, (
                u.get('role', current_role_in_db), 
                u.get('name', ''), 
                u.get('surname', ''), 
                u.get('company', ''), 
                u.get('vessels', []), 
                u.get('allowed_apps', []), 
                user_id
            ))
            conn.commit()
            return jsonify({"success": True})

        # --- DELETE: Delete User (Supabase + DB) ---
        if request.method == 'DELETE':
            user_id_to_delete = request.args.get('id')
            
            if current_user.get('role') not in ['admin', 'root_admin']:
                 return jsonify({"error": "Unauthorized"}), 403

            # 1. Get Auth ID
            cur.execute("SELECT auth_id FROM users WHERE id=%s", (user_id_to_delete,))
            target = cur.fetchone()

            # 2. Delete from Supabase Auth
            if target and target.get('auth_id'):
                try:
                    supabase.auth.admin.delete_user(target['auth_id'])
                except Exception as e:
                    logger.warning(f"Supabase delete failed (orphan might exist): {e}")

            # 3. Delete from DB
            cur.execute("DELETE FROM users WHERE id=%s", (user_id_to_delete,))
            conn.commit()
            return jsonify({"success": True})

    except Exception as e:
        conn.rollback()
        logger.error(f"User management error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/admin/employees', methods=['GET', 'PUT'])
@require_auth
def manage_employees(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'GET':
            return jsonify(get_staff_users(cur))
        if request.method == 'PUT':
            data = request.json
            if 'reorder' in data:
                if not isinstance(data['reorder'], list):
                    return jsonify({"error": "reorder must be a list"}), 400
                for index, user_id in enumerate(data['reorder']):
                    cur.execute("UPDATE users SET seniority = %s WHERE id = %s", (index + 1, user_id))
                conn.commit()
                return jsonify({"success": True})
            return jsonify({"error": "Invalid data"}), 400
    except Exception as e:
        conn.rollback()
        logger.error(f"Employee management error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/services/schedule', methods=['GET', 'POST'])
@require_auth
def schedule_route(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'GET':
            cur.execute("SELECT * FROM schedule ORDER BY date")
            rows = cur.fetchall()
            for r in rows: r['date'] = str(r['date'])
            return jsonify(rows)
        if request.method == 'POST':
            c = request.json
            is_valid, error = validate_input(c, {
                'date': {'type': str, 'regex': r'^\d{4}-\d{2}-\d{2}$'},
                'duty_id': {'type': int},
                'shift_index': {'type': int},
                'employee_id': {'type': int}
            })
            if not is_valid: return jsonify({"error": error}), 400
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
@require_auth
def run_scheduler_route(current_user):
    try:
        req = request.json
        # 1. Debug Input
        print(f"DEBUG: Input received: {req}", flush=True)
        
        is_valid, error = validate_input(req, {
            'start': {'type': str, 'regex': r'^\d{4}-\d{2}$'},
            'end': {'type': str, 'regex': r'^\d{4}-\d{2}$'}
        })
        if not is_valid: 
            print(f"DEBUG: Validation failed: {error}", flush=True)
            return jsonify({"error": error}), 400
        
        try:
            start_date = dt.strptime(req['start'] + '-01', '%Y-%m-%d').date()
        except Exception as e:
            print(f"DEBUG: Date Parse Failed: {e}", flush=True)
            return jsonify({"error": f"Date Parsing Error: {str(e)}"}), 400
        
        # 2. Load DB (Auto-Inits Table if missing)
        db = load_state_for_scheduler(start_date)
        if not db: 
            print("DEBUG: DB Load Failed", flush=True)
            return jsonify({"error": "DB Load Failed"}), 500
        
        end_date_month = dt.strptime(req['end'] + '-01', '%Y-%m-%d')
        end_date = (end_date_month + relativedelta(months=1) - timedelta(days=1)).date()
        
    except Exception as e:
        logger.error(f"Scheduler Setup Error: {str(e)}", exc_info=True)
        return jsonify({"error": "Scheduler Setup Error", "details": str(e)}), 400
    
    try:
        new_schedule, res_meta = run_auto_scheduler_logic(db, start_date, end_date)
    except Exception as e:
        logger.error(f"Scheduler Logic Crash: {traceback.format_exc()}", exc_info=True)
        return jsonify({"error": "Scheduler Algorithm Crash", "details": str(e)}), 500
    
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
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
        logger.error("DB Save Error in Scheduler", exc_info=True)
        return jsonify({"error": "DB Save Error", "details": str(e)}), 500
    finally:
        conn.close()
    return jsonify({"success": True, "logs": res_meta['logs']})

@app.route('/api/services/balance', methods=['GET'])
@require_auth
def get_balance(current_user):
    start_str = request.args.get('start')
    end_str = request.args.get('end')
    return jsonify(calculate_db_balance(start_str, end_str))

@app.route('/api/services/unavailability', methods=['GET', 'POST', 'DELETE'])
@require_auth
def s_unavail(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
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
            is_valid, error = validate_input(u, {
                'employee_id': {'type': int},
                'date': {'type': str, 'regex': r'^\d{4}-\d{2}-\d{2}$'}
            })
            if not is_valid: return jsonify({"error": error}), 400
            cur.execute("INSERT INTO unavailability (employee_id, date) VALUES (%s, %s) ON CONFLICT DO NOTHING", (u.get('employee_id'), u.get('date')))
            conn.commit()
            return jsonify({"success":True})
        if request.method=='DELETE':
            cur.execute("DELETE FROM unavailability WHERE employee_id=%s AND date=%s", (request.args.get('employee_id'), request.args.get('date')))
            conn.commit()
            return jsonify({"success":True})
    finally:
        conn.close()

@app.route('/api/services/preferences', methods=['GET', 'POST'])
@require_auth
def s_prefs(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
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
            is_valid, error = validate_input(d, {
                'user_id': {'type': int},
                'month': {'type': str, 'regex': r'^\d{4}-\d{2}$'},
                'value': {'type': bool}
            })
            if not is_valid: return jsonify({"error": error}), 400
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

@app.route('/api/services/clear_schedule', methods=['POST'])
@require_auth
def clear_schedule(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor()
    req = request.json
    try:
        is_valid, error = validate_input(req, {
            'start_date': {'type': str},
            'end_date': {'type': str}
        })
        if not is_valid: return jsonify({"error": error}), 400
        start_date = dt.strptime(req['start_date'], '%Y-%m-%d').date() if len(req['start_date']) > 7 else dt.strptime(req['start_date'], '%Y-%m').date()
        end_date = dt.strptime(req['end_date'], '%Y-%m-%d').date() if len(req['end_date']) > 7 else (dt.strptime(req['end_date'], '%Y-%m') + relativedelta(months=1) - timedelta(days=1)).date()
        cur.execute("DELETE FROM schedule WHERE date >= %s AND date <= %s", (start_date, end_date))
        conn.commit()
        return jsonify({"success": True})
    finally:
        conn.close()

@app.route('/api/reservations', methods=['GET', 'POST', 'PUT', 'DELETE'])
@require_auth
def reservations(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
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
            is_valid, error = validate_input(r, {
                'date': {'type': str, 'regex': r'^\d{4}-\d{2}-\d{2}$'},
                'vessel': {'type': str},
                'quantity': {'type': (int, float)},
                'fuel_type': {'type': str},
                'user_company': {'type': str},
                'supply_company': {'type': str},
                'assigned_employee': {'type': int, 'optional': True}
            })
            if not is_valid: return jsonify({"error": error}), 400
            cur.execute("""
                INSERT INTO reservations (date, vessel, user_company, supply_company, fuel_type, quantity, payment_method, mrn, status, flags, location_x, location_y, assigned_employee)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """, (r.get('date'), r.get('vessel'), r.get('user_company'), r.get('supply_company'), r.get('fuel_type'), r.get('quantity'), r.get('payment_method'), r.get('mrn'), 'OK', r.get('flags', []), r.get('location', {}).get('x',0), r.get('location', {}).get('y',0), r.get('assigned_employee')))
            conn.commit()
            return jsonify({"success":True})
        if request.method == 'PUT':
            rid = request.json.get('id')
            if not rid: return jsonify({"error": "ID required"}), 400
            updates = request.json.get('updates', {})
            ALLOWED_COLS = {
                'vessel', 'user_company', 'supply_company', 'fuel_type', 
                'quantity', 'payment_method', 'mrn', 'status', 'assigned_employee',
                'flags', 'location' 
            }
            fields = []; vals = []
            for k, v in updates.items():
                if k not in ALLOWED_COLS: continue  
                if k == 'location':
                    fields.append("location_x=%s"); vals.append(v.get('x', 0))
                    fields.append("location_y=%s"); vals.append(v.get('y', 0))
                else:
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
@require_auth
def daily_status(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'GET':
            cur.execute("SELECT * FROM daily_status WHERE date = %s", (request.args.get('date'),))
            res = cur.fetchone()
            return jsonify(res if res else {"finalized": False})
        if request.method == 'POST':
            is_valid, error = validate_input(request.json, {
                'date': {'type': str, 'regex': r'^\d{4}-\d{2}-\d{2}$'},
                'finalized': {'type': bool}
            })
            if not is_valid: return jsonify({"error": error}), 400
            cur.execute("""
                INSERT INTO daily_status (date, finalized) VALUES (%s, %s)
                ON CONFLICT (date) DO UPDATE SET finalized = EXCLUDED.finalized
            """, (request.json.get('date'), request.json.get('finalized')))
            conn.commit()
            return jsonify({"success": True})
    finally:
        conn.close()

@app.route('/api/admin/settings', methods=['GET', 'POST'])
@require_auth
def settings(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS signee_name TEXT")
        cur.execute("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS declaration_deadline INTEGER")
        conn.commit()
        if request.method == 'GET':
            cur.execute("SELECT * FROM app_settings WHERE id = 1")
            row = cur.fetchone()
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

@app.route('/api/admin/schedule_metadata', methods=['GET', 'POST'])
@require_auth
def schedule_metadata(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
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
            is_valid, error = validate_input(d, {
                'month': {'type': str, 'regex': r'^\d{4}-\d{2}$'},
                'protocol_num': {'type': str, 'optional': True},
                'protocol_date': {'type': str, 'optional': True}
            })
            if not is_valid: return jsonify({"error": error}), 400
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

@app.route('/api/admin/reference', methods=['GET', 'POST', 'PUT', 'DELETE'])
@require_auth
def reference(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'GET':
            cur.execute("SELECT companies, fuel_types FROM app_settings WHERE id = 1")
            res = cur.fetchone()
            return jsonify({"companies": res['companies'], "fuel_types": res['fuel_types']})
        if request.method == 'POST':
            typ = request.json.get('type') 
            val = request.json.get('value')
            if not val: return jsonify({"error": "Value required"}), 400
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
@require_auth
def config_route(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
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
                if not d.get('name'): return jsonify({"error": "Duty Name required"}), 400
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

@app.route('/api/admin/special_dates', methods=['GET', 'POST', 'DELETE'])
@require_auth
def special_dates_route(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
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
            if not d or not re.match(r'^\d{4}-\d{2}-\d{2}$', str(d)):
                 return jsonify({"error": "Invalid Date"}), 400
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

@app.route('/api/directory', methods=['GET'])
def get_directory():
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("CREATE TABLE IF NOT EXISTS directory_departments (id SERIAL PRIMARY KEY, name TEXT UNIQUE, sequence INTEGER DEFAULT 999)")
        cur.execute("CREATE TABLE IF NOT EXISTS directory_phones (id SERIAL PRIMARY KEY, dept_id INTEGER REFERENCES directory_departments(id) ON DELETE CASCADE, number TEXT, is_supervisor BOOLEAN DEFAULT FALSE)")
        try:
            cur.execute("ALTER TABLE directory_departments ADD COLUMN IF NOT EXISTS sequence INTEGER DEFAULT 999")
            cur.execute("ALTER TABLE directory_phones DROP COLUMN IF EXISTS name") 
        except: pass
        conn.commit()
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

@app.route('/api/directory/departments', methods=['POST', 'PUT', 'DELETE'])
@require_auth
def manage_departments(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'POST':
            if request.json.get('action') == 'reorder':
                id_list = request.json.get('ordered_ids', [])
                for idx, dept_id in enumerate(id_list):
                    cur.execute("UPDATE directory_departments SET sequence = %s WHERE id = %s", (idx, dept_id))
                conn.commit()
                return jsonify({"success": True})
            name = request.json.get('name')
            if not name: return jsonify({"error": "Name required"}), 400
            cur.execute("SELECT COALESCE(MAX(sequence), 0) + 1 as next_seq FROM directory_departments")
            next_seq = cur.fetchone()['next_seq']
            cur.execute("INSERT INTO directory_departments (name, sequence) VALUES (%s, %s) RETURNING id", (name, next_seq))
            conn.commit()
            return jsonify({"success": True})
        if request.method == 'PUT':
            name = request.json.get('name')
            dept_id = request.json.get('id')
            if not name or not dept_id: return jsonify({"error": "Name and ID required"}), 400
            cur.execute("UPDATE directory_departments SET name = %s WHERE id = %s", (name, dept_id))
            conn.commit()
            return jsonify({"success": True})
        if request.method == 'DELETE':
            cur.execute("DELETE FROM directory_departments WHERE id = %s", (request.args.get('id'),))
            conn.commit()
            return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        logger.error(f"Error managing departments: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/directory/phones', methods=['POST', 'PUT', 'DELETE'])
@require_auth
def manage_phones(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'POST':
            d = request.json
            is_valid, error = validate_input(d, {
                'dept_id': {'type': int},
                'number': {'type': str, 'max_length': 20}
            })
            if not is_valid: return jsonify({"error": error}), 400
            cur.execute("INSERT INTO directory_phones (dept_id, number, is_supervisor) VALUES (%s, %s, %s)", 
                        (d['dept_id'], d['number'], d.get('is_supervisor', False)))
            conn.commit()
            return jsonify({"success": True})
        if request.method == 'PUT':
            d = request.json
            is_valid, error = validate_input(d, {
                'id': {'type': int},
                'number': {'type': str, 'max_length': 20}
            })
            if not is_valid: return jsonify({"error": error}), 400
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
        logger.error(f"Error managing phones: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.after_request
def add_security_headers(response):
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    
    # ------------------ CRITICAL CSP UPDATE ------------------
    # ADDED http://localhost:5000 and http://127.0.0.1:5000 to allow local API access
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' http://localhost:5000 http://127.0.0.1:5000 https://customs-api.fly.dev https://*.supabase.co"
    # ---------------------------------------------------------
    
    return response

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)