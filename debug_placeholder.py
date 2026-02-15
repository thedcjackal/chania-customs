
import sys
import os
import logging
from datetime import date, datetime, timedelta
import psycopg2
from psycopg2.extras import RealDictCursor
import scheduler_logic
from scheduler_logic import run_auto_scheduler_logic as run_scheduler

# Simple mock logging
def log(msg):
    print(msg)

scheduler_logic.log = log

# We need to fetch data. 
# Since I cannot connect to the actual DB easily without credentials or context of app.py's db setup,
# I will try to use the `app.py` context if possible, or just import app and use its db.
# Let's try importing app.

# Removed app import


# Run the scheduler

# Zombie code removed


from dotenv import load_dotenv
load_dotenv()

if __name__ == "__main__":
    # Removed app context dependency
    if True:


        start_date = date(2026, 3, 1)
        end_date = date(2026, 3, 31)
        
        print(f"Loading DB state for {start_date}...")
        try:
             db_data = scheduler_logic.load_state_for_scheduler(start_date)
        except Exception as e:
             print(f"Error loading state: {e}")
             import traceback
             traceback.print_exc()
             sys.exit(1)

        # FORCE ALL to want double duty for debugging purposes (DISABLED)
        # Note: employees is a list of dicts [{'id': 1, ...}, ...]
        # all_ids = [e['id'] for e in db_data['employees']]
        # db_data['preferences'] = {uid: True for uid in all_ids}
        # print(f"DEBUG: Forced Double Duty preferences for {len(all_ids)} employees.")


        print(f"Data fetched. Employees: {len(db_data['employees'])}, Duties: {len(db_data['service_config']['duties'])}")
        for d in db_data['service_config']['duties']:        
             print(f"  Duty: {d['name']} (ID: {d['id']}) Special={d['is_special']} Weekly={d['is_weekly']} OffBal={d['is_off_balance']}")
             for s in d['shift_config']:
                  print(f"    Shift: WithinHours={s.get('is_within_hours', False)}")

        print("Running scheduler for MONTH=3 YEAR=2026 (Next Month)...")

        
        schedule, _ = scheduler_logic.run_auto_scheduler_logic(db_data, start_date, end_date)
        
        print(f"Scheduler finished. Generated {len(schedule)} assignments.")


