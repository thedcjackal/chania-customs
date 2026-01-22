import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import './App.css';

const API_URL = 'http://localhost:5000/api'; 

const formatDate = (isoString) => {
    if(!isoString) return "";
    const [y, m, d] = isoString.split('-');
    return `${d}-${m}-${y}`;
}
const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
const getDayName = (year, month, day) => ['Κυρ','Δευ','Τρι','Τετ','Πεμ','Παρ','Σαβ'][new Date(year, month, day).getDay()];

// ================= 1. PUBLIC & SHARED COMPONENTS =================

const AppHeader = ({ title, user, onExit, icon }) => (
    <header className="app-header">
        <div style={{display:'flex', gap:10, alignItems:'center'}}>{icon}<h2>{title}</h2></div>
        <div className="header-controls">
            <span style={{fontWeight:'bold'}}>{user.name} {user.surname}</span>
            <button className="secondary small-btn" onClick={onExit}>Έξοδος</button>
        </div>
    </header>
);

const WelcomePage = ({ onNavigate }) => {
    const [announcements, setAnnouncements] = useState([]);
    useEffect(() => { axios.get(`${API_URL}/announcements`).then(res => setAnnouncements(res.data)); }, []);
    return (
        <div className="welcome-container">
            <header className="public-header"><img src="/aade-logo.png" className="header-logo" alt="" /><button className="login-btn" onClick={() => onNavigate('login')}>Είσοδος</button></header>
            <div className="hero-section"><img src="/watermark.jpg" className="watermark-home" alt="" /><h1>Τελωνείο Χανίων</h1><p className="hero-subtitle">Ψηφιακή Πύλη</p></div>
            <div className="news-section">
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}><h3>Τελευταίες Ανακοινώσεις</h3><button className="small-btn secondary" onClick={() => onNavigate('announcements')}>Περισσότερα</button></div>
                {announcements.slice(0, 1).map(a => (<div key={a.id} className="news-card"><small>{formatDate(a.date)}</small><p>{a.text}</p></div>))}
            </div>
        </div>
    );
};

const AnnouncementsPage = ({ onNavigate }) => {
    const [list, setList] = useState([]);
    useEffect(() => { axios.get(`${API_URL}/announcements`).then(res => setList(res.data)); }, []);
    return (<div className="welcome-container"><header className="public-header"><button className="back-btn" onClick={() => onNavigate('welcome')}>← Πίσω</button></header><div className="news-section" style={{marginTop: 80}}><h2>Αρχείο Ανακοινώσεων</h2>{list.map(a => (<div key={a.id} className="news-card"><small>{formatDate(a.date)}</small><p>{a.text}</p></div>))}</div></div>);
};

const Login = ({ onLogin, onBack }) => {
    const [creds, setCreds] = useState({username:'', password:''});
    const handleSubmit = async (e) => { e.preventDefault(); try { const res = await axios.post(`${API_URL}/login`, creds); onLogin(res.data); } catch { alert('Αποτυχία εισόδου.'); } };
    return (<div className="login-wrapper"><button className="back-btn" onClick={onBack}>← Πίσω</button><div className="login-box"><img src="/aade-logo.png" style={{height:60}} alt="" /><h2>Είσοδος</h2><input onChange={e=>setCreds({...creds, username:e.target.value})} placeholder="Όνομα Χρήστη"/><input type="password" onChange={e=>setCreds({...creds, password:e.target.value})} placeholder="Κωδικός"/><button onClick={handleSubmit}>Σύνδεση</button></div></div>);
};

const ServicePortal = ({ onNavigate, user, onLogout }) => {
    const isAllowed = (appKey) => user.allowed_apps && user.allowed_apps.includes(appKey);
    return (<div className="portal-container"><header className="portal-header"><h3>Ηλεκτρονικές Υπηρεσίες</h3><div style={{display:'flex', gap:10, alignItems:'center'}}><span>{user.name} {user.surname}</span><button className="secondary small-btn" onClick={onLogout}>Έξοδος</button></div></header><div className="app-grid"><div className={`app-card ${!isAllowed('fuel') ? 'disabled' : ''}`} onClick={() => isAllowed('fuel') && onNavigate('fuel_app')}><img src="/ship-icon.png" className="icon" alt="" /><h3>Προγραμματισμός Εφοδιασμού Τουριστικών Σκαφών</h3></div><div className={`app-card ${!isAllowed('personnel') ? 'disabled' : ''}`} onClick={() => isAllowed('personnel') && onNavigate('personnel_app')}><span style={{fontSize:50}}>👥</span><h3>Προσωπικό</h3></div><div className={`app-card ${!isAllowed('services') ? 'disabled' : ''}`} onClick={() => isAllowed('services') && onNavigate('services_app')}><span style={{fontSize:50}}>📅</span><h3>Υπηρεσίες & Βάρδιες</h3></div>{isAllowed('announcements') && <div className="app-card" onClick={() => onNavigate('announcements_app')}><span style={{fontSize:50}}>📢</span><h3>Διαχείριση Ανακοινώσεων</h3></div>}{isAllowed('accounts') && <div className="app-card" onClick={() => onNavigate('accounts_app')}><span style={{fontSize:50}}>🔐</span><h3>Διαχείριση Λογαριασμών</h3></div>}</div></div>);
};

// ================= 2. SUB-COMPONENTS =================

const SettingsManager = () => {const [settings, setSettings] = useState(null); useEffect(() => { axios.get(`${API_URL}/admin/settings`).then(res => setSettings(res.data)); }, []); if(!settings) return null; const save = (s) => { setSettings(s); axios.post(`${API_URL}/admin/settings`, s); }; const days = ["Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο", "Κυριακή"]; return (<div className="admin-section"><div className="split-panel flex-align"><h4>Κανόνες Κλειδώματος</h4><label>Ημέρες Πριν:<input type="number" value={settings.lock_rules.days_before} onChange={e=>{const s={...settings}; s.lock_rules.days_before=e.target.value; save(s)}} style={{width:60}}/></label><label>Ώρα (HH:MM):<input type="time" value={settings.lock_rules.time} onChange={e=>{const s={...settings}; s.lock_rules.time=e.target.value; save(s)}}/></label></div><h4>Εβδομαδιαίο Πρόγραμμα</h4><table><thead><tr><th>Ημέρα</th><th>Κατάσταση</th><th>Όριο</th></tr></thead><tbody>{days.map(d=>(<tr key={d}><td>{d}</td><td><button className={`status-btn ${settings.weekly_schedule[d]?.open?'open':'closed'}`} onClick={()=>{const s={...settings}; s.weekly_schedule[d].open=!s.weekly_schedule[d].open; save(s)}}>{settings.weekly_schedule[d]?.open?'Ανοιχτή':'Κλειστή'}</button></td><td><input type="number" value={settings.weekly_schedule[d]?.limit} onChange={e=>{const s={...settings}; s.weekly_schedule[d].limit=parseInt(e.target.value); save(s)}}/></td></tr>))}</tbody></table></div>);};

