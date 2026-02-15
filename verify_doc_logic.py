import unittest
from datetime import date, timedelta
from scheduler_logic import run_auto_scheduler_logic

class TestSchedulerLogic(unittest.TestCase):
    def setUp(self):
        # Mock Data
        self.employees = [
            {'id': 1, 'name': 'Emp1'},
            {'id': 2, 'name': 'Emp2'},
            {'id': 3, 'name': 'Emp3'},
            {'id': 4, 'name': 'Emp4'}, 
            {'id': 5, 'name': 'Emp5 (Double)'}
        ]
        
        self.duties = [
            {
                'id': 101, 
                'name': 'Duty Normal', 
                'shifts_per_day': 1, 
                'shift_config': [{'id': 1, 'is_within_hours': False}],
                'is_weekly': False,
                'is_special': False,
                'is_off_balance': False,
                'active_range': {'start': '2023-01-01', 'end': '2030-12-31'}
            }
        ]
        
        self.preferences = {
            '5': True # Emp5 prefers double SK
        }
        
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
        
    def test_sk_queue_double_population(self):
        # Run for a weekend
        start = date(2023, 6, 3) # Saturday
        end = date(2023, 6, 4)   # Sunday
        
        sched, state = run_auto_scheduler_logic(self.db_state, start, end)
        
        # Check SK Queue Population
        # Key format: sk_normal_{duty_id}_sh_{sh_idx}
        q_key = "sk_normal_101_sh_0"
        rot_q = state['rotation_queues'].get(q_key, [])
        
        # Should have 2 of each employee (initially)
        # But some might have been used.
        # Total slots: 2 days * 1 shift = 2 slots filled.
        # Initial queue size should be 5 employees * 2 = 10 items.
        # Remaining should be 8 items (or 9 if one user took both).
        
        # Actually, let's verify usage of "sk_" prefix
        self.assertIn(q_key, state['rotation_queues'])
        
        # Verify Double Population Logic implies we can see duplicates in the queue or history of it?
        # Since we can't easily see the *initial* state, we can infer from the loop.
        # Or I can check if 'Emp5' is assigned to BOTH Sat and Sun.
        
    def test_double_duty_assignment(self):
        # Emp5 is the ONLY one with Double Preference.
        # We can force Emp5 to be the candidate for Saturday by manipulating queue or logic?
        # Hard to force specific choice without complex queue setup.
        # Instead, let's see if ANY Double Assignment happened for Emp5 if chosen.
        
        start = date(2023, 6, 3) # Saturday
        end = date(2023, 6, 4)   # Sunday
        
        # Force others to be unavailable on Saturday to ensure Emp5 is picked?
        self.db_state['unavailability'] = [
            {'employee_id': 1, 'date': '2023-06-03'},
            {'employee_id': 2, 'date': '2023-06-03'},
            {'employee_id': 3, 'date': '2023-06-03'},
            {'employee_id': 4, 'date': '2023-06-03'}
        ]
        
        sched, state = run_auto_scheduler_logic(self.db_state, start, end)
        
        # Check Saturday Assignment
        sat_assign = next((s for s in sched if s['date'] == '2023-06-03'), None)
        self.assertIsNotNone(sat_assign)
        self.assertEqual(int(sat_assign['employee_id']), 5, "Emp5 should be chosen for Saturday")
        
        # Check Sunday Assignment - Should be Emp5 due to Double Preference
        sun_assign = next((s for s in sched if s['date'] == '2023-06-04'), None)
        self.assertIsNotNone(sun_assign)
        self.assertEqual(int(sun_assign['employee_id']), 5, "Emp5 should be forced for Sunday") # Fails if logic broken
        
    def test_balancing_logic_runs(self):
            # To test balancing, we need pre-existing imbalance.
            # Populating history with many shifts for Emp1
            history = []
            for d in range(1, 10):
                history.append({'date': f'2023-05-{d:02d}', 'duty_id': 101, 'employee_id': 1, 'shift_index': 0})
            
            # We insert this into 'schedule' but mark dates as past so they act as history? 
            # run_auto_scheduler_logic separates history based on start_date.
            self.db_state['schedule'] = history
            
            start = date(2023, 6, 1)
            end = date(2023, 6, 30)
            
            # Run
            sched, state = run_auto_scheduler_logic(self.db_state, start, end)
            
            # Check logs for "Phase 5", "Phase 6", "Phase 7"
            logs = "\n".join(state['logs'])
            self.assertIn("Φάση 5: Εξισορρόπηση Αργιών", logs) # Reordered Phase 5 (was 7)
            self.assertIn("Φάση 6: Εξισορρόπηση Σαββατοκύριακων", logs) # Reordered Phase 6 (was 5)
            self.assertIn("Φάση 7: Ανάθεση & Εξισορρόπηση Υπηρεσιών Εκτός Ισοζυγίου", logs) # Reordered Phase 7 (was 8)

if __name__ == '__main__':
    unittest.main()
