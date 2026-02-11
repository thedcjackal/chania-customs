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

# IMPORT SCHEDULER LOGIC
import scheduler_logic

# ==========================================
# 0. LOGGING CONFIGURATION
# ==========================================
class SensitiveDataFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        msg = re.sub(r'(Bearer\s+)([a-zA-Z0-9\-\._~+/]+=*)', r'\1[REDACTED_TOKEN]', msg)
        msg = re.sub(r'([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)', r'[REDACTED_EMAIL]', msg)
        msg = re.sub(r"('password':\s*')[^']+'", r"\1[REDACTED]'", msg)
        record.msg = msg
        return True

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("customs_api")
if logger.hasHandlers(): logger.handlers.clear()
handler = logging.StreamHandler(sys.stdout)
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
# 4. AUTH MIDDLEWARE (WITH CACHING)
# ==========================================
# Cache structure: { token: { 'auth_id': str, 'db_user': dict, 'expires': float } }
TOKEN_CACHE = {}

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
        
        # --- CACHE CHECK ---
        # If token is valid in cache, skip Supabase call to prevent timeouts
        now = datetime.datetime.now().timestamp()
        if token in TOKEN_CACHE:
            cached = TOKEN_CACHE[token]
            if cached['expires'] > now:
                g.auth_id = cached['auth_id']
                g.current_user = cached['db_user']
                return f(current_user=g.current_user, *args, **kwargs)

        try:
            if supabase:
                # This call is what usually times out
                user_response = supabase.auth.get_user(token)
                g.auth_id = user_response.user.id
            else:
                return jsonify({"error": "Server Config Error"}), 500
                
            conn = get_db()
            if conn:
                try:
                    cur = conn.cursor(cursor_factory=RealDictCursor)
                    cur.execute("SELECT id, role, auth_id FROM users WHERE auth_id = %s", (g.auth_id,))
                    u_data = cur.fetchone()
                    g.current_user = u_data if u_data else {'role': 'user', 'auth_id': g.auth_id, 'id': 0}
                    
                    # --- UPDATE CACHE ---
                    # Cache successful auth for 60 seconds
                    TOKEN_CACHE[token] = {
                        'auth_id': g.auth_id,
                        'db_user': g.current_user,
                        'expires': now + 60 
                    }
                finally:
                    conn.close()
            else:
                g.current_user = {'role': 'user', 'auth_id': g.auth_id, 'id': 0}
        except Exception as e:
            logger.warning(f"Auth failed: {e}")
            return jsonify({"error": "Session Expired"}), 401

        return f(current_user=g.current_user, *args, **kwargs)
    return decorated

# ==========================================
# 5. HELPER FUNCTIONS
# ==========================================
# ==========================================
# 5. HELPER FUNCTIONS
# ==========================================
def validate_input(data, required_fields):
    if not data: return False, "No data provided"
    for field, rules in required_fields.items():
        value = data.get(field)
        
        # Check for required fields
        if not rules.get('optional', False) and (value is None or value == ""):
            return False, f"Field '{field}' is required"
        
        # Skip type checks if optional field is missing
        if rules.get('optional', False) and (value is None or value == ""):
            continue
        
        expected_type = rules.get('type')
        if expected_type and not isinstance(value, expected_type):
            # FIX: Handle tuple of types (e.g., (int, float)) for error message
            if isinstance(expected_type, tuple):
                type_names = " or ".join([t.__name__ for t in expected_type])
                return False, f"Field '{field}' must be {type_names}"
            else:
                return False, f"Field '{field}' must be {expected_type.__name__}"
        
        if 'regex' in rules and isinstance(value, str) and not re.match(rules['regex'], value):
            return False, f"Field '{field}' has invalid format"
            
    return True, None
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
            # Use imported helper
            return jsonify(scheduler_logic.get_staff_users(cur))
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
        
        # 2. Load DB via external module
        db = scheduler_logic.load_state_for_scheduler(start_date)
        if not db: 
            print("DEBUG: DB Load Failed", flush=True)
            return jsonify({"error": "DB Load Failed"}), 500
        
        end_date_month = dt.strptime(req['end'] + '-01', '%Y-%m-%d')
        end_date = (end_date_month + relativedelta(months=1) - timedelta(days=1)).date()
        
    except Exception as e:
        logger.error(f"Scheduler Setup Error: {str(e)}", exc_info=True)
        return jsonify({"error": "Scheduler Setup Error", "details": str(e)}), 400
    
    try:
        # Call external logic
        new_schedule, res_meta = scheduler_logic.run_auto_scheduler_logic(db, start_date, end_date)
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
    # Use imported calculation
    return jsonify(scheduler_logic.calculate_db_balance(start_str, end_str))

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

