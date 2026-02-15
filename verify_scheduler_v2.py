
import scheduler_logic
from datetime import datetime
import json

# Mock data setup - minimal required for run_auto_scheduler_logic
# We need to simulate:
# 1. Employees with and without double_duty_prefs
# 2. Duties (Daily)
# 3. Special Dates
# 4. Schedule/History placeholders


import scheduler_logic
from datetime import datetime, date
import json

# Mock data setup
def run_test():
    print("Testing Scheduler with Double SK Logic...")
    
    # 1. Employees
    employees = [
        {'id': 1, 'name': 'Emp Double 1'},
        {'id': 2, 'name': 'Emp Double 2'},
        {'id': 3, 'name': 'Emp Single 1'},
        {'id': 4, 'name': 'Emp Single 2'},
        {'id': 5, 'name': 'Emp Single 3'},
        {'id': 6, 'name': 'Emp Single 4'},
    ]
    
    # 2. Preferences - Emp 1 & 2 want Double SK
    # Based on code: db['preferences'] is a dict
    preferences = {
        1: True, # Double SK
        2: True  # Double SK
    }
    
    # 3. Duties
    duties = [
        {
            'id': 1, 'name': 'Daily Duty', 'type': 'daily', 'shifts_per_day': 1,
            'is_weekly': False, 'is_special': False, 'is_off_balance': False,
            'active_range': {'start': '2024-01-01', 'end': '2024-12-31'},
            'shift_config': [{'id': 101, 'is_within_hours': False, 'active_range': {'start': '2024-01-01', 'end': '2024-12-31'}}]
        }
    ]
    
    # 4. Special Dates
    # Sat Jan 6 2024 is Special
    special_dates = ['2024-01-06']
    
    
    # 5. DB Construction
    # FORCE EMP 1 (Double SK) to be the ONLY ONE available on Sat Jan 13
    # This guarantees they get the shift, triggering the Double SK logic for Sun Jan 14.
    unavail = []
    target_sat = '2024-01-13'
    for ignored_id in [2, 3, 4, 5, 6]:
        unavail.append({'employee_id': ignored_id, 'date': target_sat})
        
    db_mock = {
        'employees': employees,
        'preferences': preferences,
        'service_config': {
            'duties': duties,
            'special_dates': special_dates,
            'rotation_queues': {},
            'next_round_queues': {}
        },
        'schedule': [],   
        'unavailability': unavail
    }

    
    # Run Scheduler for Jan 2024
    start_date = date(2024, 1, 1)
    end_date = date(2024, 1, 31)
    
    try:
        # Call the logic
        schedule_result, extra_data = scheduler_logic.run_auto_scheduler_logic(
            db_mock, start_date, end_date
        )
        print("Scheduler ran successfully.")
        
        # Verification 1: Sat Jan 13 (Normal) -> Sun Jan 14 (Normal)
        sat_13 = next((s for s in schedule_result if s['date'] == '2024-01-13'), None)
        sun_14 = next((s for s in schedule_result if s['date'] == '2024-01-14'), None)
        
        if sat_13 and sun_14:
            print(f"Jan 13 (Sat): {sat_13['employee_id']} - Jan 14 (Sun): {sun_14['employee_id']}")
            sat_uid = int(sat_13['employee_id'])
            sun_uid = int(sun_14['employee_id'])
            
            if sat_uid in preferences:
                if sat_uid == sun_uid:
                    print("✅ PASS: Double Duty user got both Sat and Sun on normal weekend.")
                else:
                    print(f"❌ FAIL: Double Duty user {sat_uid} didn't get Sunday (got {sun_uid}).")
            else:
                print(f"ℹ️ Info: Sat assignee {sat_uid} was not a Double Duty user.")
                if sat_uid == sun_uid:
                    print("ℹ️ Note: Standard user got double duty (random chance or lack of others).")

        # Verification 2: Sat Jan 6 (Special) -> Sun Jan 7 (Special/Normal? Jan 7 isn't special in my list, so normal)
        # If Saturday is special, we should NOT force double.
        sat_6 = next((s for s in schedule_result if s['date'] == '2024-01-06'), None)
        sun_7 = next((s for s in schedule_result if s['date'] == '2024-01-07'), None)
        
        if sat_6 and sun_7:
            print(f"Jan 6 (Special Sat): {sat_6['employee_id']} - Jan 7 (Sun): {sun_7['employee_id']}")
            sat_uid = int(sat_6['employee_id'])
            sun_uid = int(sun_7['employee_id'])
            
            if sat_uid == sun_uid:
                print("⚠️ Warning: Same user on Special Sat and Sun. (Might happen if everyone else busy, but should be avoided).")
            else:
                 print("✅ PASS: Different users on Special Weekend.")

    except Exception as e:
        print(f"❌ Error running scheduler: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    run_test()
