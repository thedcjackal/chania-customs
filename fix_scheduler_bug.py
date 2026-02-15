target_file = r'c:\customs-app\scheduler_logic.py'

replacements = [
    ("if prev_uid in double_duty_prefs", "if str(prev_uid) in double_duty_prefs"),
    ("if uid in double_duty_prefs", "if str(uid) in double_duty_prefs"),
    ("if is_sat and cand in double_duty_prefs", "if is_sat and str(cand) in double_duty_prefs"),
    ("if max_id in double_duty_prefs", "if str(max_id) in double_duty_prefs"),
    ("if donor_id in double_duty_prefs", "if str(donor_id) in double_duty_prefs")
]

with open(target_file, 'r', encoding='utf-8') as f:
    content = f.read()

fixed_content = content
for search, replace in replacements:
    fixed_content = fixed_content.replace(search, replace)

if fixed_content != content:
    with open(target_file, 'w', encoding='utf-8') as f:
        f.write(fixed_content)
    print("Fixed type mismatch bugs.")
else:
    print("No changes made (patterns not found?).")
