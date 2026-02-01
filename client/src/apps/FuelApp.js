import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api/axios';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { API_URL } from '../config';
import { AppHeader, formatDate } from '../components/Layout';
import { UserManager, ReferenceManager } from '../components/AdminTools';

const SettingsManager = () => {
    const [settings, setSettings] = useState(null); 
    useEffect(() => { api.get(`${API_URL}/admin/settings`).then(res => setSettings(res.data)); }, []); 
    if(!settings) return null; 
    const save = (s) => { setSettings(s); api.post(`${API_URL}/admin/settings`, s); }; 
    const days = ["Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο", "Κυριακή"]; 
    return (<div className="admin-section"><div className="split-panel flex-align"><h4>Κανόνες Κλειδώματος</h4><label>Ημέρες Πριν:<input type="number" value={settings.lock_rules.days_before} onChange={e=>{const s={...settings}; s.lock_rules.days_before=e.target.value; save(s)}} style={{width:60}}/></label><label>Ώρα (HH:MM):<input type="time" value={settings.lock_rules.time} onChange={e=>{const s={...settings}; s.lock_rules.time=e.target.value; save(s)}}/></label></div><h4>Εβδομαδιαίο Πρόγραμμα</h4><table><thead><tr><th>Ημέρα</th><th>Κατάσταση</th><th>Όριο</th></tr></thead><tbody>{days.map(d=>(<tr key={d}><td>{d}</td><td><button className={`status-btn ${settings.weekly_schedule[d]?.open?'open':'closed'}`} onClick={()=>{const s={...settings}; s.weekly_schedule[d].open=!s.weekly_schedule[d].open; save(s)}}>{settings.weekly_schedule[d]?.open?'Ανοιχτή':'Κλειστή'}</button></td><td><input type="number" value={settings.weekly_schedule[d]?.limit} onChange={e=>{const s={...settings}; s.weekly_schedule[d].limit=parseInt(e.target.value); save(s)}}/></td></tr>))}</tbody></table></div>);
};