const UserManager = () => {
    const [users, setUsers] = useState([]); 
    const [modal, setModal] = useState(null); 
    const [form, setForm] = useState({}); 
    useEffect(() => { axios.get(`${API_URL}/admin/users`).then(res => setUsers(res.data)); }, []); 
    const save = async () => { const p={...form, allowed_apps: ['fuel'], vessels:(typeof form.vessels==='string')?form.vessels.split(','):form.vessels}; if(modal.id)await axios.put(`${API_URL}/admin/users`,p);else await axios.post(`${API_URL}/admin/users`,p); setModal(null); window.location.reload(); }; 
    const del = async (id) => { if(window.confirm("Διαγραφή;")) await axios.delete(`${API_URL}/admin/users?id=${id}`); window.location.reload(); }; 
    return (<div className="admin-section"><div className="control-bar"><button onClick={()=>{setForm({}); setModal({});}}>+ Νέος Χρήστης</button></div><table><thead><tr><th>Όνομα</th><th>User</th><th>Ρόλος</th><th>Εταιρεία</th><th>Ενέργειες</th></tr></thead><tbody>{users.filter(u=>u.role!=='root_admin').map(u => <tr key={u.id}><td>{u.name} {u.surname}</td><td>{u.username}</td><td>{u.role}</td><td>{u.company}</td><td><button className="small-btn" onClick={()=>{setForm(u); setModal(u);}}>Edit</button><button className="small-btn danger" onClick={()=>del(u.id)}>Del</button></td></tr>)}</tbody></table>{modal && (<div className="modal-overlay"><div className="modal-content"><h3>Χρήστης</h3><div className="form-grid"><label>Όνομα<input value={form.name||''} onChange={e=>setForm({...form, name:e.target.value})}/></label><label>Επώνυμο<input value={form.surname||''} onChange={e=>setForm({...form, surname:e.target.value})}/></label><label>User<input value={form.username||''} onChange={e=>setForm({...form, username:e.target.value})}/></label><label>Pass<input value={form.password||''} onChange={e=>setForm({...form, password:e.target.value})}/></label><label>Ρόλος<select value={form.role||'user'} onChange={e=>setForm({...form, role:e.target.value})}><option value="user">Χρήστης</option><option value="staff">Προσωπικό</option><option value="admin">Διαχειριστής</option></select></label><label>Εταιρεία<input value={form.company||''} onChange={e=>setForm({...form, company:e.target.value})}/></label><label>Σκάφη (κόμμα)<input value={form.vessels||''} onChange={e=>setForm({...form, vessels:e.target.value})}/></label></div><div style={{marginTop:20}}><button onClick={save}>Αποθήκευση</button> <button className="secondary" onClick={()=>setModal(null)}>Ακύρωση</button></div></div></div>)}</div>);
};

const ReferenceManager = ({type, title, placeholder}) => {
    const [list, setList] = useState([]); 
    const [text, setText] = useState(''); 
    const [editMode, setEditMode] = useState(null); 
    const [editText, setEditText] = useState(''); 
    useEffect(() => { axios.get(`${API_URL}/admin/reference`).then(res => setList(res.data[type])); }, []); 
    const add = async () => { if(text) await axios.post(`${API_URL}/admin/reference`, {type, value:text}); setText(''); window.location.reload(); }; 
    const saveEdit = async () => { await axios.put(`${API_URL}/admin/reference`, {type, old_value: editMode, new_value: editText}); setEditMode(null); window.location.reload(); }; 
    const del = async (val) => { if(window.confirm("Διαγραφή;")) await axios.delete(`${API_URL}/admin/reference?type=${type}&value=${val}`); window.location.reload(); }; 
    return (<div className="admin-section"><h4>{title}</h4><div className="control-bar"><input value={text} onChange={e=>setText(e.target.value)} placeholder={placeholder} style={{flex:1}}/><button onClick={add}>Προσθήκη</button></div><ul>{list.map(c => (<li key={c} style={{marginBottom:10, display:'flex', justifyContent:'space-between', alignItems:'center'}}>{editMode===c?(<><input value={editText} onChange={e=>setEditText(e.target.value)} /><span><button className="small-btn" onClick={saveEdit}>OK</button><button className="small-btn secondary" onClick={()=>setEditMode(null)}>Cancel</button></span></>):(<><span>{c}</span><span><button className="small-btn" onClick={()=>{setEditMode(c); setEditText(c)}}>Edit</button><button className="small-btn danger" onClick={()=>del(c)}>Del</button></span></>)}</li>))}</ul></div>);
};

const AnnouncementManager = () => {
    const [list, setList] = useState([]); 
    const [text, setText] = useState(''); 
    useEffect(() => { load(); }, []); 
    const load = () => axios.get(`${API_URL}/announcements`).then(res => setList(res.data)); 
    const add = async () => { if(text) await axios.post(`${API_URL}/announcements`, {text}); setText(''); load(); }; 
    const del = async (id) => { await axios.delete(`${API_URL}/announcements?id=${id}`); load(); }; 
    return (
        <div className="admin-section">
            <div className="control-bar"><input value={text} onChange={e=>setText(e.target.value)} placeholder="Νέα Ανακοίνωση..." style={{flex:1}}/><button onClick={add}>Δημοσίευση</button></div>
            <ul>{list.map(a => <li key={a.id} style={{marginBottom:10, display:'flex', justifyContent:'space-between'}}>{a.text} <button className="small-btn danger" onClick={()=>del(a.id)}>X</button></li>)}</ul>
        </div>
    );
};

