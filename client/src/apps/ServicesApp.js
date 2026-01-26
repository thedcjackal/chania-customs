import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { API_URL } from '../config';
import { AppHeader, formatDate, getDaysInMonth, getDayName } from '../components/Layout';

const isDateInActiveRange = (dateStr, range) => {
    if (!range || !range.start || !range.end) return true;
    const [, m, d] = dateStr.split('-').map(Number);
    const parseDM = (s) => {
         const p = s.split(/[-/.]/);
         return [parseInt(p[0]), parseInt(p[1])];
    }
    try {
        const [sD, sM] = parseDM(range.start); 
        const [eD, eM] = parseDM(range.end); 
        const current = new Date(2000, m-1, d); 
        const start = new Date(2000, sM-1, sD); 
        const end = new Date(2000, eM-1, eD);
        current.setHours(0,0,0,0); start.setHours(0,0,0,0); end.setHours(0,0,0,0);
        return start > end ? (current >= start || current <= end) : (current >= start && current <= end);
    } catch (e) { return true; } 
};

export const ServicesApp = ({ user, onExit }) => {
    const isAdmin = user.role === 'admin' || user.role === 'root_admin';
    const [tab, setTab] = useState(isAdmin ? 'schedule' : 'myschedule');
    const [config, setConfig] = useState({ duties: [], special_dates: [], rotation_queues: {} });
    const [schedule, setSchedule] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [modal, setModal] = useState(null); 
    const [dutyForm, setDutyForm] = useState({});
    const [dutyEditMode, setDutyEditMode] = useState(null);
    const [myUnavail, setMyUnavail] = useState([]);
    const [schedulerModal, setSchedulerModal] = useState(false);
    const [schedulerRange, setSchedulerRange] = useState({ start: '', end: '' });
    const [clearModal, setClearModal] = useState(false);
    const [clearRange, setClearRange] = useState({ start: '', end: '' });
    const [schedulerLogs, setSchedulerLogs] = useState([]);
    const [balanceStats, setBalanceStats] = useState([]);
    
    // Drag & Drop State
    const [draggedItem, setDraggedItem] = useState(null);
    const [dragOverIndex, setDragOverIndex] = useState(null);
    
    const printRef1 = useRef(); 
    const printRef2 = useRef();

    useEffect(() => {
        const fetchAll = async () => {
            try {
                const c = await axios.get(`${API_URL}/admin/services/config`); setConfig(c.data);
                const s = await axios.get(`${API_URL}/services/schedule`); setSchedule(s.data);
                if (isAdmin) {
                    const e = await axios.get(`${API_URL}/admin/employees`);
                    setEmployees(e.data);
                }
                if (!isAdmin) loadMyUnavailability();
            } catch (err) { console.error(err); }
        };
        fetchAll();
        // eslint-disable-next-line
    }, [user.id]);

    useEffect(() => {
        if(tab === 'balance' && isAdmin) {
            axios.get(`${API_URL}/services/balance`)
                .then(res => setBalanceStats(res.data))
                .catch(e => console.error(e));
        }
    }, [tab, schedule, isAdmin]); 

    const loadConfig = () => axios.get(`${API_URL}/admin/services/config`).then(res => setConfig(res.data));
    
    const loadMyUnavailability = async () => {
        const res = await axios.get(`${API_URL}/services/unavailability?employee_id=${user.id}`);
        setMyUnavail(res.data);
    };

    const toggleUnavailability = async (dateStr) => {
        const exists = myUnavail.find(u => u.date === dateStr);
        setMyUnavail(prev => exists ? prev.filter(u=>u.date!==dateStr) : [...prev, {date: dateStr, employee_id: user.id}]);
        if (exists) await axios.delete(`${API_URL}/services/unavailability?employee_id=${user.id}&date=${dateStr}`);
        else await axios.post(`${API_URL}/services/unavailability`, { employee_id: user.id, date: dateStr });
        loadMyUnavailability();
    };

    const assignEmployee = async (date, dutyId, shiftIdx, empId) => {
        if (!empId) return;
        try {
            await axios.post(`${API_URL}/services/schedule`, { date, duty_id: dutyId, shift_index: shiftIdx, employee_id: empId });
            const s = await axios.get(`${API_URL}/services/schedule`); setSchedule(s.data);
        } catch (e) { alert(e.response?.data?.error || "Assignment Failed"); }
    };

const saveDuty = async () => {
        if (!dutyForm.name) return alert("Please enter a name for the duty.");
        
        // FIX: Force shifts_per_day to be at least 1 if undefined/NaN
        const shifts = parseInt(dutyForm.shifts_per_day) || 1;

        const newDuty = { 
            id: dutyEditMode ? dutyForm.id : null, 
            name: dutyForm.name,
            shifts_per_day: shifts, 
            default_hours: dutyForm.default_hours || [],
            shift_config: dutyForm.shift_config || [], 
            is_special: dutyForm.is_special || false,
            is_weekly: dutyForm.is_weekly || false,
            is_off_balance: dutyForm.is_off_balance || false,
            sunday_active_range: dutyForm.sunday_active_range || { start: '', end: '' } 
        };
        
        // Ensure configuration array matches the number of shifts
        if (!newDuty.shift_config || newDuty.shift_config.length < shifts) {
            // Fill missing slots with default config
            const currentConf = newDuty.shift_config || [];
            while(currentConf.length < shifts) {
                currentConf.push({
                    is_night: false, 
                    is_within_hours: false, 
                    active_range: {start:'', end:''}, 
                    excluded_ids: [], 
                    handicaps: {},
                    default_employee_id: null // Added default field
                });
            }
            newDuty.shift_config = currentConf;
        }
        
        // Ensure default_hours array matches
        if (!newDuty.default_hours || newDuty.default_hours.length < shifts) {
             const currentHours = newDuty.default_hours || [];
             while(currentHours.length < shifts) {
                 currentHours.push("08:00-16:00");
             }
             newDuty.default_hours = currentHours;
        }

        let newDuties = [...config.duties]; 
        if(dutyEditMode) { 
            const idx = newDuties.findIndex(d => d.id === dutyForm.id); 
            newDuties[idx] = newDuty; 
        } else { 
            newDuties.push(newDuty); 
        }

        try {
            await axios.post(`${API_URL}/admin/services/config`, { ...config, duties: newDuties }); 
            setDutyForm({}); 
            setDutyEditMode(null); 
            // Reload to get true server state
            const c = await axios.get(`${API_URL}/admin/services/config`); 
            setConfig(c.data);
        } catch (e) { 
            alert("Error saving duty: " + (e.response?.data?.error || e.message)); 
        }
    };

    const toggleExclusion = async (dutyId, shiftIdx, empId) => {
        const newDuties = [...config.duties];
        const dIdx = newDuties.findIndex(d => d.id === dutyId);
        if (dIdx === -1) return;
        const duty = { ...newDuties[dIdx] };
        const sConf = duty.shift_config.map(s => ({...s})); 
        const target = { ...sConf[shiftIdx] };
        let excl = target.excluded_ids ? [...target.excluded_ids] : [];
        if (excl.includes(empId)) excl = excl.filter(x => x !== empId);
        else excl.push(empId);
        target.excluded_ids = excl;
        sConf[shiftIdx] = target;
        duty.shift_config = sConf;
        newDuties[dIdx] = duty;
        setConfig({ ...config, duties: newDuties });
        await axios.post(`${API_URL}/admin/services/config`, { ...config, duties: newDuties });
    };

    const updateHandicap = async (dutyId, shiftIdx, empId, val) => {
        const newDuties = [...config.duties];
        const dIdx = newDuties.findIndex(d => d.id === dutyId);
        if (dIdx === -1) return;
        const duty = { ...newDuties[dIdx] };
        const sConf = duty.shift_config.map(s => ({...s})); 
        const target = { ...sConf[shiftIdx] };
        const handicaps = { ...(target.handicaps || {}) };
        handicaps[empId] = parseInt(val);
        target.handicaps = handicaps;
        sConf[shiftIdx] = target;
        duty.shift_config = sConf;
        newDuties[dIdx] = duty;
        setConfig({ ...config, duties: newDuties });
        await axios.post(`${API_URL}/admin/services/config`, { ...config, duties: newDuties });
    };

    const deleteDuty = async (id) => {
        if(!window.confirm("Διαγραφή;")) return;
        const newDuties = config.duties.filter(d => d.id !== id);
        setConfig({...config, duties: newDuties});
    };

    const handleShiftCountChange = (val) => { 
        const count = parseInt(val); 
        const hours = dutyForm.default_hours || []; 
        const conf = dutyForm.shift_config || [];
        if (hours.length < count) { 
            for(let i=hours.length; i<count; i++) { 
                hours.push("08:00-16:00"); 
                conf.push({
                    is_night:false, 
                    is_within_hours:false, 
                    active_range: {start:'', end:''}, 
                    excluded_ids:[], 
                    handicaps:{},
                    default_employee_id: null
                }); 
            }
        } else if (hours.length > count) { hours.splice(count); conf.splice(count); } 
        setDutyForm({ ...dutyForm, shifts_per_day: count, default_hours: hours, shift_config: conf }); 
    };
    
    const handleHourChange = (idx, val) => { const hours = [...(dutyForm.default_hours || [])]; hours[idx] = val; setDutyForm({ ...dutyForm, default_hours: hours }); };
    
    const handleFlagChange = (idx, flag) => {
        const conf = [...(dutyForm.shift_config || [])];
        if(!conf[idx]) conf[idx] = {is_night:false, is_within_hours:false, active_range: {start:'', end:''}, excluded_ids:[], handicaps:{}, default_employee_id: null};
        conf[idx][flag] = !conf[idx][flag];
        
        // Reset default employee if we uncheck is_within_hours
        if (flag === 'is_within_hours' && !conf[idx][flag]) {
            conf[idx].default_employee_id = null;
        }
        
        setDutyForm({ ...dutyForm, shift_config: conf });
    };

    const handleDefaultEmpChange = (idx, val) => {
        const conf = [...(dutyForm.shift_config || [])];
        if(!conf[idx]) conf[idx] = {is_night:false, is_within_hours:false, active_range: {start:'', end:''}, excluded_ids:[], handicaps:{}, default_employee_id: null};
        conf[idx].default_employee_id = val ? parseInt(val) : null;
        setDutyForm({ ...dutyForm, shift_config: conf });
    };

    const handleShiftRangeChange = (idx, field, val) => {
        const conf = [...(dutyForm.shift_config || [])];
        if(!conf[idx]) conf[idx] = {is_night:false, is_within_hours:false, active_range: {start:'', end:''}, excluded_ids:[], handicaps:{}};
        if(!conf[idx].active_range) conf[idx].active_range = {start:'', end:''};
        conf[idx].active_range[field] = val;
        setDutyForm({ ...dutyForm, shift_config: conf });
    };

    const handleSundayRangeChange = (field, val) => {
        setDutyForm({...dutyForm, sunday_active_range: { ...(dutyForm.sunday_active_range || {}), [field]: val }});
    };
    
    const toggleSpecial = async (dStr) => { 
        const currentSpecials = config.special_dates || [];
        const newS = currentSpecials.includes(dStr) ? currentSpecials.filter(d=>d!==dStr) : [...currentSpecials, dStr]; 
        await axios.post(`${API_URL}/admin/services/config`, {...config, special_dates: newS}); 
        setConfig({...config, special_dates: newS}); 
    };

    const runManualScheduler = async () => {
        if (!schedulerRange.start || !schedulerRange.end) return alert("Select Start and End months");
        
        try {
            const res = await axios.post(`${API_URL}/services/run_scheduler`, { 
                start: schedulerRange.start, 
                end: schedulerRange.end 
            });
            
            const s = await axios.get(`${API_URL}/services/schedule`); 
            setSchedule(s.data);
            setSchedulerLogs(res.data.logs || []);
            setSchedulerModal(false); 
            alert("Scheduler Finished!");
        } catch (e) { 
            console.error(e);
            alert("Scheduler Error: " + (e.response?.data?.error || e.message)); 
        }
    };

    const runClearSchedule = async () => {
        if (!clearRange.start || !clearRange.end) return alert("Select Start and End months");
        const start = clearRange.start + "-01";
        const end = new Date(clearRange.end + "-01");
        end.setMonth(end.getMonth() + 1); end.setDate(0);
        const endStr = end.toISOString().split('T')[0];
        if (!window.confirm("Are you sure?")) return;
        try {
            await axios.post(`${API_URL}/services/clear_schedule`, { start_date: start, end_date: endStr });
            const s = await axios.get(`${API_URL}/services/schedule`); setSchedule(s.data);
            setClearModal(false); alert("Schedule Cleared!");
        } catch (e) { alert("Error"); }
    };

    // --- Drag and Drop Handlers (Improved) ---
    const onDragStart = (e, index) => {
        setDraggedItem(employees[index]);
        e.dataTransfer.effectAllowed = "move";
    };

    const onDragOver = (e, index) => {
        e.preventDefault(); 
        setDragOverIndex(index);
        
        const draggedOverItem = employees[index];
        if (draggedItem === draggedOverItem) return;
        
        let items = employees.filter(item => item !== draggedItem);
        items.splice(index, 0, draggedItem);
        setEmployees(items);
    };

    const onDrop = () => {
        setDraggedItem(null);
        setDragOverIndex(null);
    };

    const saveSeniorityOrder = async () => {
        try {
            await axios.put(`${API_URL}/admin/employees`, { reorder: employees.map(e => e.id) });
            alert("Η σειρά αρχαιότητας αποθηκεύτηκε!");
        } catch (e) {
            alert("Αποτυχία αποθήκευσης.");
        }
    };

    const getAvailableMonths = () => {
        const now = new Date();
        let start = new Date(now.getFullYear(), now.getMonth(), 1);
        if (now.getDate() >= 27) start.setMonth(start.getMonth() + 2); else start.setMonth(start.getMonth() + 1);
        const months = [];
        for (let i = 0; i < 6; i++) {
            const m = new Date(start.getFullYear(), start.getMonth() + i, 1);
            months.push(m.toISOString().slice(0, 7));
        }
        return months;
    };

    const generateServicePDF = async () => {
        if (!printRef1.current || !printRef2.current) return;
        printRef1.current.style.display = 'block'; printRef2.current.style.display = 'block';
        const pdf = new jsPDF('l', 'mm', 'a4'); const pdfWidth = pdf.internal.pageSize.getWidth();
        try {
            const c1 = await html2canvas(printRef1.current, { scale: 2 }); pdf.addImage(c1.toDataURL('image/png'), 'PNG', 0, 0, pdfWidth, (c1.height * pdfWidth) / c1.width);
            pdf.addPage();
            const c2 = await html2canvas(printRef2.current, { scale: 2 }); pdf.addImage(c2.toDataURL('image/png'), 'PNG', 0, 0, pdfWidth, (c2.height * pdfWidth) / c2.width);
            pdf.save(`Schedule_${currentMonth.getMonth()+1}.pdf`);
        } finally { printRef1.current.style.display = 'none'; printRef2.current.style.display = 'none'; }
    };

    const renderPrintRow = (d) => {
        const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth()+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isWeekend = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), d).getDay() % 6 === 0;
        return (
            <tr key={d} style={{background: isWeekend ? '#e3f2fd' : 'white'}}>
                <td style={{border:'1px solid #002F6C', padding:4, fontWeight:'bold', width:'30px'}}>{d}</td>
                <td style={{border:'1px solid #002F6C', padding:4, width:'40px'}}>{getDayName(currentMonth.getFullYear(), currentMonth.getMonth(), d)}</td>
                {config.duties.filter(d=>!d.is_special).map(duty => Array.from({length: duty.shifts_per_day}).map((_, shIdx) => {
                    const s = schedule.find(x => x.date === dateStr && x.duty_id === duty.id && x.shift_index === shIdx);
                    let displayText = '';
                    if (s && s.employee_id) {
                        const emp = employees.find(e => e.id === s.employee_id);
                        displayText = emp ? emp.name.split(' ').slice(-1)[0] : '';
                    } else {
                        const range = duty.shift_config[shIdx]?.active_range;
                        if (!isDateInActiveRange(dateStr, range) && shIdx > 0) {
                             const prevS = schedule.find(x => x.date === dateStr && x.duty_id === duty.id && x.shift_index === shIdx - 1);
                             if(prevS) {
                                 const prevEmp = employees.find(e => e.id === prevS.employee_id);
                                 displayText = prevEmp ? `(${prevEmp.name.split(' ').slice(-1)[0]})` : '';
                             }
                        }
                    }
                    return <td key={`${duty.id}-${shIdx}`} style={{border:'1px solid #002F6C', padding:4, fontSize:'8pt', textAlign:'center'}}>{displayText}</td>;
                }))}
            </tr>
        );
    };

    const renderCalendar = (mode) => {
        const year = currentMonth.getFullYear(); const month = currentMonth.getMonth();
        const days = [];
        const specialDates = config.special_dates || [];
        
        for(let d=1; d<=getDaysInMonth(year, month); d++) {
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const isSpecial = specialDates.includes(dateStr);
            const dayShifts = schedule.filter(s=>s.date===dateStr);
            const isWeekend = new Date(year, month, d).getDay() % 6 === 0;
            const isUnavail = myUnavail.some(u => u.date === dateStr);
            const isMyShift = dayShifts.some(s => s.employee_id === user.id);
            let bg = isSpecial ? '#e1bee7' : (isWeekend ? '#ffccbc' : 'white');
            if (mode === 'staff_view' && isMyShift) bg='#c8e6c9';
            if (mode === 'declare_unavail' && isUnavail) bg='#cfd8dc';
            days.push(
                <div key={d} className="cal-day" style={{background:bg, border:'1px solid #ddd', minHeight:100, padding:5}} 
                     onClick={()=>{ if(mode==='admin_view') setModal({date:dateStr}); if(mode==='declare_unavail') toggleUnavailability(dateStr); }}>
                    <div style={{fontWeight:'bold', display:'flex', justifyContent:'space-between'}}><span>{d}</span>{isSpecial && '★'}</div>
                    {mode !== 'declare_unavail' && config.duties.filter(d=>!d.is_special).map(duty => {
                        return Array.from({length: duty.shifts_per_day}).map((_, shiftIdx) => {
                            const s = dayShifts.find(x => x.duty_id === duty.id && x.shift_index === shiftIdx);
                            const emp = employees.find(e => e.id === s?.employee_id);
                            let dispName = '-';
                            if (emp) dispName = emp.name.split(' ').slice(-1)[0];
                            else {
                                const range = duty.shift_config[shiftIdx]?.active_range;
                                if (!isDateInActiveRange(dateStr, range) && shiftIdx > 0) {
                                    const prevS = dayShifts.find(x => x.duty_id === duty.id && x.shift_index === shiftIdx - 1);
                                    if(prevS) {
                                        const prevEmp = employees.find(e => e.id === prevS.employee_id);
                                        if(prevEmp) dispName = `(${prevEmp.name.split(' ').slice(-1)[0]})`;
                                    }
                                }
                            }
                            return (<div key={`${duty.id}-${shiftIdx}`} style={{fontSize:'0.75rem', marginTop:2}}><strong>{duty.name.substring(0,4)}</strong>: {dispName}</div>)
                        })
                    })}
                    {mode !== 'declare_unavail' && dayShifts.filter(s => {const d=config.duties.find(x=>x.id===s.duty_id); return d && d.is_special}).map((s, i) => {
                        const dName = config.duties.find(x=>x.id===s.duty_id)?.name;
                        const eName = employees.find(e=>e.id===s.employee_id)?.name;
                        return <div key={`sp-${i}`} style={{fontSize:'0.75rem', marginTop:2, color:'blue'}}><strong>{dName}</strong>: {eName?.split(' ').slice(-1)[0]}</div>
                    })}
                    {mode === 'declare_unavail' && isUnavail && <span style={{fontSize:'0.7rem', color:'red'}}>Χ Μη διαθέσιμος</span>}
                </div>
            );
        }
        return <div className="calendar-grid">{days}</div>;
    };

    return (
        <div className="app-shell">
            <AppHeader title="Υπηρεσίες" user={user} onExit={onExit} icon={<span>📅</span>} />
            {(tab === 'schedule' || tab === 'myschedule' || tab === 'declare') && 
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                <div style={{display:'flex', gap:10}}><button onClick={()=>setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth()-1)))}>←</button><span style={{fontSize:'1.2rem', fontWeight:'bold', alignSelf:'center'}}>{currentMonth.toLocaleString('el-GR',{month:'long', year:'numeric'})}</span><button onClick={()=>setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth()+1)))}>→</button></div>
                {isAdmin && tab === 'schedule' && (
                    <div style={{display:'flex', gap:10}}>
                        <button onClick={()=>setClearModal(true)} style={{background:'#F44336'}}>🗑 Καθαρισμός</button>
                        <button onClick={()=>setSchedulerModal(true)} style={{background:'#FF9800'}}>🔄 Auto-Schedule</button>
                        <button onClick={generateServicePDF}>📄 Εξαγωγή PDF</button>
                    </div>
                )}
            </div>}
            
            {isAdmin ? (
                <div className="tabs">
                    <button className={tab==='schedule'?'active':''} onClick={()=>setTab('schedule')}>Πρόγραμμα</button>
                    <button className={tab==='seniority'?'active':''} onClick={()=>setTab('seniority')}>Αρχαιότητα</button>
                    <button className={tab==='duties'?'active':''} onClick={()=>setTab('duties')}>Τύποι Υπηρεσίας</button>
                    <button className={tab==='assign'?'active':''} onClick={()=>setTab('assign')}>Αναθέσεις</button>
                    <button className={tab==='special'?'active':''} onClick={()=>setTab('special')}>Ειδικές Ημερομηνίες</button>
                    <button className={tab==='balance'?'active':''} onClick={()=>setTab('balance')}>Ισοζύγιο Υπηρεσιών</button>
                </div>
            ) : (
                <div className="tabs">
                    <button className={tab==='myschedule'?'active':''} onClick={()=>setTab('myschedule')}>Πρόγραμμα</button>
                    <button className={tab==='declare'?'active':''} onClick={()=>setTab('declare')}>Δηλώσεις</button>
                </div>
            )}

            {tab === 'schedule' && (
                <>
                    {renderCalendar('admin_view')}
                    <div className="console-log" style={{maxHeight: '300px', overflowY: 'auto', background: '#f5f5f5', padding: '10px', fontSize: '0.8rem', marginTop: '20px', border: '1px solid #ddd'}}>
                        <h4>Scheduler Logs</h4>
                        <div>
                            {schedulerLogs.length > 0 ? schedulerLogs.map((l, i) => <div key={i}>{l}</div>) : <em>No logs yet.</em>}
                        </div>
                    </div>
                </>
            )}
            {tab === 'myschedule' && renderCalendar('staff_view')}
            {tab === 'declare' && renderCalendar('declare_unavail')}
            
            {/* SENIORITY TAB */}
            {tab === 'seniority' && isAdmin && (
                <div className="admin-section">
                    <div style={{
                        display:'flex', justifyContent:'space-between', alignItems:'center', 
                        marginBottom:20, position:'sticky', top:0, background:'#f9f9f9', 
                        padding:'10px 0', borderBottom:'1px solid #ddd', zIndex: 10
                    }}>
                        <div>
                            <h3>Κατάταξη Αρχαιότητας</h3>
                            <p style={{margin:0, fontSize:'0.9rem', color:'#666'}}>
                                Σύρετε τα ονόματα για να αλλάξετε τη σειρά.
                            </p>
                        </div>
                        <button onClick={saveSeniorityOrder} style={{background:'#4CAF50', padding:'10px 20px', fontSize:'1rem'}}>
                            💾 Αποθήκευση Σειράς
                        </button>
                    </div>
                    
                    <ul style={{listStyle: 'none', padding: '0 0 100px 0', display:'flex', flexDirection:'column', gap:'8px'}}>
                        {employees.map((emp, index) => (
                            <li 
                                key={emp.id}
                                draggable
                                onDragStart={(e) => onDragStart(e, index)}
                                onDragOver={(e) => onDragOver(e, index)}
                                onDrop={onDrop}
                                style={{
                                    background: 'white', 
                                    padding: '12px 16px', 
                                    borderRadius: '8px', 
                                    cursor: 'grab', 
                                    display:'flex', 
                                    alignItems:'center',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                                    border: '1px solid #eee',
                                    borderLeft: `4px solid ${index === dragOverIndex ? '#2196F3' : '#002F6C'}`,
                                    transition: 'all 0.2s ease',
                                    opacity: draggedItem === emp ? 0.5 : 1,
                                    transform: draggedItem === emp ? 'scale(0.98)' : 'scale(1)'
                                }}
                            >
                                <div style={{display:'flex', alignItems:'center', gap:'15px', flex:1}}>
                                    <span style={{fontSize:'1.2rem', color:'#ccc', cursor:'grab', userSelect:'none', padding:'0 5px'}}>☰</span>
                                    <div style={{background: '#e3f2fd', color: '#002F6C', fontWeight: 'bold', width: '30px', height: '30px', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
                                        {index + 1}
                                    </div>
                                    <span style={{fontSize:'1.1rem', fontWeight:500}}>{emp.name}</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {tab === 'balance' && isAdmin && (
                <div className="admin-section">
                    <h3>Ισοζύγιο Υπηρεσιών</h3>
                    <table><thead><tr><th>Υπάλληλος</th><th>Σύνολο Βαρδιών</th>
                        {config.duties.filter(d => d.is_weekly).map(d => <th key={d.id}>{d.name}</th>)}
                        {config.duties.filter(d => d.is_off_balance && !d.is_weekly).map(d => <th key={d.id}>{d.name}</th>)}
                    </tr></thead><tbody>
                        {balanceStats.map(s => (
                            <tr key={s.name}>
                                <td>{s.name}</td>
                                <td>{s.total} {s.total !== s.effective_total ? `(${s.effective_total})` : ''}</td>
                                {config.duties.filter(d => d.is_weekly).map(d => {
                                    const actual = s.duty_counts?.[d.id] || 0;
                                    const effective = s.effective_duty_counts?.[d.id] ?? actual;
                                    return <td key={d.id}>{actual} {actual !== effective ? `(${effective})` : ''}</td>
                                })}
                                {config.duties.filter(d => d.is_off_balance && !d.is_weekly).map(d => {
                                    const actual = s.duty_counts?.[d.id] || 0;
                                    const effective = s.effective_duty_counts?.[d.id] ?? actual;
                                    return <td key={d.id}>{actual} {actual !== effective ? `(${effective})` : ''}</td>
                                })}
                            </tr>
                        ))}
                    </tbody></table>
                </div>
            )}

            {tab === 'duties' && isAdmin && (<div className="admin-section"><div className="split-panel"><div style={{flex:1}}><h4>{dutyEditMode ? 'Επεξεργασία' : 'Νέα'} Υπηρεσία</h4><div className="form-grid"><label>Όνομα<input value={dutyForm.name||''} onChange={e=>setDutyForm({...dutyForm, name:e.target.value})}/></label><label>Βάρδιες ανά ημέρα<input type="number" min="1" value={dutyForm.shifts_per_day||1} onChange={e=>handleShiftCountChange(e.target.value)}/></label><div style={{display:'flex', gap:10, gridColumn:'1/-1'}}><label><input type="checkbox" checked={dutyForm.is_special||false} onChange={e=>setDutyForm({...dutyForm, is_special:e.target.checked})}/> Ειδική Υπηρεσία</label><label><input type="checkbox" checked={dutyForm.is_weekly||false} onChange={e=>setDutyForm({...dutyForm, is_weekly:e.target.checked})}/> Εβδομαδιαία</label><label><input type="checkbox" checked={dutyForm.is_off_balance||false} onChange={e=>setDutyForm({...dutyForm, is_off_balance:e.target.checked})}/> Εκτός Ισοζυγίου</label></div>
            {dutyForm.is_weekly && (
                <div style={{gridColumn:'1/-1', border:'1px solid #eee', padding:10, marginTop:10}}>
                    <strong>Sunday Availability Period (DD-MM):</strong>
                    <div style={{display:'flex', gap:10}}>
                        <input placeholder="Start (e.g. 14-03)" value={dutyForm.sunday_active_range?.start || ''} onChange={e=>handleSundayRangeChange('start', e.target.value)}/>
                        <input placeholder="End (e.g. 31-10)" value={dutyForm.sunday_active_range?.end || ''} onChange={e=>handleSundayRangeChange('end', e.target.value)}/>
                    </div>
                </div>
            )}
            </div><div style={{marginTop:10}}><h5>Ωράρια & Ρυθμίσεις:</h5>{(dutyForm.default_hours || ["08:00-16:00"]).map((h, i) => (
                <div key={i} style={{marginBottom:10, borderBottom:'1px solid #eee', paddingBottom:5}}>
                    <div style={{display:'flex', gap:5, alignItems:'center'}}>
                        Shift {i+1}: <input value={h} onChange={e=>handleHourChange(i, e.target.value)} style={{width:100}} placeholder="Hours"/>
                        <label title="Night"><input type="checkbox" checked={dutyForm.shift_config?.[i]?.is_night} onChange={()=>handleFlagChange(i, 'is_night')}/> 🌙</label>
                        <label title="Within Hours"><input type="checkbox" checked={dutyForm.shift_config?.[i]?.is_within_hours} onChange={()=>handleFlagChange(i, 'is_within_hours')}/> 💼</label>
                        
                        {/* DEFAULT EMPLOYEE DROPDOWN FOR WORKHOURS */}
                        {dutyForm.shift_config?.[i]?.is_within_hours && (
                            <select 
                                style={{marginLeft: 10, fontSize: '0.8rem', padding: 2, border: '1px solid #ccc', borderRadius: 4}}
                                value={dutyForm.shift_config[i].default_employee_id || ""}
                                onChange={(e) => handleDefaultEmpChange(i, e.target.value)}
                            >
                                <option value="">-- Default Emp --</option>
                                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                            </select>
                        )}
                    </div>
                    <div style={{display:'flex', gap:5, marginTop:5, fontSize:'0.9rem'}}>
                        <span>Active (DD-MM):</span>
                        <input placeholder="Start" value={dutyForm.shift_config?.[i]?.active_range?.start || ''} onChange={e=>handleShiftRangeChange(i, 'start', e.target.value)} style={{width:60}}/>
                        <input placeholder="End" value={dutyForm.shift_config?.[i]?.active_range?.end || ''} onChange={e=>handleShiftRangeChange(i, 'end', e.target.value)} style={{width:60}}/>
                    </div>
                </div>
            ))}</div><button onClick={saveDuty} style={{marginTop:10}}>Αποθήκευση</button>{dutyEditMode && <button className="secondary" onClick={()=>{setDutyForm({}); setDutyEditMode(null)}}>Ακύρωση</button>}</div><div style={{flex:1, borderLeft:'1px solid #ccc', paddingLeft:20}}><h4>Υπάρχουσες Υπηρεσίες</h4><ul>{config.duties.map(d => (<li key={d.id} style={{marginBottom:10, display:'flex', justifyContent:'space-between'}}><span><b>{d.name}</b> {d.is_special && '(Ειδ)'} {d.is_weekly && '(Εβδ)'} {d.is_off_balance && '(Off)'}</span><span><button className="small-btn" onClick={()=>{setDutyForm(d); setDutyEditMode(true)}}>Edit</button><button className="small-btn danger" onClick={()=>deleteDuty(d.id)}>Del</button></span></li>))}</ul></div></div></div>)}
            
            {tab === 'assign' && isAdmin && (<div className="admin-section"><h3>Εξαιρέσεις & Πλεονεκτήματα (Ανά Βάρδια)</h3><p>Ορίστε εξαιρέσεις και πλεονεκτήματα για κάθε βάρδια ξεχωριστά.</p>
                <div style={{overflowX: 'auto'}}>
                <table style={{fontSize:'0.9rem', width: 'auto'}}>
                    <thead>
                        <tr>
                            <th>Υπάλληλος</th>
                            {config.duties.map(d => (
                                d.shift_config.map((s, idx) => (
                                    <th key={`${d.id}-${idx}`} style={{minWidth: 100, textAlign: 'center'}}>
                                        {d.name} <br/> <small>Shift {idx+1}</small>
                                    </th>
                                ))
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {employees.map(e => (
                            <tr key={e.id}>
                                <td>{e.name}</td>
                                {config.duties.map(d => (
                                    d.shift_config.map((s, idx) => {
                                        const isExcluded = s.excluded_ids?.includes(e.id);
                                        const handicap = s.handicaps?.[e.id] || 0;
                                        return (
                                            <td key={`${d.id}-${idx}`} style={{textAlign:'center', background: isExcluded ? '#ffebee' : 'transparent'}}>
                                                <div style={{display:'flex', gap:5, justifyContent:'center', alignItems:'center'}}>
                                                    <input type="checkbox" title="Exclude" checked={!isExcluded} onChange={()=>toggleExclusion(d.id, idx, e.id)} />
                                                    <select style={{width:40, padding:0}} value={handicap} onChange={(ev)=>updateHandicap(d.id, idx, e.id, ev.target.value)}>
                                                        <option value="0">0</option>
                                                        <option value="1">+1</option>
                                                        <option value="2">+2</option>
                                                    </select>
                                                </div>
                                            </td>
                                        );
                                    })
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
                </div>
            </div>)}
            
            {tab === 'special' && isAdmin && (<div className="admin-section"><h3>Διαχείριση Ειδικών Ημερομηιών</h3><input type="date" onChange={e=>toggleSpecial(e.target.value)} /><div style={{marginTop:20, display:'flex', flexWrap:'wrap', gap:10}}>{(config.special_dates || []).sort().map(d => (<span key={d} className="tag" onClick={()=>toggleSpecial(d)} style={{cursor:'pointer'}}>{d} ✕</span>))}</div></div>)}
            
            {modal && <div className="modal-overlay"><div className="modal-content"><h3>Βάρδιες: {formatDate(modal.date)}</h3>
                {config.duties.filter(d => !d.is_special).map(d => (<div key={d.id} style={{marginBottom:15, borderBottom:'1px solid #eee', paddingBottom:10}}><h4>{d.name}</h4>{Array.from({length: d.shifts_per_day}).map((_, idx) => {const assign = schedule.find(s => s.date === modal.date && s.duty_id === d.id && s.shift_index === idx);return (<div key={idx} style={{display:'flex', gap:10, marginBottom:5, alignItems:'center'}}><span>Βάρδια {idx+1} ({d.default_hours[idx]}):</span><select value={assign?.employee_id || ''} onChange={(e) => assignEmployee(modal.date, d.id, idx, parseInt(e.target.value))}><option value="">-- Ανάθεση --</option>{employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>);})}</div>))}
                <h4 style={{marginTop:20, color:'blue'}}>Έκτακτες / Ειδικές Υπηρεσίες</h4><div style={{display:'flex', gap:10, alignItems:'center'}}><select id="sp_duty"><option value="">Επιλογή Ειδικής Υπηρεσίας...</option>{config.duties.filter(d => d.is_special).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select><select id="sp_emp"><option value="">Επιλογή Υπαλλήλου (Σειρά)...</option>{employees.map(e => { return <option key={e.id} value={e.id}>{e.name}</option>})}</select><button onClick={() => { const dId = document.getElementById('sp_duty').value; const eId = document.getElementById('sp_emp').value; if(dId && eId) assignEmployee(modal.date, parseInt(dId), 0, parseInt(eId)); }}>Προσθήκη</button></div>{schedule.filter(s => s.date === modal.date && config.duties.find(d => d.id === s.duty_id)?.is_special).map(s => (<div key={s.duty_id} style={{marginTop:5}}>{config.duties.find(d=>d.id===s.duty_id).name}: {employees.find(e=>e.id===s.employee_id)?.name}</div>))}
                <button onClick={()=>setModal(null)} style={{marginTop:20}}>Κλείσιμο</button></div></div>}

            {schedulerModal && <div className="modal-overlay"><div className="modal-content" style={{maxWidth:400}}>
                <h3>Run Auto-Scheduler</h3>
                <p>Select range of months to re-balance:</p>
                <div style={{display:'flex', flexDirection:'column', gap:10}}>
                    <label>Start Month: <select onChange={e=>setSchedulerRange({...schedulerRange, start:e.target.value})}><option value="">Select...</option>{getAvailableMonths().map(m=><option key={m} value={m}>{m}</option>)}</select></label>
                    <label>End Month: <select onChange={e=>setSchedulerRange({...schedulerRange, end:e.target.value})}><option value="">Select...</option>{getAvailableMonths().map(m=><option key={m} value={m}>{m}</option>)}</select></label>
                </div>
                <div style={{marginTop:20, display:'flex', gap:10}}>
                    <button onClick={runManualScheduler}>Run Scheduler</button>
                    <button className="secondary" onClick={()=>setSchedulerModal(false)}>Cancel</button>
                </div>
            </div></div>}

            {clearModal && <div className="modal-overlay"><div className="modal-content" style={{maxWidth:400}}>
                <h3>Clear Schedule</h3>
                <p>Select range of months to clear (Manual locks preserved):</p>
                <div style={{display:'flex', flexDirection:'column', gap:10}}>
                    <label>Start Month: <input type="month" value={clearRange.start} onChange={e=>setClearRange({...clearRange, start:e.target.value})} /></label>
                    <label>End Month: <input type="month" value={clearRange.end} onChange={e=>setClearRange({...clearRange, end:e.target.value})} /></label>
                </div>
                <div style={{marginTop:20, display:'flex', gap:10}}>
                    <button onClick={runClearSchedule} style={{background:'#F44336'}}>Clear</button>
                    <button className="secondary" onClick={()=>setClearModal(false)}>Cancel</button>
                </div>
            </div></div>}

            <div id="print-area-1" ref={printRef1} style={{display:'none', padding:20, background:'white', width:'297mm', height:'210mm'}}>
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:10, borderBottom:'2px solid #002F6C', paddingBottom:10}}><img src="/aade-logo.png" style={{height:40}} alt=""/><h2 style={{color:'#002F6C'}}>Πρόγραμμα Υπηρεσιών (1-15)</h2></div>
                <table className="print-table" style={{width:'100%', fontSize:'8pt', textAlign:'center', borderCollapse:'collapse'}}><thead><tr style={{background:'#002F6C', color:'white'}}><th style={{border:'1px solid #000', padding:5}}>Ημ/νία</th><th style={{border:'1px solid #000', padding:5}}>Ημέρα</th>{config.duties.filter(d=>!d.is_special).map(d => Array.from({length: d.shifts_per_day}).map((_, i) => <th key={`${d.id}-${i}`} style={{border:'1px solid #000', padding:5}}>{d.name} <br/> <small>({d.default_hours[i]})</small></th>))}</tr></thead><tbody>{Array.from({length: 15}).map((_, i) => renderPrintRow(i+1))}</tbody></table>
            </div>
            <div id="print-area-2" ref={printRef2} style={{display:'none', padding:20, background:'white', width:'297mm', height:'210mm'}}>
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:10, borderBottom:'2px solid #002F6C', paddingBottom:10}}><img src="/aade-logo.png" style={{height:40}} alt=""/><h2 style={{color:'#002F6C'}}>Πρόγραμμα Υπηρεσιών (16-End)</h2></div>
                <table className="print-table" style={{width:'100%', fontSize:'8pt', textAlign:'center', borderCollapse:'collapse'}}><thead><tr style={{background:'#002F6C', color:'white'}}><th style={{border:'1px solid #000', padding:5}}>Ημ/νία</th><th style={{border:'1px solid #000', padding:5}}>Ημέρα</th>{config.duties.filter(d=>!d.is_special).map(d => Array.from({length: d.shifts_per_day}).map((_, i) => <th key={`${d.id}-${i}`} style={{border:'1px solid #000', padding:5}}>{d.name} <br/> <small>({d.default_hours[i]})</small></th>))}</tr></thead><tbody>{Array.from({length: getDaysInMonth(currentMonth.getFullYear(), currentMonth.getMonth()) - 15}).map((_, i) => renderPrintRow(i+16))}</tbody></table>
            </div>
        </div>
    );
};