@app.route('/api/fuel/defaults', methods=['GET'])
@require_auth
def get_fuel_defaults(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Fetch defaults for the authenticated user
        cur.execute("""
            SELECT vessel_name, fuel_type, supply_company, payment_method, mrn, location_x, location_y
            FROM fuel_user_defaults 
            WHERE user_id = %s
        """, (g.auth_id,))
        rows = cur.fetchall()
        
        # Convert to a dictionary keyed by vessel name for fast lookup
        defaults_map = {}
        for r in rows:
            defaults_map[r['vessel_name']] = {
                'fuel_type': r['fuel_type'],
                'supply_company': r['supply_company'],
                'payment_method': r['payment_method'],
                'mrn': r['mrn'],
                'location': {'x': r['location_x'], 'y': r['location_y']}
            }
        return jsonify(defaults_map)
    finally:
        conn.close()

@app.route('/api/reservations', methods=['GET', 'POST', 'PUT', 'DELETE'])
@require_auth
def reservations(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # --- 1. ROBUST MIGRATION (Runs on every request to ensure DB is sync) ---
        # We commit immediately after these changes to ensure they persist before the SELECT/INSERT
        try:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS reservations (
                    id SERIAL PRIMARY KEY,
                    date DATE,
                    vessel TEXT,
                    user_company TEXT,
                    supply_company TEXT,
                    fuel_type TEXT,
                    quantity INTEGER,
                    payment_method TEXT,
                    mrn TEXT,
                    status TEXT,
                    flags TEXT[], 
                    location_x FLOAT,
                    location_y FLOAT,
                    assigned_employee INTEGER,
                    user_name TEXT
                )
            """)
            # Add columns individually and commit to avoid block failures
            cur.execute("ALTER TABLE reservations ADD COLUMN IF NOT EXISTS user_name TEXT")
            cur.execute("ALTER TABLE reservations ADD COLUMN IF NOT EXISTS location_x FLOAT")
            cur.execute("ALTER TABLE reservations ADD COLUMN IF NOT EXISTS location_y FLOAT")
            cur.execute("ALTER TABLE reservations ADD COLUMN IF NOT EXISTS assigned_employee INTEGER")
            conn.commit() # <--- CRITICAL COMMIT
        except Exception as e:
            conn.rollback()
            print(f"Migration Warning: {e}") 

        # --- 2. GET REQUEST ---
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
        
        # --- 3. POST REQUEST ---
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
            
            # Insert Reservation
            cur.execute("""
                INSERT INTO reservations (date, vessel, user_company, supply_company, fuel_type, quantity, payment_method, mrn, status, flags, location_x, location_y, assigned_employee, user_name)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """, (
                r.get('date'), r.get('vessel'), r.get('user_company'), r.get('supply_company'), r.get('fuel_type'), 
                r.get('quantity'), r.get('payment_method'), r.get('mrn'), 'OK', r.get('flags', []), 
                r.get('location', {}).get('x', 0), r.get('location', {}).get('y', 0), 
                r.get('assigned_employee'), r.get('user_name', '')
            ))
            
            # Auto-save defaults
            try:
                cur.execute("""
                    INSERT INTO fuel_user_defaults (user_id, vessel_name, fuel_type, supply_company, payment_method, mrn, location_x, location_y, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (user_id, vessel_name) 
                    DO UPDATE SET 
                        fuel_type = EXCLUDED.fuel_type,
                        supply_company = EXCLUDED.supply_company,
                        payment_method = EXCLUDED.payment_method,
                        mrn = EXCLUDED.mrn,
                        location_x = EXCLUDED.location_x,
                        location_y = EXCLUDED.location_y,
                        updated_at = NOW()
                """, (
                    g.auth_id,
                    r.get('vessel'),
                    r.get('fuel_type'),
                    r.get('supply_company'),
                    r.get('payment_method'),
                    r.get('mrn'),
                    r.get('location', {}).get('x', 0),
                    r.get('location', {}).get('y', 0)
                ))
            except Exception as e:
                print(f"Defaults save warning: {e}")

            conn.commit()
            return jsonify({"success":True})
        
        # --- 4. PUT REQUEST ---
        if request.method == 'PUT':
            rid = request.json.get('id')
            if not rid: return jsonify({"error": "ID required"}), 400
            updates = request.json.get('updates', {})
            ALLOWED_COLS = {'vessel', 'user_company', 'supply_company', 'fuel_type', 'quantity', 'payment_method', 'mrn', 'status', 'assigned_employee', 'flags', 'location'}
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

        # --- 5. DELETE REQUEST ---
        if request.method == 'DELETE':
            cur.execute("DELETE FROM reservations WHERE id = %s", (request.args.get('id'),))
            conn.commit()
            return jsonify({"success": True})

    except Exception as e:
        conn.rollback()
        # Log the specific DB error to the console
        print(f"DB Error in /api/reservations: {str(e)}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/user/vessels', methods=['POST'])
@require_auth
def manage_user_vessels(current_user):
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        data = request.json
        target_user_id = data.get('id')
        new_vessels = data.get('vessels', [])

        # --- SECURITY CHECK ---
        cur.execute("SELECT auth_id, role FROM users WHERE id = %s", (target_user_id,))
        target_user = cur.fetchone()

        if not target_user:
            return jsonify({"error": "User not found"}), 404

        is_admin = current_user['role'] in ['admin', 'root_admin']
        is_owner = target_user['auth_id'] == current_user['auth_id']

        if not (is_admin or is_owner):
            return jsonify({"error": "Unauthorized"}), 403

        # --- UPDATE ---
        cur.execute("""
            UPDATE users 
            SET vessels = %s 
            WHERE id = %s 
            RETURNING vessels
        """, (new_vessels, target_user_id))
        
        updated_row = cur.fetchone()
        conn.commit()
        
        return jsonify({
            "success": True, 
            "vessels": updated_row['vessels'] if updated_row else []
        })

    except Exception as e:
        conn.rollback()
        logger.error(f"Vessel update error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

# --- VESSEL MAP (For Admin Reservation Form Dropdown) ---
@app.route('/api/vessel_map', methods=['GET'])
@require_auth
def vessel_map(current_user):
    """Returns a mapping of fuel_user companies to their vessels and defaults for admin dropdown."""
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Get all fuel_users with their company, vessels, and auth_id
        cur.execute("""
            SELECT auth_id, company, vessels 
            FROM users 
            WHERE role = 'fuel_user' AND company IS NOT NULL AND company != ''
        """)
        users = cur.fetchall()
        
        # Build mapping: { "Company Name": { "vessels": ["Vessel1", ...], "defaults": { "Vessel1": {...} } }, ... }
        result_map = {}
        for u in users:
            company = u.get('company', '')
            vessels = u.get('vessels', [])
            auth_id = u.get('auth_id', '')
            
            if company:
                if company not in result_map:
                    result_map[company] = {"vessels": [], "defaults": {}}
                
                if vessels:
                    # Merge vessels, avoiding duplicates
                    for v in vessels:
                        if v and v not in result_map[company]["vessels"]:
                            result_map[company]["vessels"].append(v)
                
                # Fetch fuel_user_defaults for this user
                if auth_id:
                    cur.execute("""
                        SELECT vessel_name, fuel_type, supply_company, payment_method, mrn, location_x, location_y
                        FROM fuel_user_defaults 
                        WHERE user_id = %s
                    """, (auth_id,))
                    defaults_rows = cur.fetchall()
                    for d in defaults_rows:
                        vessel_name = d.get('vessel_name', '')
                        if vessel_name:
                            result_map[company]["defaults"][vessel_name] = {
                                'fuel_type': d.get('fuel_type'),
                                'supply_company': d.get('supply_company'),
                                'payment_method': d.get('payment_method'),
                                'mrn': d.get('mrn'),
                                'location': {'x': d.get('location_x'), 'y': d.get('location_y')}
                            }
        
        return jsonify(result_map)
    except Exception as e:
        logger.error(f"Vessel map error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

# --- RESERVATION COUNT CHECK (For limit warning) ---
@app.route('/api/reservation_count', methods=['GET'])
@require_auth
def reservation_count(current_user):
    """Returns the count of reservations for a date and whether it's over the limit."""
    conn = get_db()
    if not conn: return jsonify({"error": "DB Connection Failed"}), 500
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        date = request.args.get('date')
        if not date:
            return jsonify({"error": "Date parameter required"}), 400
        
        # Get count of reservations for this date
        cur.execute("SELECT COUNT(*) as count FROM reservations WHERE date = %s", (date,))
        count_result = cur.fetchone()
        count = count_result['count'] if count_result else 0
        
        # Get settings to find limit for this day
        cur.execute("SELECT weekly_schedule FROM app_settings WHERE id = 1")
        settings_row = cur.fetchone()
        weekly_schedule = settings_row.get('weekly_schedule', {}) if settings_row else {}
        
        # Get day name in Greek
        import datetime
        date_obj = datetime.datetime.strptime(date, '%Y-%m-%d')
        days_greek = ["Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο", "Κυριακή"]
        day_name = days_greek[date_obj.weekday()]
        
        day_config = weekly_schedule.get(day_name, {})
        limit = day_config.get('limit')  # May be None if no limit set
        is_open = day_config.get('open', True)
        
        is_over_limit = False
        if limit is not None and count >= limit:
            is_over_limit = True
        
        return jsonify({
            "date": date,
            "count": count,
            "limit": limit,
            "is_over_limit": is_over_limit,
            "is_open": is_open
        })
    except Exception as e:
        logger.error(f"Reservation count error: {e}")
        return jsonify({"error": str(e)}), 500
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