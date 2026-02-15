import os

target_file = r'c:\customs-app\scheduler_logic.py'

new_balancing_logic = r'''    # --- BALANCING LOGIC ---
    lookback_date = (start_date - relativedelta(months=2)).replace(day=1)
    
    def get_detailed_scores(target_duties):
        # Determine employees excluded from ALL shifts of ALL target duties
        globally_excluded = set(e['id'] for e in employees)
        for d in duties:
            if d['id'] not in target_duties: continue
            for conf in d.get('shift_config', [{}]):
                exc = set(int(x) for x in conf.get('excluded_ids', []))
                globally_excluded -= (set(e['id'] for e in employees) - exc)
        
        sc = {e['id']: 0 for e in employees if e['id'] not in globally_excluded}
        for e in employees:
            if e['id'] in globally_excluded: continue
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
            eid = int(s['employee_id'])
            if eid in sc: sc[eid] += 1
        return sc

    def run_balance(target, label):
        if not target: return
        log(f"⚖️ Εξισορρόπηση {label}...")
        
        swaps_performed = 0
        stagnation_limit = 2
        stagnation_count = 0
        
        for iteration in range(500): 
            sc = get_detailed_scores(target)
            if not sc: break
            s_ids = sorted(sc.keys(), key=lambda k: sc[k])
            if len(s_ids) < 2: break
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
                    if int(shift['employee_id']) != donor_id: continue

                    s_date = dt.strptime(shift['date'], '%Y-%m-%d').date()
                    d_obj = next((d for d in duties if d['id']==int(shift['duty_id'])),None)
                    conf = d_obj.get('shift_config', [{}])[int(shift.get('shift_index',0))] if d_obj else {}
                    
                    if conf.get('is_within_hours') and conf.get('default_employee_id')==donor_id and not is_scoreable_day(s_date, special_dates_set): 
                        if stagnation_count >= stagnation_limit: diagnostics.append(f"Βάρδια {shift['date']}: Κλειδωμένο Ωράριο")
                        continue
                    
                    if d_obj and d_obj.get('is_weekly'): 
                        if stagnation_count >= stagnation_limit: diagnostics.append(f"Βάρδια {shift['date']}: Κλειδωμένη Εβδομαδιαία")
                        continue
                    
                    # --- ATOMIC SWAP LOGIC ---
                    is_pair = False
                    partner_shift = None
                    
                    if donor_id in double_duty_prefs:
                        wd = s_date.weekday()
                        target_offset = 0
                        if wd == 5: target_offset = 1 
                        elif wd == 6: target_offset = -1 
                        
                        if target_offset != 0:
                            partner_date = s_date + timedelta(days=target_offset)
                            partner_str = partner_date.strftime('%Y-%m-%d')
                            partner_shift = next((s for s in schedule 
                                                  if s['date'] == partner_str 
                                                  and int(s['employee_id']) == donor_id 
                                                  and int(s['duty_id']) == int(shift['duty_id'])
                                                  and not s.get('manually_locked')), None)
                            if partner_shift:
                                is_pair = True
                    
                    valid_receivers = [uid for uid in s_ids if sc[uid] < sc[donor_id] - 1]
                    
                    swap_success = False
                    
                    for rec_id in valid_receivers:
                        if rec_id == donor_id: continue
                        if rec_id in [int(x) for x in conf.get('excluded_ids',[])]: 
                            if stagnation_count >= stagnation_limit: diagnostics.append(f"Ο/Η {emp_map[rec_id]} Εξαιρείται")
                            continue
                        
                        if (rec_id, shift['date']) in unavail_map: 
                             if stagnation_count >= stagnation_limit: diagnostics.append(f"Ο/Η {emp_map[rec_id]} κώλυμα {shift['date']}")
                             continue
                        if is_user_busy(rec_id, s_date, schedule, False): 
                             if stagnation_count >= stagnation_limit: diagnostics.append(f"Ο/Η {emp_map[rec_id]} απασχολημένος {shift['date']}")
                             continue

                        if is_pair and partner_shift:
                            p_date = dt.strptime(partner_shift['date'], '%Y-%m-%d').date()
                            if (rec_id, partner_shift['date']) in unavail_map: continue
                            if is_user_busy(rec_id, p_date, schedule, False): continue
                            
                            shift['employee_id'] = rec_id
                            partner_shift['employee_id'] = rec_id
                            swaps_performed += 2
                            sc[donor_id] -= 2; sc[rec_id] += 2
                            move_made = True
                            log(f"   🔄 Double Swap: {emp_map.get(donor_id)} ({shift['date']}/{partner_shift['date']}) -> {emp_map.get(rec_id)}")
                            swap_success = True
                            stagnation_count = 0
                            break
                        
                        elif not is_pair:
                            shift['employee_id'] = rec_id
                            swaps_performed += 1
                            sc[donor_id] -= 1; sc[rec_id] += 1
                            move_made = True
                            swap_success = True
                            stagnation_count = 0
                            break
                    
                    if swap_success: break 
                if move_made: break 
            
            if not move_made:
                stagnation_count += 1
                if stagnation_count >= stagnation_limit:
                    log(f"⚠️ Η Εξισορρόπηση σταμάτησε (Διαφορά: {diff}). Αιτίες που δεν μειώθηκε η διαφορά:")
                    for d in list(set(diagnostics))[:5]: 
                        log(f"      - {d}")
                    break

    run_balance([d['id'] for d in duties if not d.get('is_off_balance') and not d.get('is_special')], "Κανονικών Υπηρεσιών")
    run_balance([d['id'] for d in duties if d.get('is_off_balance') and not d.get('is_special')], "Υπηρεσιών Εκτός Ισοζυγίου")

    # --- PHASE 5: Special-Date Balancing ---
    def is_special_date_only(d_str, sp_set):
        d = dt.strptime(d_str, '%Y-%m-%d').date() if isinstance(d_str, str) else d_str
        if str(d) in sp_set: return True
        recurring = f"2000-{d.strftime('%m-%d')}"
        if recurring in sp_set: return True
        return False

    def run_special_date_balance(target_duty_ids, label):
        log(f"▶️ Φάση 5: Εξισορρόπηση Αργιών ({label})...")
        sd_swaps = 0
        stagnation_limit = 2
        stagnation_count = 0

        sd_excluded = set(e['id'] for e in employees)
        for d in duties:
            if d['id'] not in target_duty_ids: continue
            for conf in d.get('shift_config', [{}]):
                exc = set(int(x) for x in conf.get('excluded_ids', []))
                sd_excluded -= (set(e['id'] for e in employees) - exc)

        for _ in range(200):
            sd_sc = {e['id']: 0 for e in employees if e['id'] not in sd_excluded}
            for s in history + schedule:
                s_d = dt.strptime(s['date'], '%Y-%m-%d').date()
                d_id = int(s['duty_id'])
                d_o = next((d for d in duties if d['id'] == d_id), None)
                if not d_o or d_o.get('is_special'): continue
                if d_o['id'] not in target_duty_ids: continue
                eid = int(s['employee_id'])
                if eid not in sd_sc: continue
                if is_special_date_only(s_d, special_dates_set):
                    sd_sc[eid] += 1

            s_sd = sorted(sd_sc.items(), key=lambda x: x[1])
            if not s_sd or s_sd[-1][1] - s_sd[0][1] <= 1: break

            swapped = False
            for i in range(len(s_sd) - 1, 0, -1):
                max_id = s_sd[i][0]
                for j in range(i):
                    min_id = s_sd[j][0]
                    if sd_sc[max_id] - sd_sc[min_id] <= 1: continue

                    max_special = [s for s in schedule if int(s['employee_id']) == max_id
                                   and int(s['duty_id']) in target_duty_ids
                                   and is_scoreable_day(s['date'], special_dates_set)
                                   and not s.get('manually_locked')
                                   and start_date <= dt.strptime(s['date'], '%Y-%m-%d').date() <= end_date]
                    max_special = [s for s in max_special if not any(d['id'] == int(s['duty_id']) and d.get('is_special') for d in duties)]

                    max_special_weekly = [s for s in max_special if any(d['id'] == int(s['duty_id']) and d.get('is_weekly') for d in duties)]
                    max_special_daily = [s for s in max_special if not any(d['id'] == int(s['duty_id']) and d.get('is_weekly') for d in duties)]

                    min_weekend_nonspecial = [s for s in schedule if int(s['employee_id']) == min_id
                                              and int(s['duty_id']) in target_duty_ids
                                              and is_scoreable_day(s['date'], special_dates_set)
                                              and not is_special_date_only(s['date'], special_dates_set)
                                              and not s.get('manually_locked')
                                              and start_date <= dt.strptime(s['date'], '%Y-%m-%d').date() <= end_date]
                    min_weekend_nonspecial = [s for s in min_weekend_nonspecial if not any(d['id'] == int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special')) for d in duties)]

                    random.shuffle(max_special_daily); random.shuffle(min_weekend_nonspecial)
                    for sd_shift in max_special_daily:
                        sd_d = next((d for d in duties if d['id'] == int(sd_shift['duty_id'])), None)
                        sd_conf = sd_d.get('shift_config', [{}])[int(sd_shift.get('shift_index', 0))] if sd_d else {}
                        if min_id in [int(x) for x in sd_conf.get('excluded_ids', [])]: continue
                        if (min_id, sd_shift['date']) in unavail_map or is_user_busy(min_id, dt.strptime(sd_shift['date'], '%Y-%m-%d').date(), schedule, False): continue
                        
                        for we_shift in min_weekend_nonspecial:
                            we_d = next((d for d in duties if d['id'] == int(we_shift['duty_id'])), None)
                            we_conf = we_d.get('shift_config', [{}])[int(we_shift.get('shift_index', 0))] if we_d else {}
                            if max_id in [int(x) for x in we_conf.get('excluded_ids', [])]: continue
                            if (max_id, we_shift['date']) in unavail_map or is_user_busy(max_id, dt.strptime(we_shift['date'], '%Y-%m-%d').date(), schedule, False): continue
                            sd_shift['employee_id'] = min_id; we_shift['employee_id'] = max_id
                            swapped = True; sd_swaps += 1; stagnation_count = 0; break
                        if swapped: break

                        sk_max = sum(1 for s in schedule if int(s['employee_id']) == max_id and is_scoreable_day(s['date'], special_dates_set) and not any(d['id']==int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special') or d.get('is_off_balance')) for d in duties))
                        sk_min = sum(1 for s in schedule if int(s['employee_id']) == min_id and is_scoreable_day(s['date'], special_dates_set) and not any(d['id']==int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special') or d.get('is_off_balance')) for d in duties))
                        
                        if sk_max > sk_min:
                            min_weekday = [s for s in schedule if int(s['employee_id']) == min_id
                                           and int(s['duty_id']) in target_duty_ids
                                           and not is_scoreable_day(s['date'], special_dates_set)
                                           and not s.get('manually_locked')
                                           and start_date <= dt.strptime(s['date'], '%Y-%m-%d').date() <= end_date]
                            min_weekday = [s for s in min_weekday if not any(d['id'] == int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special')) for d in duties)]
                            random.shuffle(min_weekday)
                            
                            for wd_shift in min_weekday:
                                wd_d = next((d for d in duties if d['id'] == int(wd_shift['duty_id'])), None)
                                wd_conf = wd_d.get('shift_config', [{}])[int(wd_shift.get('shift_index', 0))] if wd_d else {}
                                if max_id in [int(x) for x in wd_conf.get('excluded_ids', [])]: continue
                                if (max_id, wd_shift['date']) in unavail_map or is_user_busy(max_id, dt.strptime(wd_shift['date'], '%Y-%m-%d').date(), schedule, False): continue
                                sd_shift['employee_id'] = min_id; wd_shift['employee_id'] = max_id
                                swapped = True; sd_swaps += 1; stagnation_count = 0;
                                log(f"   ↪️ Fallback Swap: Special (from {emp_map.get(max_id)}) ↔ Weekday (from {emp_map.get(min_id)})")
                                break
                        if swapped: break
                    if swapped: break

                    if not swapped and max_special_weekly:
                        weekly_weeks = {}
                        for ws in max_special_weekly:
                            ws_date = dt.strptime(ws['date'], '%Y-%m-%d').date()
                            iso_y, iso_w, _ = ws_date.isocalendar()
                            wk = (int(ws['duty_id']), int(ws.get('shift_index', 0)), iso_y, iso_w)
                            weekly_weeks.setdefault(wk, []).append(ws)

                        for wk_key, wk_shifts in weekly_weeks.items():
                            duty_id, sh_idx, iso_y, iso_w = wk_key
                            wk_duty = next((d for d in duties if d['id'] == duty_id), None)
                            wk_conf = wk_duty.get('shift_config', [{}])[sh_idx] if wk_duty else {}
                            if min_id in [int(x) for x in wk_conf.get('excluded_ids', [])]: continue

                            max_wk_special = sum(1 for s in wk_shifts if is_scoreable_day(s['date'], special_dates_set) and is_special_date_only(s['date'], special_dates_set))
                            if max_wk_special == 0: continue

                            min_wk_candidates = []
                            min_all_shifts = [s for s in schedule if int(s['employee_id']) == min_id and int(s['duty_id']) == duty_id and int(s.get('shift_index', 0)) == sh_idx and not s.get('manually_locked')]
                            
                            min_weeks_map = {}
                            for ms in min_all_shifts:
                                ms_d = dt.strptime(ms['date'], '%Y-%m-%d').date()
                                iso_y_m, iso_w_m, _ = ms_d.isocalendar()
                                min_weeks_map.setdefault((iso_y_m, iso_w_m), []).append(ms)

                            for (m_y, m_w), m_shifts in min_weeks_map.items():
                                m_spec_count = sum(1 for s in m_shifts if is_scoreable_day(s['date'], special_dates_set) and is_special_date_only(s['date'], special_dates_set))
                                if m_spec_count < max_wk_special:
                                    min_wk_candidates.append((m_shifts, m_spec_count))
                            
                            min_wk_candidates.sort(key=lambda x: x[1])

                            for cand_shifts, _ in min_wk_candidates:
                                can_swap_week = True
                                for s_max in wk_shifts:
                                    if (min_id, s_max['date']) in unavail_map or is_user_busy(min_id, dt.strptime(s_max['date'], '%Y-%m-%d').date(), schedule, False):
                                        can_swap_week = False; break
                                if not can_swap_week: continue
                                
                                for s_min in cand_shifts:
                                    if (max_id, s_min['date']) in unavail_map or is_user_busy(max_id, dt.strptime(s_min['date'], '%Y-%m-%d').date(), schedule, False):
                                         can_swap_week = False; break
                                if not can_swap_week: continue

                                for s in wk_shifts: s['employee_id'] = min_id
                                for s in cand_shifts: s['employee_id'] = max_id
                                swapped = True; sd_swaps += 1; stagnation_count = 0
                                log(f"   ↪️ Εβδομαδιαία Ανταλλαγή: {emp_map.get(max_id)} (Week {iso_w}) ↔ {emp_map.get(min_id)}")
                                break
                            if swapped: break
                        if swapped: break
                    if swapped: break
                if swapped: break
            
            if not swapped:
                stagnation_count += 1
                if stagnation_count >= stagnation_limit: break
    
        log(f"✅ Ολοκληρώθηκε (Έγιναν {sd_swaps} ανταλλαγές).")

    normal_duty_ids = [d['id'] for d in duties if not d.get('is_off_balance') and not d.get('is_special')]
    if normal_duty_ids: run_special_date_balance(normal_duty_ids, "Normal")

    off_balance_duty_ids = [d['id'] for d in duties if d.get('is_off_balance') and not d.get('is_special')]
    if off_balance_duty_ids: run_special_date_balance(off_balance_duty_ids, "Off-Balance")

    # --- PHASE 6: SK Balancing ---
    log("▶️ Φάση 6: Εξισορρόπηση Σαββατοκύριακων...")
    sk_swaps = 0
    sk_win_start = (end_date - relativedelta(months=5)).replace(day=1)
    
    normal_duties = [d for d in duties if not d.get('is_off_balance') and not d.get('is_special')]
    sk_excluded = set(e['id'] for e in employees)
    for d in normal_duties:
        for conf in d.get('shift_config', [{}]):
            exc = set(int(x) for x in conf.get('excluded_ids', []))
            sk_excluded -= (set(e['id'] for e in employees) - exc)
    
    sk_stagnation_count = 0 
    sk_stagnation_limit = 2
    
    for _ in range(200):
        sk = {e['id']: 0 for e in employees if e['id'] not in sk_excluded}
        for s in history+schedule:
            if dt.strptime(s['date'],'%Y-%m-%d').date() < sk_win_start: continue
            d_o = next((d for d in duties if d['id']==int(s['duty_id'])),None)
            if not d_o or d_o.get('is_special') or d_o.get('is_off_balance'): continue
            eid = int(s['employee_id'])
            if eid in sk and is_scoreable_day(s['date'], special_dates_set): sk[eid] += 1
        
        s_sk = sorted(sk.items(), key=lambda x:x[1])
        if s_sk[-1][1] - s_sk[0][1] <= 2: break
        
        swapped = False
        max_swaps_per_iter = 5
        iter_swaps = 0
        
        for i in range(len(s_sk)-1, 0, -1):
            max_id = s_sk[i][0]
            if iter_swaps >= max_swaps_per_iter: break
            
            for j in range(i):
                min_id = s_sk[j][0]
                if sk[max_id] - sk[min_id] <= 2: continue
                
                max_we = [s for s in schedule if int(s['employee_id'])==max_id 
                          and dt.strptime(s['date'], '%Y-%m-%d').date().weekday() in [5, 6] 
                          and not s.get('manually_locked')]
                max_we = [s for s in max_we if not any(d['id']==int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special') or d.get('is_off_balance')) for d in duties)]
                
                min_wd = [s for s in schedule if int(s['employee_id'])==min_id 
                          and dt.strptime(s['date'], '%Y-%m-%d').date().weekday() not in [5, 6] 
                          and not is_special_date_only(s['date'], special_dates_set)
                          and not s.get('manually_locked')]
                min_wd = [s for s in min_wd if not any(d['id']==int(s['duty_id']) and (d.get('is_weekly') or d.get('is_special') or d.get('is_off_balance')) for d in duties)]
                
                random.shuffle(max_we); random.shuffle(min_wd)
                for we in max_we:
                    if int(we['employee_id']) != max_id: continue 
                    
                    is_double_pair = False
                    partner = None
                    if max_id in double_duty_prefs:
                         we_date = dt.strptime(we['date'], '%Y-%m-%d').date()
                         if we_date.weekday() == 5: 
                             partner_date = we_date + timedelta(days=1)
                             partner = next((s for s in schedule if s['date']==partner_date.strftime('%Y-%m-%d') and int(s['employee_id'])==max_id and int(s['duty_id'])==int(we['duty_id']) and s.get('shift_index')==we.get('shift_index') and not s.get('manually_locked')), None)
                         elif we_date.weekday() == 6: 
                             partner_date = we_date - timedelta(days=1)
                             partner = next((s for s in schedule if s['date']==partner_date.strftime('%Y-%m-%d') and int(s['employee_id'])==max_id and int(s['duty_id'])==int(we['duty_id']) and s.get('shift_index')==we.get('shift_index') and not s.get('manually_locked')), None)
                         
                         if partner: is_double_pair = True

                    if is_double_pair and partner:
                        if len(min_wd) < 2: continue 
                        
                        p_d = next((d for d in duties if d['id']==int(partner['duty_id'])), None)
                        p_conf = p_d.get('shift_config', [{}])[int(partner.get('shift_index',0))] if p_d else {}
                        
                        we_d = next((d for d in duties if d['id']==int(we['duty_id'])), None)
                        we_conf = we_d.get('shift_config', [{}])[int(we.get('shift_index',0))] if we_d else {}
                        
                        if min_id in [int(x) for x in p_conf.get('excluded_ids', [])]: continue
                        if min_id in [int(x) for x in we_conf.get('excluded_ids', [])]: continue

                        if (min_id, partner['date']) in unavail_map or is_user_busy(min_id, dt.strptime(partner['date'],'%Y-%m-%d').date(), schedule, False): continue
                        if (min_id, we['date']) in unavail_map or is_user_busy(min_id, dt.strptime(we['date'],'%Y-%m-%d').date(), schedule, False): continue

                        found_wd_pair = []
                        for wd in min_wd:
                            wd_d = next((d for d in duties if d['id']==int(wd['duty_id'])), None)
                            wd_conf = wd_d.get('shift_config', [{}])[int(wd.get('shift_index',0))] if wd_d else {}
                            if max_id in [int(x) for x in wd_conf.get('excluded_ids', [])]: continue
                            if (max_id, wd['date']) in unavail_map or is_user_busy(max_id, dt.strptime(wd['date'],'%Y-%m-%d').date(), schedule, False): continue
                            found_wd_pair.append(wd)
                            if len(found_wd_pair) == 2: break
                        
                        if len(found_wd_pair) == 2:
                            we['employee_id'] = min_id
                            partner['employee_id'] = min_id
                            found_wd_pair[0]['employee_id'] = max_id
                            found_wd_pair[1]['employee_id'] = max_id
                            
                            swapped = True; sk_swaps += 2; iter_swaps += 1
                            sk[max_id] -= 2; sk[min_id] += 2
                            log(f"   🔄 Atomic Double Swap: {emp_map.get(max_id)} (Sat {we['date']} + Sun {partner['date']}) -> {emp_map.get(min_id)}")
                            sk_stagnation_count = 0
                            break
                        else:
                            continue 
                    
                    else:
                        we_d = next((d for d in duties if d['id']==int(we['duty_id'])), None)
                        we_conf = we_d.get('shift_config', [{}])[int(we.get('shift_index',0))] if we_d else {}
                        if min_id in [int(x) for x in we_conf.get('excluded_ids', [])]: continue
                        if (min_id, we['date']) in unavail_map or is_user_busy(min_id, dt.strptime(we['date'],'%Y-%m-%d').date(), schedule, False): continue
                        
                        for wd in min_wd:
                            wd_d = next((d for d in duties if d['id']==int(wd['duty_id'])), None)
                            wd_conf = wd_d.get('shift_config', [{}])[int(wd.get('shift_index',0))] if wd_d else {}
                            if max_id in [int(x) for x in wd_conf.get('excluded_ids', [])]: continue
                            if (max_id, wd['date']) in unavail_map or is_user_busy(max_id, dt.strptime(wd['date'],'%Y-%m-%d').date(), schedule, False): continue
                            
                            we['employee_id'] = min_id; wd['employee_id'] = max_id
                            swapped = True; sk_swaps += 1; iter_swaps += 1
                            sk[max_id] -= 1; sk[min_id] += 1
                            log(f"   🔄 Single Swap: {emp_map.get(max_id)} ({we['date']}) -> {emp_map.get(min_id)}")
                            sk_stagnation_count = 0
                            break
                        if swapped: break 
                if swapped: break 
            if swapped: break 
            
        if not swapped:
            sk_stagnation_count += 1
            if sk_stagnation_count >= sk_stagnation_limit:
                log(f"⚠️ SK: Η Εξισορρόπηση σταμάτησε (Stagnation).")
                break
            
    log(f"✅ Ολοκληρώθηκε (Έγιναν {sk_swaps} αλλαγές).")

    # --- PHASE 7: Off-Balance Duties (Assignments & Balancing) ---
    log("▶️ Φάση 7: Ανάθεση & Εξισορρόπηση Υπηρεσιών Εκτός Ισοζυγίου...")
    
    off_weekly = [d for d in duties if d.get('is_weekly') and d.get('is_off_balance') and not d.get('is_special')]
    for duty in off_weekly:
        for sh_idx in range(duty['shifts_per_day']):
            curr = start_date
            while curr <= end_date:
                if curr.weekday() == duty['shift_config'][sh_idx]['day_index']:
                    d_str = curr.strftime('%Y-%m-%d')
                    if not any(s['date'] == d_str and int(s['duty_id']) == duty['id'] for s in schedule):
                        def_emp = duty['shift_config'][sh_idx].get('default_employee_id')
                        chosen = def_emp if def_emp and (def_emp,d_str) not in unavail_map and not is_user_busy(def_emp, curr, schedule, False) else None
                        if not chosen:
                             excl = [int(x) for x in duty['shift_config'][sh_idx].get('excluded_ids', [])]
                             cq, nq = get_q(f"weekly_off_{duty['id']}_{sh_idx}", excl)
                             for c in cq+nq:
                                 if (c,d_str) not in unavail_map and not is_user_busy(c, curr, schedule, False): chosen=c; break
                        if chosen: schedule.append({"date": d_str, "duty_id": duty['id'], "shift_index": 0, "employee_id": chosen, "manually_locked": False})
                curr += timedelta(days=1)

    off_daily = [d for d in duties if not d.get('is_weekly') and d.get('is_off_balance') and not d.get('is_special')]
    curr = start_date
    while curr <= end_date:
         d_str = curr.strftime('%Y-%m-%d')
         for duty in off_daily:
             if is_in_period(curr, duty.get('active_range')):
                  for i in range(duty['shifts_per_day']):
                      if not duty['shift_config'][i].get('is_within_hours') and is_in_period(curr, duty['shift_config'][i].get('active_range')):
                          if not any(s['date']==d_str and int(s['duty_id'])==int(duty['id']) and int(s['shift_index'])==i for s in schedule):
                              excl = [int(x) for x in duty['shift_config'][i].get('excluded_ids', [])]
                              cq, nq = get_q(f"off_{duty['id']}_{i}", excl)
                              chosen = None
                              for c in cq+nq:
                                  if (c,d_str) not in unavail_map and not is_user_busy(c, curr, schedule, False): chosen=c; break
                              if chosen:
                                  schedule.append({"date": d_str, "duty_id": duty['id'], "shift_index": i, "employee_id": chosen, "manually_locked": False})
                                  rotate_assigned_user(f"off_{duty['id']}_{i}", chosen)
         curr += timedelta(days=1)

    off_ids = [d['id'] for d in duties if d.get('is_off_balance') and not d.get('is_special')]
    if off_ids:
        run_balance(off_ids, "Υπηρεσιών Εκτός Ισοζυγίου (Final)")

    log("✅ Ο Χρονοπρογραμματισμός ολοκληρώθηκε επιτυχώς.")
    return schedule, {"rotation_queues": rot_q, "next_round_queues": nxt_q, "logs": logs}
'''

with open(target_file, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Keep lines 0 to 598 (inclusive of index 597)
# Note: Line 598 (index 597) is blank in my view but let's just cut before the balacing logic comment
# "    # --- BALANCING LOGIC ---" is what we want to replace from.
# Finding that line programmatically is safer.

cut_index = -1
for i, line in enumerate(lines):
    if "    # --- BALANCING LOGIC ---" in line:
        cut_index = i
        break

if cut_index != -1:
    new_content = "".join(lines[:cut_index]) + new_balancing_logic
    with open(target_file, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Successfully updated scheduler_logic.py")
else:
    print("Could not find the balancing logic marker.")
