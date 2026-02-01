import React, { useState, useEffect } from 'react';
import api from '../api/axios';
import { API_URL } from '../config';

export const UserManager = () => {
    const [users, setUsers] = useState([]); 
    const [modal, setModal] = useState(null); 
    
    // Initialize form with allowed_apps as an empty array
    const [form, setForm] = useState({ 
        name: '', surname: '', username: '', password: '', 
        role: 'user', company: '', vessels: '', allowed_apps: [] 
    }); 

    // Define available apps for the checkboxes
    const availableApps = [
        { id: 'fuel', name: '⛽ Εφοδιασμοί' },
        { id: 'services', name: '📅 Υπηρεσίες' },
        { id: 'personnel', name: '👥 Προσωπικό' },
        { id: 'announcements', name: '📢 Ανακοινώσεις' },
        { id: 'accounts', name: '🔐 Λογαριασμοί' }
    ];
    
    useEffect(() => { 
        api.get(`${API_URL}/admin/users`)
            .then(res => setUsers(res.data))
            .catch(err => console.error(err));
    }, []); 

    const toggleApp = (appId) => {
        const currentApps = form.allowed_apps || [];
        if (currentApps.includes(appId)) {
            // Remove app
            setForm({ ...form, allowed_apps: currentApps.filter(id => id !== appId) });
        } else {
            // Add app
            setForm({ ...form, allowed_apps: [...currentApps, appId] });
        }
    };

    const save = async () => { 
        // Logic to split vessels string into array
        const vesselsArray = (typeof form.vessels === 'string' && form.vessels.length > 0) 
            ? form.vessels.split(',').map(v => v.trim()) 
            : (Array.isArray(form.vessels) ? form.vessels : []);

        const p = {
            ...form, 
            // We now use the actual selections from the form, no longer hardcoded
            allowed_apps: form.allowed_apps || [], 
            vessels: vesselsArray
        }; 
        
        try {
            if(modal.id) await api.put(`${API_URL}/admin/users`, p); 
            else await api.post(`${API_URL}/admin/users`, p); 
            
            setModal(null); 
            window.location.reload(); 
        } catch (e) {
            alert("Error saving user: " + (e.response?.data?.error || e.message));
        }
    }; 

    const del = async (id) => { 
        if(window.confirm("Διαγραφή;")) {
            await api.delete(`${API_URL}/admin/users?id=${id}`); 
            window.location.reload(); 
        }
    }; 

    // Helper to open modal for editing
    const openEdit = (u) => {
        setForm({
            ...u,
            // Ensure allowed_apps is an array (handle nulls from old data)
            allowed_apps: Array.isArray(u.allowed_apps) ? u.allowed_apps : [],
            // Convert vessels array back to string for the input field
            vessels: Array.isArray(u.vessels) ? u.vessels.join(', ') : u.vessels
        });
        setModal(u);
    };

    return (
        <div className="admin-section">
            <div className="control-bar">
                <button onClick={()=>{
                    // Reset form explicitly on "New User" click
                    setForm({ name: '', surname: '', username: '', password: '', role: 'user', company: '', vessels: '', allowed_apps: [] }); 
                    setModal({});
                }}>+ Νέος Χρήστης</button>
            </div>
            <table>
                <thead><tr><th>Όνομα</th><th>User</th><th>Ρόλος</th><th>Εταιρεία</th><th>Apps</th><th>Ενέργειες</th></tr></thead>
                <tbody>
                    {users.filter(u=>u.role!=='root_admin').map(u => (
                        <tr key={u.id}>
                            <td>{u.name} {u.surname}</td>
                            <td>{u.username}</td>
                            <td>{u.role}</td>
                            <td>{u.company}</td>
                            <td style={{fontSize:'0.8rem', color:'#555'}}>
                                {Array.isArray(u.allowed_apps) ? u.allowed_apps.join(', ') : ''}
                            </td>
                            <td>
                                <button className="small-btn" onClick={()=>openEdit(u)}>Edit</button>
                                <button className="small-btn danger" onClick={()=>del(u.id)}>Del</button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {modal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3>{modal.id ? 'Επεξεργασία Χρήστη' : 'Νέος Χρήστης'}</h3>
                        <div className="form-grid">
                            <label>Όνομα<input value={form.name} onChange={e=>setForm({...form, name:e.target.value})}/></label>
                            <label>Επώνυμο<input value={form.surname} onChange={e=>setForm({...form, surname:e.target.value})}/></label>
                            <label>User<input value={form.username} onChange={e=>setForm({...form, username:e.target.value})}/></label>
                            <label>Pass<input value={form.password} onChange={e=>setForm({...form, password:e.target.value})}/></label>
                            <label>Ρόλος<select value={form.role} onChange={e=>setForm({...form, role:e.target.value})}><option value="user">Χρήστης</option><option value="staff">Προσωπικό</option><option value="admin">Διαχειριστής</option></select></label>
                            <label>Εταιρεία<input value={form.company} onChange={e=>setForm({...form, company:e.target.value})}/></label>
                            <label>Σκάφη (κόμμα)<input value={form.vessels} onChange={e=>setForm({...form, vessels:e.target.value})}/></label>
                            
                            {/* APP SELECTION CHECKBOXES */}
                            <div style={{gridColumn: '1/-1', marginTop: 10, borderTop: '1px solid #eee', paddingTop: 10}}>
                                <label style={{fontWeight:'bold', display:'block', marginBottom: 5}}>Επιτρεπόμενες Εφαρμογές:</label>
                                <div style={{display:'flex', gap: 10, flexWrap: 'wrap'}}>
                                    {availableApps.map(app => (
                                        <label key={app.id} style={{
                                            display:'flex', alignItems:'center', gap: 5, 
                                            background: form.allowed_apps?.includes(app.id) ? '#e3f2fd' : '#f5f5f5', 
                                            padding: '5px 10px', borderRadius: 4, cursor: 'pointer', border: '1px solid #ccc'
                                        }}>
                                            <input 
                                                type="checkbox" 
                                                checked={form.allowed_apps?.includes(app.id) || false}
                                                onChange={() => toggleApp(app.id)}
                                            />
                                            {app.name}
                                        </label>
                                    ))}
                                </div>
                            </div>

                        </div>
                        <div style={{marginTop:20}}>
                            <button onClick={save}>Αποθήκευση</button> 
                            <button className="secondary" onClick={()=>setModal(null)}>Ακύρωση</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export const ReferenceManager = ({type, title, placeholder}) => {
    const [list, setList] = useState([]); 
    const [text, setText] = useState(''); 
    const [editMode, setEditMode] = useState(null); 
    const [editText, setEditText] = useState(''); 
    
    useEffect(() => { 
        api.get(`${API_URL}/admin/reference`)
            .then(res => setList(res.data[type] || []))
            .catch(err => console.error("Ref load error", err));
    }, [type]); 

    const add = async () => { if(text) await api.post(`${API_URL}/admin/reference`, {type, value:text}); setText(''); window.location.reload(); }; 
    const saveEdit = async () => { await api.put(`${API_URL}/admin/reference`, {type, old_value: editMode, new_value: editText}); setEditMode(null); window.location.reload(); }; 
    const del = async (val) => { if(window.confirm("Διαγραφή;")) await api.delete(`${API_URL}/admin/reference?type=${type}&value=${val}`); window.location.reload(); }; 
    
    return (
        <div className="admin-section">
            <h4>{title}</h4>
            <div className="control-bar"><input value={text} onChange={e=>setText(e.target.value)} placeholder={placeholder} style={{flex:1}}/><button onClick={add}>Προσθήκη</button></div>
            <ul>{list.map(c => (<li key={c} style={{marginBottom:10, display:'flex', justifyContent:'space-between', alignItems:'center'}}>{editMode===c?(<><input value={editText} onChange={e=>setEditText(e.target.value)} /><span><button className="small-btn" onClick={saveEdit}>OK</button><button className="small-btn secondary" onClick={()=>setEditMode(null)}>Cancel</button></span></>):(<><span>{c}</span><span><button className="small-btn" onClick={()=>{setEditMode(c); setEditText(c)}}>Edit</button><button className="small-btn danger" onClick={()=>del(c)}>Del</button></span></>)}</li>))}</ul>
        </div>
    );
};

export const AnnouncementManager = () => {
    const [list, setList] = useState([]); 
    const [text, setText] = useState(''); 
    
    const load = () => api.get(`${API_URL}/announcements`).then(res => setList(res.data)); 
    useEffect(() => { load(); }, []); 
    
    const add = async () => { if(text) await api.post(`${API_URL}/announcements`, {text}); setText(''); load(); }; 
    const del = async (id) => { await api.delete(`${API_URL}/announcements?id=${id}`); load(); }; 
    
    return (
        <div className="admin-section">
            <div className="control-bar"><input value={text} onChange={e=>setText(e.target.value)} placeholder="Νέα Ανακοίνωση..." style={{flex:1}}/><button onClick={add}>Δημοσίευση</button></div>
            <ul>{list.map(a => <li key={a.id} style={{marginBottom:10, display:'flex', justifyContent:'space-between'}}>{a.text} <button className="small-btn danger" onClick={()=>del(a.id)}>X</button></li>)}</ul>
        </div>
    );
};