const DailyReport = ({ user }) => {
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]); 
    const [reservations, setReservations] = useState([]); 
    const [employees, setEmployees] = useState([]); 
    const [isFinalized, setIsFinalized] = useState(false); 
    const [assignMode, setAssignMode] = useState(''); 
    const [empA, setEmpA] = useState(''); 
    const [empB, setEmpB] = useState(''); 
    const [singleEmp, setSingleEmp] = useState(''); 
    const [viewRes, setViewRes] = useState(null); 
    const [refs, setRefs] = useState({ fuel_types: [], companies: [] }); 
    const printRef = useRef(); 

    // Wrapped in useCallback to satisfy linter
    const loadRes = useCallback(async () => { 
        const res = await api.get(`${API_URL}/reservations?date=${date}`); 
        setReservations(res.data.sort((a,b) => b.location.x - a.location.x).map((r,i) => ({...r, sn: i+1}))); 
    }, [date]); 

    useEffect(() => { 
        api.get(`${API_URL}/admin/employees`).then(res => setEmployees(res.data)); 
        api.get(`${API_URL}/admin/reference`).then(res => setRefs(res.data)); 
        loadRes(); 
        api.get(`${API_URL}/daily_status?date=${date}`).then(res => setIsFinalized(res.data.finalized)); 
    }, [date, loadRes]); 

    const handleAssign = async (id, name) => { await api.put(`${API_URL}/reservations`, { id, role: 'admin', updates: { assigned_employee: name } }); loadRes(); }; 
    const toggleFinalize = async () => { try { const ns = !isFinalized; await api.post(`${API_URL}/daily_status`, { date, finalized: ns }); setIsFinalized(ns); } catch (err) { alert("Error"); } }; 
    const runAssign = async () => { if (assignMode === 'single') { if (!singleEmp) return alert("Select Employee"); for (const r of reservations) await api.put(`${API_URL}/reservations`, { id: r.id, role: 'admin', updates: { assigned_employee: singleEmp } }); } else if (assignMode === 'split') { if (!empA || !empB) return alert("Select 2 Employees"); const groups = {}; reservations.forEach(r => { const k = `${r.supply_company||'U'}|${r.fuel_type||'U'}`; if (!groups[k]) groups[k] = []; groups[k].push(r); }); let maxKey = null; let maxSize = -1; Object.keys(groups).forEach(k => { if (groups[k].length > maxSize) { maxSize = groups[k].length; maxKey = k; } }); for (const r of reservations) { const k = `${r.supply_company||'U'}|${r.fuel_type||'U'}`; const emp = (k === maxKey ? empA : empB); await api.put(`${API_URL}/reservations`, { id: r.id, role: 'admin', updates: { assigned_employee: emp } }); } } setAssignMode(''); loadRes(); }; 
    const toggleDebt = async (r, action) => { const newFlags = action === 'remove' ? r.flags.filter(f => f !== 'Οφειλή') : [...r.flags, 'Οφειλή']; await api.put(`${API_URL}/reservations`, { id: r.id, role: 'admin', updates: { flags: newFlags } }); setViewRes({...viewRes, flags: newFlags}); loadRes(); }; 
    const saveChanges = async () => { await api.put(`${API_URL}/reservations`, { id: viewRes.id, role: 'admin', updates: viewRes }); setViewRes(null); loadRes(); }; 
    const handleMapClick = (e) => { if(isFinalized) return; const rect = e.target.getBoundingClientRect(); setViewRes({ ...viewRes, location: { x: ((e.clientX - rect.left)/rect.width)*100, y: ((e.clientY - rect.top)/rect.height)*100 } }); }; 
    const generatePDF = async () => { if (!printRef.current) return; printRef.current.style.display = 'block'; const pdf = new jsPDF('l', 'mm', 'a4'); const pdfWidth = pdf.internal.pageSize.getWidth(); const employeesToPrint = [...new Set(reservations.map(r => r.assigned_employee || 'Unassigned'))]; for (let i = 0; i < employeesToPrint.length; i++) { const empElement = document.getElementById(`print-section-${i}`); if (empElement) { const canvas = await html2canvas(empElement, { scale: 2 }); const imgData = canvas.toDataURL('image/png'); const imgHeight = (canvas.height * pdfWidth) / canvas.width; if (i > 0) pdf.addPage(); pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgHeight); } } printRef.current.style.display = 'none'; pdf.save(`Report_${date}.pdf`); }; 
    return (<div className="admin-section"><div className="control-bar-daily"><div style={{display:'flex', gap:10, alignItems:'center'}}><label style={{fontWeight:'bold'}}>Ημερομηνία:</label><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{width: 150}} /></div><div style={{display:'flex', gap:10}}><button onClick={() => setAssignMode(assignMode==='single'?'':'single')} disabled={isFinalized} className={isFinalized?'disabled-btn':''}>1️⃣ Ανάθεση σε Έναν</button><button onClick={() => setAssignMode(assignMode==='split'?'':'split')} disabled={isFinalized} className={isFinalized?'disabled-btn':''}>⚡ Διαχωρισμός Εργασίας</button><button onClick={toggleFinalize} className={`finalize-btn ${isFinalized?'closed':'open'}`}>{isFinalized ? "Ξεκλείδωμα" : "Οριστικοποίηση"}</button><button onClick={generatePDF}>PDF</button></div></div>{assignMode === 'single' && !isFinalized && (<div className="split-panel"><label>Ανάθεση ΟΛΩΝ σε:</label><select onChange={e=>setSingleEmp(e.target.value)}><option value="">Επιλογή...</option>{employees.map(e=><option key={e.id} value={e.name}>{e.name}</option>)}</select><button onClick={runAssign}>Εφαρμογή</button></div>)}{assignMode === 'split' && !isFinalized && (<div className="split-panel"><select onChange={e=>setEmpA(e.target.value)}><option value="">Υπάλληλος Α (Κύριος)</option>{employees.map(e=><option key={e.id} value={e.name}>{e.name}</option>)}</select><select onChange={e=>setEmpB(e.target.value)}><option value="">Υπάλληλος Β (Υπόλοιπα)</option>{employees.map(e=><option key={e.id} value={e.name}>{e.name}</option>)}</select><button onClick={runAssign}>Εφαρμογή</button></div>)}<table><thead><tr><th>Α/Α</th><th>Εταιρεία</th><th>Σκάφος</th><th>Σημάνσεις</th><th>Ανατέθηκε</th></tr></thead><tbody>{reservations.map(r => (<tr key={r.id} onClick={() => setViewRes(r)} style={{cursor:'pointer', background: viewRes?.id===r.id?'#e3f2fd':'transparent'}}><td>{r.sn}</td><td>{r.user_company}</td><td>{r.vessel}</td><td style={{color:'red'}}>{r.flags.join(', ')}</td><td onClick={e=>e.stopPropagation()}><select value={r.assigned_employee} disabled={isFinalized} onChange={(e)=>handleAssign(r.id, e.target.value)}><option value="">Επιλογή...</option>{employees.map(e=><option key={e.id} value={e.name}>{e.name}</option>)}</select></td></tr>))}</tbody></table>{viewRes && (<div className="modal-overlay" onClick={() => setViewRes(null)}><div className="modal-content" onClick={e => e.stopPropagation()}><h3>Επεξεργασία #{viewRes.sn}</h3><div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:20}}><div className="form-group-vertical"><label>Ημερομηνία</label><input type="date" disabled={isFinalized} value={viewRes.date} onChange={e=>setViewRes({...viewRes, date:e.target.value})} /><label>Σκάφος</label><input disabled={isFinalized} value={viewRes.vessel} onChange={e=>setViewRes({...viewRes, vessel:e.target.value})} /><label>Εταιρεία Χρήστη</label><input disabled={isFinalized} value={viewRes.user_company} onChange={e=>setViewRes({...viewRes, user_company:e.target.value})} /><label>Εταιρεία Εφοδ.</label><select disabled={isFinalized} value={viewRes.supply_company} onChange={e=>setViewRes({...viewRes, supply_company:e.target.value})}>{refs.companies.map(c=><option key={c}>{c}</option>)}</select><label>Καύσιμο</label><select disabled={isFinalized} value={viewRes.fuel_type} onChange={e=>setViewRes({...viewRes, fuel_type:e.target.value})}>{refs.fuel_types.map(f=><option key={f}>{f}</option>)}</select><label>Ποσότητα</label><input type="number" disabled={isFinalized} value={viewRes.quantity} onChange={e=>setViewRes({...viewRes, quantity:e.target.value})} /><label>Πληρωμή</label><select disabled={isFinalized} value={viewRes.payment_method} onChange={e=>setViewRes({...viewRes, payment_method:e.target.value})}><option>Ηλεκτρονικά</option><option>Δια ζώσης</option><option>MRN/Αριθμός Πρωτοκόλλου</option></select><label>MRN</label><input disabled={isFinalized} value={viewRes.mrn || ''} onChange={e=>setViewRes({...viewRes, mrn:e.target.value})} /><div style={{marginTop:10}}>{!isFinalized && (viewRes.flags.includes("Οφειλή") ? <button className="small-btn open" onClick={() => toggleDebt(viewRes, 'remove')}>Εξόφληση</button> : <button className="small-btn closed" onClick={() => toggleDebt(viewRes, 'add')}>+ Οφειλή</button>)}</div></div><div className="map-wrapper" style={{width:'100%', height:'auto'}}><div className="map-container" onClick={handleMapClick}><img src="/map-chania-old-town-L.jpg" className="modal-map-image" alt="" /><div className="map-pin" style={{left:`${viewRes.location.x}%`, top:`${viewRes.location.y}%`}}/></div></div></div><div style={{marginTop:20}}>{!isFinalized && <button onClick={saveChanges}>Save</button>}<button className="secondary" onClick={() => setViewRes(null)}>Close</button></div></div></div>)}<div id="print-area" ref={printRef} style={{display:'none', width:'297mm'}}>{[...new Set(reservations.map(r => r.assigned_employee || 'Unassigned'))].map((emp, index) => (<div key={emp} id={`print-section-${index}`} style={{padding:'20px', background:'white', height:'210mm', boxSizing:'border-box'}}><div style={{display:'flex', justifyContent:'space-between', marginBottom:'20px'}}><img src="/aade-logo.png" style={{height:'50px'}} alt="" /><h2>Πρόγραμμα Εφοδιασμού Σκαφών με Καύσιμα ({formatDate(date)})</h2></div><h3 style={{background:'#002F6C', color:'white', padding:'5px'}}>Υπάλληλος: {emp}</h3><table className="print-table" style={{width:'100%', borderCollapse:'collapse', fontSize:'9pt', tableLayout:'fixed'}}><colgroup><col style={{width:'5%'}}/><col style={{width:'14%'}}/><col style={{width:'14%'}}/><col style={{width:'8%'}}/><col style={{width:'14%'}}/><col style={{width:'8%'}}/><col style={{width:'10%'}}/><col style={{width:'12%'}}/><col style={{width:'15%'}}/></colgroup><thead><tr style={{background:'#eee'}}><th style={{padding:5}}>A/A</th><th style={{padding:5}}>Εταιρεία</th><th style={{padding:5}}>Σκάφος</th><th style={{padding:5}}>Καύσιμο</th><th style={{padding:5}}>Εφοδιάστρια<br/>Εταιρεία</th><th style={{padding:5}}>Ποσ.</th><th style={{padding:5}}>Πληρωμή</th><th style={{padding:5}}>MRN</th><th style={{padding:5}}>Σημ.</th></tr></thead><tbody>{reservations.filter(r => (r.assigned_employee||'Unassigned') === emp).map(r => (<tr key={r.id} style={{borderBottom:'1px solid #ddd'}}><td style={{padding:5, verticalAlign:'top'}}>{r.sn}</td><td style={{padding:5, verticalAlign:'top', whiteSpace:'normal', wordWrap:'break-word'}}>{r.user_company}</td><td style={{padding:5, verticalAlign:'top', whiteSpace:'normal', wordWrap:'break-word'}}>{r.vessel}</td><td style={{padding:5, verticalAlign:'top', whiteSpace:'normal', wordWrap:'break-word'}}>{r.fuel_type.split('(')[0]}</td><td style={{padding:5, verticalAlign:'top', whiteSpace:'normal', wordWrap:'break-word'}}>{r.supply_company}</td><td style={{padding:5, verticalAlign:'top'}}>{r.quantity}</td><td style={{padding:5, verticalAlign:'top', whiteSpace:'normal', wordWrap:'break-word'}}>{r.payment_method}</td><td style={{padding:5, verticalAlign:'top', whiteSpace:'normal', wordWrap:'break-word'}}>{r.mrn}</td><td style={{padding:5, verticalAlign:'top', color:'red', whiteSpace:'normal', wordWrap:'break-word'}}>{r.flags.join(', ')}</td></tr>))}</tbody></table><div style={{width:'100%', height:'350px', position:'relative', overflow:'hidden'}}><img src="/map-chania-old-town-L.jpg" style={{width:'100%', height:'100%', objectFit:'cover'}} alt="" />{reservations.filter(r => (r.assigned_employee||'Unassigned') === emp).map(r => (<div key={r.id} style={{position:'absolute', left:`${r.location.x}%`, top:`${r.location.y}%`, width:20, height:20, background:'red', borderRadius:'50%', color:'white', display:'flex', justifyContent:'center', alignItems:'center', fontWeight:'bold', transform:'translate(-50%,-50%)'}}>{r.sn}</div>))}</div></div>))}</div></div>);
};

const DebtReport = () => {const [debts, setDebts] = useState([]); const [filter, setFilter] = useState(''); useEffect(() => { load(); }, []); const load = async () => { const res = await api.get(`${API_URL}/reservations`); setDebts(res.data.filter(r => r.flags.includes("Οφειλή"))); }; const clear = async (r) => { if(!window.confirm("Εξόφληση;")) return; await api.put(`${API_URL}/reservations`, {id:r.id, role:'admin', updates:{flags:r.flags.filter(f=>f!=='Οφειλή')}}); load(); }; return (<div className="admin-section"><div className="control-bar"><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Αναζήτηση Εταιρείας..." /></div><table><thead><tr><th>Ημερομηνία</th><th>Εταιρεία</th><th>Ποσότητα</th><th>Ενέργειες</th></tr></thead><tbody>{debts.filter(d=>d.user_company.toLowerCase().includes(filter.toLowerCase())).map(r=><tr key={r.id}><td>{formatDate(r.date)}</td><td>{r.user_company}</td><td>{r.quantity}</td><td><button className="small-btn open" onClick={()=>clear(r)}>Εξόφληση</button></td></tr>)}</tbody></table></div>);};

const ReservationForm = ({ user, existing, onSuccess }) => {
    const [form, setForm] = useState(existing || { date: '', vessel: '', user_company: user.company || '', fuel_type: '', quantity: 0, payment_method: 'Ηλεκτρονικά', mrn: '', supply_company: '', location: {x:-1,y:-1} }); 
    const [refs, setRefs] = useState({ fuel_types: [], companies: [] }); 
    const [vesselMap, setVesselMap] = useState({}); 
    useEffect(() => { api.get(`${API_URL}/admin/reference`).then(r => setRefs(r.data)); if (user.role !== 'user') api.get(`${API_URL}/vessel_map`).then(res => setVesselMap(res.data)); }, [user.role]); 
    const handleMapClick = (e) => { const rect = e.target.getBoundingClientRect(); setForm({ ...form, location: { x: ((e.clientX - rect.left)/rect.width)*100, y: ((e.clientY - rect.top)/rect.height)*100 } }); }; 
    const submit = async () => { if (form.location.x === -1) return alert("Select location"); if (existing) { await api.put(`${API_URL}/reservations`, { id: existing.id, role: 'user', updates: form }); onSuccess(); } else { await api.post(`${API_URL}/reservations`, { ...form, user_name: user.name, user_company: (user.role !== 'user' && form.user_company) ? form.user_company : user.company }); onSuccess(); } }; 
    const availableVessels = (user.role !== 'user' && form.user_company) ? (vesselMap[form.user_company] || []) : user.vessels; 
    return (<div className="form-grid"><div className="form-group"><label>Ημερομηνία</label><input type="date" value={form.date} onChange={e=>setForm({...form, date:e.target.value})} disabled={!!existing}/></div>{user.role !== 'user' ? (<><div className="form-group"><label>Εταιρεία Πελάτη</label><select value={form.user_company} onChange={e=>setForm({...form, user_company:e.target.value, vessel:''})}><option value="">Επιλογή...</option>{Object.keys(vesselMap).map(c => <option key={c} value={c}>{c}</option>)}</select></div><div className="form-group"><label>Σκάφος</label><select value={form.vessel} onChange={e=>setForm({...form, vessel:e.target.value})} disabled={!form.user_company}><option value="">Επιλογή...</option>{availableVessels.map(v => <option key={v} value={v}>{v}</option>)}</select></div></>) : (<div className="form-group"><label>Σκάφος</label><select value={form.vessel} onChange={e=>setForm({...form, vessel:e.target.value})}><option>Επιλογή...</option>{user.vessels.map(v=><option key={v}>{v}</option>)}</select></div>)}<div className="form-group"><label>Καύσιμο</label><select value={form.fuel_type} onChange={e=>setForm({...form, fuel_type:e.target.value})}><option>Επιλογή...</option>{refs.fuel_types.map(f=><option key={f}>{f}</option>)}</select></div><div className="form-group"><label>Εταιρεία Εφοδ.</label><select value={form.supply_company} onChange={e=>setForm({...form, supply_company:e.target.value})}><option>Επιλογή...</option>{refs.companies.map(c=><option key={c}>{c}</option>)}</select></div><div className="form-group"><label>Τρόπος Πληρωμής</label><select value={form.payment_method} onChange={e=>setForm({...form, payment_method:e.target.value})}><option>Ηλεκτρονικά</option><option>Δια ζώσης</option><option>MRN/Αριθμός Πρωτοκόλλου</option></select></div><div className="form-group"><label>MRN/Πρωτόκολλο</label><input value={form.mrn} onChange={e=>setForm({...form, mrn:e.target.value})} /></div><div className="form-group"><label>Ποσότητα</label><input type="number" value={form.quantity} onChange={e=>setForm({...form, quantity:e.target.value})}/></div><div className="map-wrapper" style={{maxWidth: 'fit-content'}}><div className="map-container" onClick={handleMapClick}><img src="/map-chania-old-town-L.jpg" className="map-image" alt="map"/>{form.location.x > -1 && <div className="map-pin" style={{left:`${form.location.x}%`, top:`${form.location.y}%`}}/>}</div></div><div style={{gridColumn:'1/-1'}}><button onClick={submit}>{existing ? 'Save' : 'Submit'}</button></div></div>);
};

const UserDashboard = ({ user }) => {
    const [view, setView] = useState('list'); 
    const [list, setList] = useState([]); 
    const [editItem, setEditItem] = useState(null); 
    
    // Wrapped in useCallback
    const load = useCallback(async () => { 
        const res = await api.get(`${API_URL}/reservations?company=${user.company}`); 
        setList(res.data); 
    }, [user.company]); 

    useEffect(() => { load(); }, [load]); 

    const updateUserVessels = (newVessels) => { user.vessels = newVessels; }; 
    const del = async (r) => { if(window.confirm("Delete?")) { try { await api.delete(`${API_URL}/reservations?id=${r.id}&role=user`); load(); } catch(e) { alert("Error"); } } }; 
    return (<div className="user-dash"><div className="dash-header"><button className={view==='list'?'active':''} onClick={()=>{setEditItem(null); setView('list');}}>Λίστα</button><button className={view==='new'?'active':''} onClick={()=>{setEditItem(null); setView('new');}}>Νέα Κράτηση</button><button className={view==='vessels'?'active':''} onClick={()=>setView('vessels')}>Σκάφη</button></div>{view === 'list' && (<table><thead><tr><th>Ημερομηνία</th><th>Σκάφος</th><th>Κατάσταση</th><th>Ενέργειες</th></tr></thead><tbody>{list.map(r => (<tr key={r.id}><td>{formatDate(r.date)}</td><td>{r.vessel}</td><td>{r.status}</td><td><button onClick={()=>{setEditItem(r); setView('new');}}>Edit</button><button className="danger" onClick={()=>del(r)}>Del</button></td></tr>))}</tbody></table>)}{view === 'new' && <ReservationForm user={user} existing={editItem} onSuccess={()=>{setView('list'); load();}} />}{view === 'vessels' && <VesselManager user={user} onUpdate={updateUserVessels} />}</div>);
};

const VesselManager = ({ user, onUpdate }) => {const [newVessel, setNewVessel] = useState(''); const add = async () => { if (!newVessel) return; const updated = [...user.vessels, newVessel]; const res = await api.post(`${API_URL}/user/vessels`, { id: user.id, vessels: updated }); onUpdate(res.data.vessels); setNewVessel(''); }; const remove = async (v) => { if (!window.confirm("Delete?")) return; const updated = user.vessels.filter(item => item !== v); const res = await api.post(`${API_URL}/user/vessels`, { id: user.id, vessels: updated }); onUpdate(res.data.vessels); }; return (<div className="admin-section"><div className="control-bar"><input value={newVessel} onChange={e=>setNewVessel(e.target.value)} /><button onClick={add}>Add</button></div><ul>{user.vessels.map(v => (<li key={v} style={{display:'flex',justifyContent:'space-between',marginBottom:5}}><span>{v}</span><button className="small-btn danger" onClick={()=>remove(v)}>Del</button></li>))}</ul></div>);};

// ================= 3. EXPORT =================
export const FuelApp = ({ user, onExit }) => {
    const [tab, setTab] = useState('overview');
    return (
        <div className="app-shell">
            <AppHeader title="Εφοδιασμοί" user={user} onExit={onExit} icon={<img src="/ship-icon.png" style={{height:30}} alt=""/>} />
            {user.role === 'admin' || user.role === 'staff' ? (
                <>
                    <div className="tabs">
                        <button className={tab==='overview'?'active':''} onClick={()=>setTab('overview')}>Πρόγραμμα</button>
                        <button className={tab==='debts'?'active':''} onClick={()=>setTab('debts')}>Οφειλές</button>
                        <button className={tab==='new_res'?'active':''} onClick={()=>setTab('new_res')}>Νέος Εφοδιασμός</button>
                        {user.role === 'admin' && (
                            <>
                                <button className={tab==='users'?'active':''} onClick={()=>setTab('users')}>Χρήστες</button>
                                <button className={tab==='comps'?'active':''} onClick={()=>setTab('comps')}>Εταιρείες</button>
                                <button className={tab==='fuel'?'active':''} onClick={()=>setTab('fuel')}>Καύσιμα</button>
                                <button className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}>Ρυθμίσεις</button>
                            </>
                        )}
                    </div>
                    {tab === 'overview' && <DailyReport user={user} />}
                    {tab === 'debts' && <DebtReport />}
                    {tab === 'new_res' && <ReservationForm user={user} onSuccess={() => setTab('overview')} />}
                    {user.role === 'admin' && (
                        <>
                            {tab === 'users' && <UserManager user={user} />}
                            {tab === 'comps' && <ReferenceManager type="companies" title="Εταιρείες" placeholder="Νέα Εταιρεία" />}
                            {tab === 'fuel' && <ReferenceManager type="fuel_types" title="Καύσιμα" placeholder="Νέο Καύσιμο" />}
                            {tab === 'settings' && <SettingsManager />}
                        </>
                    )}
                </>
            ) : ( <UserDashboard user={user} /> )}
        </div>
    );
};