const DailyReport = ({ user }) => {const [date, setDate] = useState(new Date().toISOString().split('T')[0]); const [reservations, setReservations] = useState([]); const [employees, setEmployees] = useState([]); const [isFinalized, setIsFinalized] = useState(false); const [assignMode, setAssignMode] = useState(''); const [empA, setEmpA] = useState(''); const [empB, setEmpB] = useState(''); const [singleEmp, setSingleEmp] = useState(''); const [viewRes, setViewRes] = useState(null); const [refs, setRefs] = useState({ fuel_types: [], companies: [] }); const printRef = useRef(); useEffect(() => { axios.get(`${API_URL}/admin/employees`).then(res => setEmployees(res.data)); axios.get(`${API_URL}/admin/reference`).then(res => setRefs(res.data)); loadRes(); axios.get(`${API_URL}/daily_status?date=${date}`).then(res => setIsFinalized(res.data.finalized)); }, [date]); const loadRes = async () => { const res = await axios.get(`${API_URL}/reservations?date=${date}`); setReservations(res.data.sort((a,b) => b.location.x - a.location.x).map((r,i) => ({...r, sn: i+1}))); }; const handleAssign = async (id, name) => { await axios.put(`${API_URL}/reservations`, { id, role: 'admin', updates: { assigned_employee: name } }); loadRes(); }; const toggleFinalize = async () => { try { const ns = !isFinalized; await axios.post(`${API_URL}/daily_status`, { date, finalized: ns }); setIsFinalized(ns); } catch (err) { alert("Error"); } }; const runAssign = async () => { if (assignMode === 'single') { if (!singleEmp) return alert("Select Employee"); for (const r of reservations) await axios.put(`${API_URL}/reservations`, { id: r.id, role: 'admin', updates: { assigned_employee: singleEmp } }); } else if (assignMode === 'split') { if (!empA || !empB) return alert("Select 2 Employees"); const groups = {}; reservations.forEach(r => { const k = `${r.supply_company||'U'}|${r.fuel_type||'U'}`; if (!groups[k]) groups[k] = []; groups[k].push(r); }); let maxKey = null; let maxSize = -1; Object.keys(groups).forEach(k => { if (groups[k].length > maxSize) { maxSize = groups[k].length; maxKey = k; } }); for (const r of reservations) { const k = `${r.supply_company||'U'}|${r.fuel_type||'U'}`; const emp = (k === maxKey ? empA : empB); await axios.put(`${API_URL}/reservations`, { id: r.id, role: 'admin', updates: { assigned_employee: emp } }); } } setAssignMode(''); loadRes(); }; const toggleDebt = async (r, action) => { const newFlags = action === 'remove' ? r.flags.filter(f => f !== 'Οφειλή') : [...r.flags, 'Οφειλή']; await axios.put(`${API_URL}/reservations`, { id: r.id, role: 'admin', updates: { flags: newFlags } }); setViewRes({...viewRes, flags: newFlags}); loadRes(); }; const saveChanges = async () => { await axios.put(`${API_URL}/reservations`, { id: viewRes.id, role: 'admin', updates: viewRes }); setViewRes(null); loadRes(); }; const handleMapClick = (e) => { if(isFinalized) return; const rect = e.target.getBoundingClientRect(); setViewRes({ ...viewRes, location: { x: ((e.clientX - rect.left)/rect.width)*100, y: ((e.clientY - rect.top)/rect.height)*100 } }); }; const generatePDF = async () => { if (!printRef.current) return; printRef.current.style.display = 'block'; const pdf = new jsPDF('l', 'mm', 'a4'); const pdfWidth = pdf.internal.pageSize.getWidth(); const employeesToPrint = [...new Set(reservations.map(r => r.assigned_employee || 'Unassigned'))]; for (let i = 0; i < employeesToPrint.length; i++) { const empElement = document.getElementById(`print-section-${i}`); if (empElement) { const canvas = await html2canvas(empElement, { scale: 2 }); const imgData = canvas.toDataURL('image/png'); const imgHeight = (canvas.height * pdfWidth) / canvas.width; if (i > 0) pdf.addPage(); pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgHeight); } } printRef.current.style.display = 'none'; pdf.save(`Report_${date}.pdf`); }; return (<div className="admin-section"><div className="control-bar-daily"><div style={{display:'flex', gap:10, alignItems:'center'}}><label style={{fontWeight:'bold'}}>Ημερομηνία:</label><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{width: 150}} /></div><div style={{display:'flex', gap:10}}><button onClick={() => setAssignMode(assignMode==='single'?'':'single')} disabled={isFinalized} className={isFinalized?'disabled-btn':''}>1️⃣ Ανάθεση σε Έναν</button><button onClick={() => setAssignMode(assignMode==='split'?'':'split')} disabled={isFinalized} className={isFinalized?'disabled-btn':''}>⚡ Διαχωρισμός Εργασίας</button><button onClick={toggleFinalize} className={`finalize-btn ${isFinalized?'closed':'open'}`}>{isFinalized ? "Ξεκλείδωμα" : "Οριστικοποίηση"}</button><button onClick={generatePDF}>PDF</button></div></div>{assignMode === 'single' && !isFinalized && (<div className="split-panel"><label>Ανάθεση ΟΛΩΝ σε:</label><select onChange={e=>setSingleEmp(e.target.value)}><option value="">Επιλογή...</option>{employees.map(e=><option key={e.id} value={e.name}>{e.name}</option>)}</select><button onClick={runAssign}>Εφαρμογή</button></div>)}{assignMode === 'split' && !isFinalized && (<div className="split-panel"><select onChange={e=>setEmpA(e.target.value)}><option value="">Υπάλληλος Α (Κύριος)</option>{employees.map(e=><option key={e.id} value={e.name}>{e.name}</option>)}</select><select onChange={e=>setEmpB(e.target.value)}><option value="">Υπάλληλος Β (Υπόλοιπα)</option>{employees.map(e=><option key={e.id} value={e.name}>{e.name}</option>)}</select><button onClick={runAssign}>Εφαρμογή</button></div>)}<table><thead><tr><th>Α/Α</th><th>Εταιρεία</th><th>Σκάφος</th><th>Σημάνσεις</th><th>Ανατέθηκε</th></tr></thead><tbody>{reservations.map(r => (<tr key={r.id} onClick={() => setViewRes(r)} style={{cursor:'pointer', background: viewRes?.id===r.id?'#e3f2fd':'transparent'}}><td>{r.sn}</td><td>{r.user_company}</td><td>{r.vessel}</td><td style={{color:'red'}}>{r.flags.join(', ')}</td><td onClick={e=>e.stopPropagation()}><select value={r.assigned_employee} disabled={isFinalized} onChange={(e)=>handleAssign(r.id, e.target.value)}><option value="">Επιλογή...</option>{employees.map(e=><option key={e.id} value={e.name}>{e.name}</option>)}</select></td></tr>))}</tbody></table>{viewRes && (<div className="modal-overlay" onClick={() => setViewRes(null)}><div className="modal-content" onClick={e => e.stopPropagation()}><h3>Επεξεργασία #{viewRes.sn}</h3><div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:20}}><div className="form-group-vertical"><label>Ημερομηνία</label><input type="date" disabled={isFinalized} value={viewRes.date} onChange={e=>setViewRes({...viewRes, date:e.target.value})} /><label>Σκάφος</label><input disabled={isFinalized} value={viewRes.vessel} onChange={e=>setViewRes({...viewRes, vessel:e.target.value})} /><label>Εταιρεία Χρήστη</label><input disabled={isFinalized} value={viewRes.user_company} onChange={e=>setViewRes({...viewRes, user_company:e.target.value})} /><label>Εταιρεία Εφοδ.</label><select disabled={isFinalized} value={viewRes.supply_company} onChange={e=>setViewRes({...viewRes, supply_company:e.target.value})}>{refs.companies.map(c=><option key={c}>{c}</option>)}</select><label>Καύσιμο</label><select disabled={isFinalized} value={viewRes.fuel_type} onChange={e=>setViewRes({...viewRes, fuel_type:e.target.value})}>{refs.fuel_types.map(f=><option key={f}>{f}</option>)}</select><label>Ποσότητα</label><input type="number" disabled={isFinalized} value={viewRes.quantity} onChange={e=>setViewRes({...viewRes, quantity:e.target.value})} /><label>Πληρωμή</label><select disabled={isFinalized} value={viewRes.payment_method} onChange={e=>setViewRes({...viewRes, payment_method:e.target.value})}><option>Ηλεκτρονικά</option><option>Δια ζώσης</option><option>MRN/Αριθμός Πρωτοκόλλου</option></select><label>MRN</label><input disabled={isFinalized} value={viewRes.mrn || ''} onChange={e=>setViewRes({...viewRes, mrn:e.target.value})} /><div style={{marginTop:10}}>{!isFinalized && (viewRes.flags.includes("Οφειλή") ? <button className="small-btn open" onClick={() => toggleDebt(viewRes, 'remove')}>Εξόφληση</button> : <button className="small-btn closed" onClick={() => toggleDebt(viewRes, 'add')}>+ Οφειλή</button>)}</div></div><div className="map-wrapper" style={{width:'100%', height:'auto'}}><div className="map-container" onClick={handleMapClick}><img src="/map-chania-old-town-L.jpg" className="modal-map-image" alt="" /><div className="map-pin" style={{left:`${viewRes.location.x}%`, top:`${viewRes.location.y}%`}}/></div></div></div><div style={{marginTop:20}}>{!isFinalized && <button onClick={saveChanges}>Save</button>}<button className="secondary" onClick={() => setViewRes(null)}>Close</button></div></div></div>)}<div id="print-area" ref={printRef} style={{display:'none', width:'297mm'}}>{[...new Set(reservations.map(r => r.assigned_employee || 'Unassigned'))].map((emp, index) => (<div key={emp} id={`print-section-${index}`} style={{padding:'20px', background:'white', height:'210mm', boxSizing:'border-box'}}><div style={{display:'flex', justifyContent:'space-between', marginBottom:'20px'}}><img src="/aade-logo.png" style={{height:'50px'}} alt="" /><h2>Πρόγραμμα Εφοδιασμού Σκαφών με Καύσιμα ({formatDate(date)})</h2></div><h3 style={{background:'#002F6C', color:'white', padding:'5px'}}>Υπάλληλος: {emp}</h3><table className="print-table" style={{width:'100%', borderCollapse:'collapse', fontSize:'9pt', tableLayout:'fixed'}}><colgroup><col style={{width:'5%'}}/><col style={{width:'14%'}}/><col style={{width:'14%'}}/><col style={{width:'8%'}}/><col style={{width:'14%'}}/><col style={{width:'8%'}}/><col style={{width:'10%'}}/><col style={{width:'12%'}}/><col style={{width:'15%'}}/></colgroup><thead><tr style={{background:'#eee'}}><th style={{padding:5}}>A/A</th><th style={{padding:5}}>Εταιρεία</th><th style={{padding:5}}>Σκάφος</th><th style={{padding:5}}>Καύσιμο</th><th style={{padding:5}}>Εφοδιάστρια<br/>Εταιρεία</th><th style={{padding:5}}>Ποσ.</th><th style={{padding:5}}>Πληρωμή</th><th style={{padding:5}}>MRN</th><th style={{padding:5}}>Σημ.</th></tr></thead><tbody>{reservations.filter(r => (r.assigned_employee||'Unassigned') === emp).map(r => (<tr key={r.id} style={{borderBottom:'1px solid #ddd'}}><td style={{padding:5, verticalAlign:'top'}}>{r.sn}</td><td style={{padding:5, verticalAlign:'top', whiteSpace:'normal', wordWrap:'break-word'}}>{r.user_company}</td><td style={{padding:5, verticalAlign:'top', whiteSpace:'normal', wordWrap:'break-word'}}>{r.vessel}</td><td style={{padding:5, verticalAlign:'top', whiteSpace:'normal', wordWrap:'break-word'}}>{r.fuel_type.split('(')[0]}</td><td style={{padding:5, verticalAlign:'top', whiteSpace:'normal', wordWrap:'break-word'}}>{r.supply_company}</td><td style={{padding:5, verticalAlign:'top'}}>{r.quantity}</td><td style={{padding:5, verticalAlign:'top', whiteSpace:'normal', wordWrap:'break-word'}}>{r.payment_method}</td><td style={{padding:5, verticalAlign:'top', whiteSpace:'normal', wordWrap:'break-word'}}>{r.mrn}</td><td style={{padding:5, verticalAlign:'top', color:'red', whiteSpace:'normal', wordWrap:'break-word'}}>{r.flags.join(', ')}</td></tr>))}</tbody></table><div style={{width:'100%', height:'350px', position:'relative', overflow:'hidden'}}><img src="/map-chania-old-town-L.jpg" style={{width:'100%', height:'100%', objectFit:'cover'}} alt="" />{reservations.filter(r => (r.assigned_employee||'Unassigned') === emp).map(r => (<div key={r.id} style={{position:'absolute', left:`${r.location.x}%`, top:`${r.location.y}%`, width:20, height:20, background:'red', borderRadius:'50%', color:'white', display:'flex', justifyContent:'center', alignItems:'center', fontWeight:'bold', transform:'translate(-50%,-50%)'}}>{r.sn}</div>))}</div></div>))}</div></div>);};
const DebtReport = () => {const [debts, setDebts] = useState([]); const [filter, setFilter] = useState(''); useEffect(() => { load(); }, []); const load = async () => { const res = await axios.get(`${API_URL}/reservations`); setDebts(res.data.filter(r => r.flags.includes("Οφειλή"))); }; const clear = async (r) => { if(!window.confirm("Εξόφληση;")) return; await axios.put(`${API_URL}/reservations`, {id:r.id, role:'admin', updates:{flags:r.flags.filter(f=>f!=='Οφειλή')}}); load(); }; return (<div className="admin-section"><div className="control-bar"><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Αναζήτηση Εταιρείας..." /></div><table><thead><tr><th>Ημερομηνία</th><th>Εταιρεία</th><th>Ποσότητα</th><th>Ενέργειες</th></tr></thead><tbody>{debts.filter(d=>d.user_company.toLowerCase().includes(filter.toLowerCase())).map(r=><tr key={r.id}><td>{formatDate(r.date)}</td><td>{r.user_company}</td><td>{r.quantity}</td><td><button className="small-btn open" onClick={()=>clear(r)}>Εξόφληση</button></td></tr>)}</tbody></table></div>);};
const ReservationForm = ({ user, existing, onSuccess }) => {const [form, setForm] = useState(existing || { date: '', vessel: '', user_company: user.company || '', fuel_type: '', quantity: 0, payment_method: 'Ηλεκτρονικά', mrn: '', supply_company: '', location: {x:-1,y:-1} }); const [refs, setRefs] = useState({ fuel_types: [], companies: [] }); const [vesselMap, setVesselMap] = useState({}); useEffect(() => { axios.get(`${API_URL}/admin/reference`).then(r => setRefs(r.data)); if (user.role !== 'user') axios.get(`${API_URL}/vessel_map`).then(res => setVesselMap(res.data)); }, [user.role]); const handleMapClick = (e) => { const rect = e.target.getBoundingClientRect(); setForm({ ...form, location: { x: ((e.clientX - rect.left)/rect.width)*100, y: ((e.clientY - rect.top)/rect.height)*100 } }); }; const submit = async () => { if (form.location.x === -1) return alert("Select location"); let res; if (existing) { await axios.put(`${API_URL}/reservations`, { id: existing.id, role: 'user', updates: form }); onSuccess(); } else { res = await axios.post(`${API_URL}/reservations`, { ...form, user_name: user.name, user_company: (user.role !== 'user' && form.user_company) ? form.user_company : user.company }); onSuccess(); } }; const availableVessels = (user.role !== 'user' && form.user_company) ? (vesselMap[form.user_company] || []) : user.vessels; return (<div className="form-grid"><div className="form-group"><label>Ημερομηνία</label><input type="date" value={form.date} onChange={e=>setForm({...form, date:e.target.value})} disabled={!!existing}/></div>{user.role !== 'user' ? (<><div className="form-group"><label>Εταιρεία Πελάτη</label><select value={form.user_company} onChange={e=>setForm({...form, user_company:e.target.value, vessel:''})}><option value="">Επιλογή...</option>{Object.keys(vesselMap).map(c => <option key={c} value={c}>{c}</option>)}</select></div><div className="form-group"><label>Σκάφος</label><select value={form.vessel} onChange={e=>setForm({...form, vessel:e.target.value})} disabled={!form.user_company}><option value="">Επιλογή...</option>{availableVessels.map(v => <option key={v} value={v}>{v}</option>)}</select></div></>) : (<div className="form-group"><label>Σκάφος</label><select value={form.vessel} onChange={e=>setForm({...form, vessel:e.target.value})}><option>Επιλογή...</option>{user.vessels.map(v=><option key={v}>{v}</option>)}</select></div>)}<div className="form-group"><label>Καύσιμο</label><select value={form.fuel_type} onChange={e=>setForm({...form, fuel_type:e.target.value})}><option>Επιλογή...</option>{refs.fuel_types.map(f=><option key={f}>{f}</option>)}</select></div><div className="form-group"><label>Εταιρεία Εφοδ.</label><select value={form.supply_company} onChange={e=>setForm({...form, supply_company:e.target.value})}><option>Επιλογή...</option>{refs.companies.map(c=><option key={c}>{c}</option>)}</select></div><div className="form-group"><label>Τρόπος Πληρωμής</label><select value={form.payment_method} onChange={e=>setForm({...form, payment_method:e.target.value})}><option>Ηλεκτρονικά</option><option>Δια ζώσης</option><option>MRN/Αριθμός Πρωτοκόλλου</option></select></div><div className="form-group"><label>MRN/Πρωτόκολλο</label><input value={form.mrn} onChange={e=>setForm({...form, mrn:e.target.value})} /></div><div className="form-group"><label>Ποσότητα</label><input type="number" value={form.quantity} onChange={e=>setForm({...form, quantity:e.target.value})}/></div><div className="map-wrapper" style={{maxWidth: 'fit-content'}}><div className="map-container" onClick={handleMapClick}><img src="/map-chania-old-town-L.jpg" className="map-image" alt="map"/>{form.location.x > -1 && <div className="map-pin" style={{left:`${form.location.x}%`, top:`${form.location.y}%`}}/>}</div></div><div style={{gridColumn:'1/-1'}}><button onClick={submit}>{existing ? 'Save' : 'Submit'}</button></div></div>);};
const UserDashboard = ({ user }) => {const [view, setView] = useState('list'); const [list, setList] = useState([]); const [editItem, setEditItem] = useState(null); const updateUserVessels = (newVessels) => { user.vessels = newVessels; }; useEffect(() => { load(); }, []); const load = async () => { const res = await axios.get(`${API_URL}/reservations?company=${user.company}`); setList(res.data); }; const del = async (r) => { if(window.confirm("Delete?")) { try { await axios.delete(`${API_URL}/reservations?id=${r.id}&role=user`); load(); } catch(e) { alert("Error"); } } }; return (<div className="user-dash"><div className="dash-header"><button className={view==='list'?'active':''} onClick={()=>{setEditItem(null); setView('list');}}>Λίστα</button><button className={view==='new'?'active':''} onClick={()=>{setEditItem(null); setView('new');}}>Νέα Κράτηση</button><button className={view==='vessels'?'active':''} onClick={()=>setView('vessels')}>Σκάφη</button></div>{view === 'list' && (<table><thead><tr><th>Ημερομηνία</th><th>Σκάφος</th><th>Κατάσταση</th><th>Ενέργειες</th></tr></thead><tbody>{list.map(r => (<tr key={r.id}><td>{formatDate(r.date)}</td><td>{r.vessel}</td><td>{r.status}</td><td><button onClick={()=>{setEditItem(r); setView('new');}}>Edit</button><button className="danger" onClick={()=>del(r)}>Del</button></td></tr>))}</tbody></table>)}{view === 'new' && <ReservationForm user={user} existing={editItem} onSuccess={()=>{setView('list'); load();}} />}{view === 'vessels' && <VesselManager user={user} onUpdate={updateUserVessels} />}</div>);};
const VesselManager = ({ user, onUpdate }) => {const [newVessel, setNewVessel] = useState(''); const add = async () => { if (!newVessel) return; const updated = [...user.vessels, newVessel]; const res = await axios.post(`${API_URL}/user/vessels`, { id: user.id, vessels: updated }); onUpdate(res.data.vessels); setNewVessel(''); }; const remove = async (v) => { if (!window.confirm("Delete?")) return; const updated = user.vessels.filter(item => item !== v); const res = await axios.post(`${API_URL}/user/vessels`, { id: user.id, vessels: updated }); onUpdate(res.data.vessels); }; return (<div className="admin-section"><div className="control-bar"><input value={newVessel} onChange={e=>setNewVessel(e.target.value)} /><button onClick={add}>Add</button></div><ul>{user.vessels.map(v => (<li key={v} style={{display:'flex',justifyContent:'space-between',marginBottom:5}}><span>{v}</span><button className="small-btn danger" onClick={()=>remove(v)}>Del</button></li>))}</ul></div>);};

// ================= 3. SUB-APPS =================

const FuelApp = ({ user, onExit }) => {
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

const AnnouncementsApp = ({ user, onExit }) => {
    const [list, setList] = useState([]); const [text, setText] = useState('');
    useEffect(() => { load(); }, []);
    const load = () => axios.get(`${API_URL}/announcements`).then(res => setList(res.data));
    const add = async () => { if(text) await axios.post(`${API_URL}/announcements`, {text}); setText(''); load(); };
    const del = async (id) => { await axios.delete(`${API_URL}/announcements?id=${id}`); load(); };
    return (
        <div className="app-shell"><AppHeader title="Διαχείριση Ανακοινώσεων" user={user} onExit={onExit} icon={<span>📢</span>} /><div className="admin-section"><div className="control-bar"><input value={text} onChange={e=>setText(e.target.value)} placeholder="Νέα Ανακοίνωση..." style={{flex:1}}/><button onClick={add}>Δημοσίευση</button></div><ul>{list.map(a => <li key={a.id} style={{marginBottom:10, display:'flex', justifyContent:'space-between'}}>{a.text} <button className="small-btn danger" onClick={()=>del(a.id)}>X</button></li>)}</ul></div></div>
    );
};

const PersonnelApp = ({ user, onExit }) => {
    const [emps, setEmps] = useState([]); const [form, setForm] = useState({}); const [modal, setModal] = useState(null);
    useEffect(() => { load(); }, []);
    const load = () => axios.get(`${API_URL}/admin/employees`).then(res => setEmps(res.data));
    const save = async () => { if(modal.id) await axios.put(`${API_URL}/admin/employees`, form); else await axios.post(`${API_URL}/admin/employees`, form); setModal(null); load(); };
    const del = async (id) => { if(window.confirm("Del?")) await axios.delete(`${API_URL}/admin/employees?id=${id}`); load(); };
    const onDragStart = (e, index) => e.dataTransfer.setData("idx", index);
    const onDrop = async (e, droppedIndex) => {
        const draggedIndex = e.dataTransfer.getData("idx"); if(draggedIndex === droppedIndex) return;
        const newEmps = [...emps]; const [moved] = newEmps.splice(draggedIndex, 1); newEmps.splice(droppedIndex, 0, moved);
        await axios.put(`${API_URL}/admin/employees`, {reorder: newEmps.map(e=>e.id)}); load();
    };
    return (
        <div className="app-shell"><AppHeader title="Προσωπικό" user={user} onExit={onExit} icon={<span>👥</span>} />
            <div className="admin-section">
                {user.role === 'admin' && <button style={{marginBottom:20}} onClick={()=>{setForm({});setModal({})}}>+ Νέος Υπάλληλος</button>}
                <table><thead><tr><th></th><th>Όνομα</th><th>Κινητό</th><th>Email</th><th>Ενέργειες</th></tr></thead><tbody>
                    {emps.map((e, i) => (
                        <tr key={e.id} draggable={user.role==='admin'} onDragStart={(ev)=>onDragStart(ev, i)} onDragOver={(ev)=>ev.preventDefault()} onDrop={(ev)=>onDrop(ev, i)} style={{cursor:user.role==='admin'?'grab':'default'}}>
                            <td>☰</td><td>{e.name}</td><td>{e.phone}</td><td>{e.email}</td>
                            <td>{user.role === 'admin' && <><button className="small-btn" onClick={()=>{setForm(e);setModal(e)}}>Edit</button><button className="small-btn danger" onClick={()=>del(e.id)}>X</button></>}</td>
                        </tr>
                    ))}
                </tbody></table>
            </div>
            {modal && <div className="modal-overlay"><div className="modal-content"><h3>Υπάλληλος</h3><div className="form-grid"><label>Όνομα<input value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Κινητό<input value={form.phone||''} onChange={e=>setForm({...form,phone:e.target.value})}/></label><label>Email<input value={form.email||''} onChange={e=>setForm({...form,email:e.target.value})}/></label></div><button onClick={save}>Save</button><button onClick={()=>setModal(null)}>Cancel</button></div></div>}
        </div>
    );
};

const AccountManager = ({ user, onExit }) => {
    const [users, setUsers] = useState([]); const [modal, setModal] = useState(null); const [form, setForm] = useState({});
    useEffect(() => { load(); }, []);
    const load = () => axios.get(`${API_URL}/admin/users`).then(res => setUsers(res.data));
    const save = async () => { const p={...form, vessels:(typeof form.vessels==='string')?form.vessels.split(','):form.vessels}; if(modal.id) await axios.put(`${API_URL}/admin/users`, p); else await axios.post(`${API_URL}/admin/users`, p); setModal(null); load(); };
    const del = async (id) => { await axios.delete(`${API_URL}/admin/users?id=${id}`); load(); };
    const toggle = (a) => { const l=form.allowed_apps||[]; setForm({...form, allowed_apps:l.includes(a)?l.filter(x=>x!==a):[...l,a]}); };
    return (<div className="app-shell"><AppHeader title="Διαχείριση Λογαριασμών" user={user} onExit={onExit} icon={<span>🔐</span>} /><div className="admin-section"><button onClick={()=>{setForm({allowed_apps:[]});setModal({})}}>+ New</button><table><tbody>{users.map(u=><tr key={u.id}><td>{u.surname} {u.name}</td><td>{u.username}</td><td>{u.role}</td><td>{u.allowed_apps?.join(', ')}</td><td><button onClick={()=>{setForm(u);setModal(u)}}>Edit</button><button onClick={()=>del(u.id)}>X</button></td></tr>)}</tbody></table></div>{modal && <div className="modal-overlay"><div className="modal-content"><div className="form-grid"><label>Name<input value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Surname<input value={form.surname||''} onChange={e=>setForm({...form,surname:e.target.value})}/></label><label>User<input value={form.username||''} onChange={e=>setForm({...form,username:e.target.value})}/></label><label>Pass<input value={form.password||''} onChange={e=>setForm({...form,password:e.target.value})}/></label><select value={form.role||'user'} onChange={e=>setForm({...form,role:e.target.value})}><option value="user">User</option><option value="staff">Staff</option><option value="admin">Admin</option><option value="root_admin">Root</option></select><div style={{gridColumn:'1/-1', display:'flex', gap:10}}><label><input type="checkbox" checked={form.allowed_apps?.includes('fuel')} onChange={()=>toggle('fuel')}/>Fuel</label><label><input type="checkbox" checked={form.allowed_apps?.includes('personnel')} onChange={()=>toggle('personnel')}/>Pers</label><label><input type="checkbox" checked={form.allowed_apps?.includes('services')} onChange={()=>toggle('services')}/>Serv</label><label><input type="checkbox" checked={form.allowed_apps?.includes('accounts')} onChange={()=>toggle('accounts')}/>Acc</label></div></div><button onClick={save}>Save</button><button onClick={()=>setModal(null)}>Cancel</button></div></div>}</div>);
};

const ServicesApp = ({ user, onExit }) => {
    const [tab, setTab] = useState(user.role === 'admin' ? 'schedule' : 'myschedule');
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
    const printRef1 = useRef(); const printRef2 = useRef();

    useEffect(() => {
        const fetchAll = async () => {
            const c = await axios.get(`${API_URL}/admin/services/config`); setConfig(c.data);
            const s = await axios.get(`${API_URL}/services/schedule`); setSchedule(s.data);
            const e = await axios.get(`${API_URL}/admin/employees`); setEmployees(e.data);
            if(user.role !== 'admin' && user.role !== 'root_admin') loadMyUnavailability();
        };
        fetchAll();
    }, [user.id]);

    useEffect(() => {
        if(tab === 'balance') {
            axios.get(`${API_URL}/services/balance`).then(res => setBalanceStats(res.data));
        }
    }, [tab, schedule]); 

    const loadConfig = () => axios.get(`${API_URL}/admin/services/config`).then(res => setConfig(res.data));
    const loadMyUnavailability = () => axios.get(`${API_URL}/services/unavailability?employee_id=${user.id}`).then(res => setMyUnavail(res.data));

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
        if (!dutyForm.name) return;
        const newDuty = { 
            id: dutyEditMode ? dutyForm.id : Date.now(),
            name: dutyForm.name,
            shifts_per_day: parseInt(dutyForm.shifts_per_day),
            default_hours: dutyForm.default_hours || [],
            shift_config: dutyForm.shift_config || [], 
            is_special: dutyForm.is_special || false,
            // REMOVED TOP-LEVEL EXCLUDED/HANDICAPS - NOW IN SHIFT CONFIG
            is_weekly: dutyForm.is_weekly || false,
            is_off_balance: dutyForm.is_off_balance || false,
            sunday_active_range: dutyForm.sunday_active_range || { start: '', end: '' } 
        };
        
        // Ensure shift_config has structure
        if (!newDuty.shift_config || newDuty.shift_config.length < newDuty.shifts_per_day) {
            newDuty.shift_config = Array.from({length: newDuty.shifts_per_day}).map((_, i) => 
                (dutyForm.shift_config && dutyForm.shift_config[i]) ? dutyForm.shift_config[i] : {
                    is_night:false, is_within_hours:false, active_range:{start:'', end:''}, excluded_ids:[], handicaps:{}
                }
            );
        }

        let newDuties = [...config.duties]; 
        if(dutyEditMode) { const idx = newDuties.findIndex(d => d.id === dutyForm.id); newDuties[idx] = newDuty; } 
        else { newDuties.push(newDuty); }
        await axios.post(`${API_URL}/admin/services/config`, { ...config, duties: newDuties }); 
        setConfig({...config, duties: newDuties}); setDutyForm({}); setDutyEditMode(null); loadConfig();
    };

    const toggleExclusion = async (dutyId, shiftIdx, empId) => {
        const newDuties = [...config.duties];
        const dIdx = newDuties.findIndex(d => d.id === dutyId);
        if (dIdx === -1) return;

        const duty = { ...newDuties[dIdx] };
        const sConf = [...duty.shift_config];
        const target = { ...sConf[shiftIdx] };
        
        let excl = target.excluded_ids || [];
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
        const sConf = [...duty.shift_config];
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
        await axios.post(`${API_URL}/admin/services/config`, { ...config, duties: newDuties });
        setConfig({...config, duties: newDuties});
    };

    const handleShiftCountChange = (val) => { 
        const count = parseInt(val); 
        const hours = dutyForm.default_hours || []; 
        const conf = dutyForm.shift_config || [];
        // Resize arrays
        if (hours.length < count) { 
            for(let i=hours.length; i<count; i++) { 
                hours.push("08:00-16:00"); 
                conf.push({is_night:false, is_within_hours:false, active_range: {start:'', end:''}, excluded_ids:[], handicaps:{}}); 
            }
        } else if (hours.length > count) { 
            hours.splice(count); conf.splice(count);
        } 
        setDutyForm({ ...dutyForm, shifts_per_day: count, default_hours: hours, shift_config: conf }); 
    };
    
    const handleHourChange = (idx, val) => { const hours = [...(dutyForm.default_hours || [])]; hours[idx] = val; setDutyForm({ ...dutyForm, default_hours: hours }); };
    
    const handleFlagChange = (idx, flag) => {
        const conf = [...(dutyForm.shift_config || [])];
        if(!conf[idx]) conf[idx] = {is_night:false, is_within_hours:false, active_range: {start:'', end:''}, excluded_ids:[], handicaps:{}};
        conf[idx][flag] = !conf[idx][flag];
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
    
    const toggleSpecial = async (dStr) => { const newS = config.special_dates.includes(dStr) ? config.special_dates.filter(d=>d!==dStr) : [...config.special_dates, dStr]; await axios.post(`${API_URL}/admin/services/config`, {...config, special_dates: newS}); setConfig({...config, special_dates: newS}); };

    const runManualScheduler = async () => {
        if (!schedulerRange.start || !schedulerRange.end) return alert("Select Start and End months");
        const start = schedulerRange.start + "-01";
        const end = new Date(schedulerRange.end + "-01");
        end.setMonth(end.getMonth() + 1); end.setDate(0);
        const endStr = end.toISOString().split('T')[0];
        try {
            const res = await axios.post(`${API_URL}/services/run_scheduler`, { start_date: start, end_date: endStr });
            const s = await axios.get(`${API_URL}/services/schedule`); 
            setSchedule(s.data);
            setSchedulerLogs(res.data.logs || []);
            setSchedulerModal(false); 
            alert("Scheduler Finished!");
        } catch (e) { alert("Scheduler Error: " + (e.response?.data?.error || e.message)); }
    };

    const runClearSchedule = async () => {
        if (!clearRange.start || !clearRange.end) return alert("Select Start and End months");
        const start = clearRange.start + "-01";
        const end = new Date(clearRange.end + "-01");
        end.setMonth(end.getMonth() + 1); end.setDate(0);
        const endStr = end.toISOString().split('T')[0];
        if (!window.confirm("Προσοχή: Αυτή η ενέργεια θα διαγράψει ΟΛΕΣ τις αναθέσεις (και τις χειροκίνητες) για το επιλεγμένο διάστημα. Συνέχεια;")) return;
        try {
            await axios.post(`${API_URL}/services/clear_schedule`, { start_date: start, end_date: endStr });
            const s = await axios.get(`${API_URL}/services/schedule`); setSchedule(s.data);
            setClearModal(false); alert("Schedule Cleared!");
        } catch (e) { alert("Clear Error: " + (e.response?.data?.error || e.message)); }
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

    const isDateInActiveRange = (dateStr, range) => {
        if (!range || !range.start || !range.end) return true;
        const [y, m, d] = dateStr.split('-').map(Number);
        
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
            
            current.setHours(0,0,0,0);
            start.setHours(0,0,0,0);
            end.setHours(0,0,0,0);

            if (start > end) {
                return current >= start || current <= end;
            } else {
                return current >= start && current <= end;
            }
        } catch (e) { return true; } 
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
        for(let d=1; d<=getDaysInMonth(year, month); d++) {
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const isSpecial = config.special_dates.includes(dateStr);
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
                {user.role === 'admin' && tab === 'schedule' && (
                    <div style={{display:'flex', gap:10}}>
                        <button onClick={()=>setClearModal(true)} style={{background:'#F44336'}}>🗑 Καθαρισμός</button>
                        <button onClick={()=>setSchedulerModal(true)} style={{background:'#FF9800'}}>🔄 Auto-Schedule</button>
                        <button onClick={generateServicePDF}>📄 Εξαγωγή PDF</button>
                    </div>
                )}
            </div>}
            {user.role === 'admin' ? (<div className="tabs"><button className={tab==='schedule'?'active':''} onClick={()=>setTab('schedule')}>Πρόγραμμα</button><button className={tab==='duties'?'active':''} onClick={()=>setTab('duties')}>Τύποι Υπηρεσίας</button><button className={tab==='assign'?'active':''} onClick={()=>setTab('assign')}>Αναθέσεις</button><button className={tab==='special'?'active':''} onClick={()=>setTab('special')}>Ειδικές Ημερομηνίες</button><button className={tab==='balance'?'active':''} onClick={()=>setTab('balance')}>Ισοζύγιο Υπηρεσιών</button></div>) : (<div className="tabs"><button className={tab==='myschedule'?'active':''} onClick={()=>setTab('myschedule')}>Πρόγραμμα</button><button className={tab==='declare'?'active':''} onClick={()=>setTab('declare')}>Δηλώσεις</button></div>)}

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
            
            {tab === 'balance' && user.role === 'admin' && (
                <div className="admin-section">
                    <h3>Ισοζύγιο Υπηρεσιών</h3>
                    <table><thead><tr><th>Υπάλληλος</th><th>Σύνολο Βαρδιών</th>
                        {/* Weekly Duties Columns */}
                        {config.duties.filter(d => d.is_weekly).map(d => <th key={d.id}>{d.name}</th>)}
                        {/* Off-Balance Duties Columns */}
                        {config.duties.filter(d => d.is_off_balance && !d.is_weekly).map(d => <th key={d.id}>{d.name}</th>)}
                    </tr></thead><tbody>
                        {balanceStats.map(s => (
                            <tr key={s.name}>
                                <td>{s.name}</td>
                                <td>{s.total} {s.total !== s.effective_total ? `(${s.effective_total})` : ''}</td>
                                {/* Weekly Counts */}
                                {config.duties.filter(d => d.is_weekly).map(d => {
                                    const actual = s.duty_counts?.[d.id] || 0;
                                    const effective = s.effective_duty_counts?.[d.id] ?? actual;
                                    return <td key={d.id}>{actual} {actual !== effective ? `(${effective})` : ''}</td>
                                })}
                                {/* Off-Balance Counts */}
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

            {tab === 'duties' && user.role === 'admin' && (<div className="admin-section"><div className="split-panel"><div style={{flex:1}}><h4>{dutyEditMode ? 'Επεξεργασία' : 'Νέα'} Υπηρεσία</h4><div className="form-grid"><label>Όνομα<input value={dutyForm.name||''} onChange={e=>setDutyForm({...dutyForm, name:e.target.value})}/></label><label>Βάρδιες ανά ημέρα<input type="number" min="1" value={dutyForm.shifts_per_day||1} onChange={e=>handleShiftCountChange(e.target.value)}/></label><div style={{display:'flex', gap:10, gridColumn:'1/-1'}}><label><input type="checkbox" checked={dutyForm.is_special||false} onChange={e=>setDutyForm({...dutyForm, is_special:e.target.checked})}/> Ειδική Υπηρεσία</label><label><input type="checkbox" checked={dutyForm.is_weekly||false} onChange={e=>setDutyForm({...dutyForm, is_weekly:e.target.checked})}/> Εβδομαδιαία</label><label><input type="checkbox" checked={dutyForm.is_off_balance||false} onChange={e=>setDutyForm({...dutyForm, is_off_balance:e.target.checked})}/> Εκτός Ισοζυγίου</label></div>
            
            {/* WEEKLY ACTIVE RANGE */}
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
                    <div style={{display:'flex', gap:5, alignItems:'center'}}>Shift {i+1}: <input value={h} onChange={e=>handleHourChange(i, e.target.value)} style={{width:100}} placeholder="Hours"/><label title="Night"><input type="checkbox" checked={dutyForm.shift_config?.[i]?.is_night} onChange={()=>handleFlagChange(i, 'is_night')}/> 🌙</label><label title="Within Hours"><input type="checkbox" checked={dutyForm.shift_config?.[i]?.is_within_hours} onChange={()=>handleFlagChange(i, 'is_within_hours')}/> 💼</label></div>
                    {/* SHIFT ACTIVE RANGE */}
                    <div style={{display:'flex', gap:5, marginTop:5, fontSize:'0.9rem'}}>
                        <span>Active (DD-MM):</span>
                        <input placeholder="Start" value={dutyForm.shift_config?.[i]?.active_range?.start || ''} onChange={e=>handleShiftRangeChange(i, 'start', e.target.value)} style={{width:60}}/>
                        <input placeholder="End" value={dutyForm.shift_config?.[i]?.active_range?.end || ''} onChange={e=>handleShiftRangeChange(i, 'end', e.target.value)} style={{width:60}}/>
                    </div>
                </div>
            ))}</div><button onClick={saveDuty} style={{marginTop:10}}>Αποθήκευση</button>{dutyEditMode && <button className="secondary" onClick={()=>{setDutyForm({}); setDutyEditMode(null)}}>Ακύρωση</button>}</div><div style={{flex:1, borderLeft:'1px solid #ccc', paddingLeft:20}}><h4>Υπάρχουσες Υπηρεσίες</h4><ul>{config.duties.map(d => (<li key={d.id} style={{marginBottom:10, display:'flex', justifyContent:'space-between'}}><span><b>{d.name}</b> {d.is_special && '(Ειδ)'} {d.is_weekly && '(Εβδ)'} {d.is_off_balance && '(Off)'}</span><span><button className="small-btn" onClick={()=>{setDutyForm(d); setDutyEditMode(true)}}>Edit</button><button className="small-btn danger" onClick={()=>deleteDuty(d.id)}>Del</button></span></li>))}</ul></div></div></div>)}
            {tab === 'assign' && user.role === 'admin' && (<div className="admin-section"><h3>Εξαιρέσεις & Πλεονεκτήματα (Ανά Βάρδια)</h3><p>Ορίστε εξαιρέσεις και πλεονεκτήματα για κάθε βάρδια ξεχωριστά.</p>
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
            {tab === 'special' && user.role === 'admin' && (<div className="admin-section"><h3>Διαχείριση Ειδικών Ημερομηιών</h3><input type="date" onChange={e=>toggleSpecial(e.target.value)} /><div style={{marginTop:20, display:'flex', flexWrap:'wrap', gap:10}}>{config.special_dates.sort().map(d => (<span key={d} className="tag" onClick={()=>toggleSpecial(d)} style={{cursor:'pointer'}}>{d} ✕</span>))}</div></div>)}
            
            {modal && <div className="modal-overlay"><div className="modal-content"><h3>Βάρδιες: {formatDate(modal.date)}</h3>
                {config.duties.filter(d => !d.is_special).map(d => (<div key={d.id} style={{marginBottom:15, borderBottom:'1px solid #eee', paddingBottom:10}}><h4>{d.name}</h4>{Array.from({length: d.shifts_per_day}).map((_, idx) => {const assign = schedule.find(s => s.date === modal.date && s.duty_id === d.id && s.shift_index === idx);return (<div key={idx} style={{display:'flex', gap:10, marginBottom:5, alignItems:'center'}}><span>Βάρδια {idx+1} ({d.default_hours[idx]}):</span><select value={assign?.employee_id || ''} onChange={(e) => assignEmployee(modal.date, d.id, idx, parseInt(e.target.value))}><option value="">-- Ανάθεση --</option>{employees.filter(e => !d.shift_config[idx]?.excluded_ids?.includes(e.id)).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>);})}</div>))}
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

            {/* NEW: CLEAR MODAL WITH DATE PICKER */}
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

// ================= 4. MAIN APP =================
const App = () => {
    const [page, setPage] = useState('welcome'); 
    const [user, setUser] = useState(null);
    const [activeApp, setActiveApp] = useState(null);
    const handleLogin = (u) => { setUser(u); setPage('portal'); };
    const handleAppLaunch = (appName) => { setActiveApp(appName); setPage('app_view'); };
    if (page === 'welcome') return <WelcomePage onNavigate={setPage} />;
    if (page === 'login') return <Login onLogin={handleLogin} onBack={() => setPage('welcome')} />;
    if (page === 'announcements') return <AnnouncementsPage onNavigate={setPage} />;
    if (page === 'portal') return <ServicePortal user={user} onNavigate={handleAppLaunch} onLogout={() => { setUser(null); setPage('welcome'); }} />;
    if (page === 'app_view') {
        if (activeApp === 'fuel_app') return <FuelApp user={user} onExit={() => setPage('portal')} />;
        if (activeApp === 'personnel_app') return <PersonnelApp user={user} onExit={() => setPage('portal')} />;
        if (activeApp === 'services_app') return <ServicesApp user={user} onExit={() => setPage('portal')} />;
        if (activeApp === 'announcements_app') return <AnnouncementsApp user={user} onExit={() => setPage('portal')} />;
        if (activeApp === 'accounts_app') return <AccountManager user={user} onExit={() => setPage('portal')} />;
    }
    return null;
};

export default App;