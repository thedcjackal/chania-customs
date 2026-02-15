import unittest
from datetime import date, timedelta
from scheduler_logic import run_auto_scheduler_logic

class TestDoubleSKIssues(unittest.TestCase):
    def setUp(self):
        # Mock Employees
        self.employees = [{'id': i, 'name': f'Emp{i}'} for i in range(1, 10)]
        self.duties = [
            # Duty 101: The one we are testing
            {
                'id': 101, 
                'name': 'Duty Target', 
                'shifts_per_day': 1, 
                'shift_config': [{'id': 1, 'is_within_hours': False}],
                'is_weekly': False, 
                'is_special': False, 
                'is_off_balance': False,
                'active_range': {'start': '2023-01-01', 'end': '2030-12-31'}
            },
            # Duty 202: Another duty causing "Busy" status
            {
                'id': 202, 
                'name': 'Duty Conflict', 
                'shifts_per_day': 1, 
                'shift_config': [{'id': 1, 'is_within_hours': False}],
                'is_weekly': False, # Daily
                'is_special': False, 
                'is_off_balance': False,
                'active_range': {'start': '2023-01-01', 'end': '2030-12-31'}
            }
        ]
        
        # Emp 1 prefers Double SK
        self.preferences = {'1': True}
        
        self.db_state = {
            'employees': self.employees,
            'service_config': {
                'duties': self.duties,
                'special_dates': [],
                'rotation_queues': {},
                'next_round_queues': {}
            },
            'schedule': [],
            'unavailability': [],
            'preferences': self.preferences
        }

    def test_double_booking_on_sunday(self):
        # Scenario: Emp 1 is assigned to Duty 202 on Sunday (via random chance or pre-lock).
        # We want to see if Duty 101 (Sat) forces Emp 1 to Duty 101 (Sun) -> Double Booking.
        
        # Pre-assign Emp 1 to Duty 202 on Sunday
        self.db_state['schedule'] = [
            {'date': '2023-06-04', 'duty_id': 202, 'employee_id': 1, 'shift_index': 0, 'manually_locked': True}
        ]
        
        start = date(2023, 6, 3) # Sat
        end = date(2023, 6, 4)   # Sun
        
        # Ensure Emp 1 is available for Sat
        # We need Emp 1 to be picked for Duty 101 on Sat.
        # We can force this by making everyone else unavailable on Sat for Duty 101 :)
        for i in range(2, 10):
            self.db_state['unavailability'].append({'employee_id': i, 'date': '2023-06-03'})
            
        sched, state = run_auto_scheduler_logic(self.db_state, start, end)
        
        # Check Sat Assignment for Duty 101
        sat_101 = next((s for s in sched if s['date']=='2023-06-03' and int(s['duty_id'])==101), None)
        
        # EXPECTATION UPDATE:
        # Since Emp 1 is busy on Sunday (Duty 202), and we cannot Double Book Sunday (conflict),
        # we fallback to Single Duty for Saturday.
        # But Single Duty checks "Working Tomorrow".
        # Emp 1 is Working Tomorrow (Duty 202).
        # So Emp 1 is skipped for Saturday too (to avoid burnout).
        # Since everyone else is unavailable, NO ONE is assigned.
        self.assertIsNone(sat_101, "Emp 1 should be skipped for Sat to avoid burnout (Busy Sun)")
        
            
    def test_start_on_sunday_lookback(self):
        # Scenario: Range starts on Sunday.
        # Emp 1 is assigned to Sat (in history).
        # Emp 1 prefers Double.
        # Should force Sun assignment.
        
        # Add Saturday to history
        self.db_state['schedule'] = [
            {'date': '2023-06-03', 'duty_id': 101, 'employee_id': 1, 'shift_index': 0}
        ]
        
        start = date(2023, 6, 4) # Sun only
        end = date(2023, 6, 4)
        
        # Ensure Emp 1 is available
        
        sched, state = run_auto_scheduler_logic(self.db_state, start, end)
        
        sun_101 = next((s for s in sched if s['date']=='2023-06-04' and int(s['duty_id'])==101), None)
        
        if not sun_101 or int(sun_101['employee_id']) != 1:
            import sys
            sys.stderr.write(f"\nLOG COUNT: {len(state.get('logs', []))}\n")
            sys.stderr.write("\nLOGS:\n" + "\n".join(state.get('logs', [])) + "\n")
            
        self.assertIsNotNone(sun_101, "Duty 101 should be assigned on Sunday")
        self.assertEqual(int(sun_101['employee_id']), 1, "Should lookback and pick Emp 1")

if __name__ == '__main__':
    unittest.main()
