
import scheduler_logic
import datetime
import os
from dotenv import load_dotenv

load_dotenv()

def test_prefs():
    print("Testing Persistent Preferences...")
    conn = scheduler_logic.get_db()
    cur = conn.cursor()
    
    # 1. Drop Old Table to force schema update
    try:
        cur.execute("DROP TABLE IF EXISTS user_preferences")
        conn.commit()
        print("Dropped old table.")
    except Exception as e: 
        print(f"Drop failed: {e}")

    # Re-create table via the code paths we are testing?
    # Actually, load_state_for_scheduler creates it if not exists.
    # But we want to insert first?
    # If we insert first, we need to create it first.
    
    cur.execute("CREATE TABLE IF NOT EXISTS user_preferences (user_id INTEGER, prefer_double_sk BOOLEAN, PRIMARY KEY (user_id))")
    conn.commit()
    
    # 2. Insert Preference for User 1 (Global)
    print("Inserting preference for User 1...")
    cur.execute("INSERT INTO user_preferences (user_id, prefer_double_sk) VALUES (1, true)")
    conn.commit()
    conn.close()
    
    # 3. Load State via Scheduler Logic
    print("Loading state...")
    # Date doesn't matter for preference loading anymore, but required for function
    db = scheduler_logic.load_state_for_scheduler(datetime.date(2024, 1, 1))
    
    prefs = db['preferences']
    print(f"Loaded Preferences: {prefs}")
    
    if 1 in prefs and prefs[1] == True:
        print("✅ PASS: User 1 preference loaded successfully.")
    else:
        print("❌ FAIL: User 1 preference NOT loaded.")

if __name__ == "__main__":
    test_prefs()
