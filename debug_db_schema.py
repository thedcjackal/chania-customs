from dotenv import load_dotenv
load_dotenv()
import os
import psycopg2
from psycopg2.extras import RealDictCursor

url = os.environ.get('DATABASE_URL')
if not url:
    print("DATABASE_URL missing")
    exit(1)

try:
    conn = psycopg2.connect(url)
    cur = conn.cursor()
    
    # 1. Check duties table
    try:
        cur.execute("SELECT * FROM duties LIMIT 1")
        duties = cur.fetchall()
        print(f"Duties sample: {duties}")
        
        cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'duties';")
        cols = cur.fetchall()
        print("Columns in duties:")
        for c in cols:
            print(f" - {c[0]} ({c[1]})")
            
    except Exception as e:
        print(f"Duties check failed: {e}")
        conn.rollback()

    # 2. Check users table
    try:
        cur.execute("SELECT * FROM users LIMIT 1")
        users = cur.fetchall()
        print(f"Users sample: {users}")
        
        cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users';")
        cols = cur.fetchall()
        print("Columns in users:")
        for c in cols:
            print(f" - {c[0]} ({c[1]})")
            
    except Exception as e:
        print(f"Users check failed: {e}")


    conn.close()
except Exception as e:
    print(f"Connection failed: {e}")
