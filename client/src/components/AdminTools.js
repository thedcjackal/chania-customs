import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

export const UserManager = () => {
    const [users, setUsers] = useState([]); 
    const [modal, setModal] = useState(null); 
    // FIX: Initialize with safe defaults so backend receives strings, not undefined
    const [form, setForm] = useState({ 
        name: '', surname: '', username: '', password: '', 
        role: 'user', company: '', vessels: '' 
    }); 
    
    useEffect(() => { 
        axios.get(`${API_URL}/admin/users`)
            .then(res => setUsers(res.data))
            .catch(err => console.error(err));
    }, []); 

    const save = async () => { 
        // Logic to split vessels string into array
        const vesselsArray = (typeof form.vessels === 'string' && form.vessels.length > 0) 
            ? form.vessels.split(',').map(v => v.trim()) 
            : (Array.isArray(form.vessels) ? form.vessels : []);

        const p = {
            ...form, 
            allowed_apps: ['fuel'], // Default permission
            vessels: vesselsArray
        }; 
        
        try {
            if(modal.id) await axios.put(`${API_URL}/admin/users`, p); 
            else await axios.post(`${API_URL}/admin/users`, p); 
            
            setModal(null); 
            window.location.reload(); 
        } catch (e) {
            alert("Error saving user: " + (e.response?.data?.error || e.message));
        }
    }; 

    const del = async (id) => { 
        if(window.confirm("Διαγραφή;")) {
            await axios.delete(`${API_URL}/admin/users?id=${id}`); 
            window.location.reload(); 
        }
    }; 

    return (
        <div className="admin-section">
            <div className="control-bar">
                <button onClick={()=>{
                    // FIX: Reset form explicitly on "New User" click
                    setForm({ name: '', surname: '', username: '', password: '', role: 'user', company: '', vessels: '' }); 
                    setModal({});
                }}>+ Νέος Χρήστης</button>
            </div>
            <table>
                <thead><tr><th>Όνομα</th><th>User</th><th>Ρόλος</th><th>Εταιρεία</th><th>Ενέργειες</th></tr></thead>
                <tbody>
                    {users.filter(u=>u.role!=='root_admin').map(u => (
                        <tr key={u.id}>
                            <td>{u.name} {u.surname}</td>
                            <td>{u.username}</td>
                            <td>{u.role}</td>
                            <td>{u.company}</td>
                            <td><button className="small-btn" onClick={()=>{setForm(u); setModal(u);}}>Edit</button><button className="small-btn danger" onClick={()=>del(u.id)}>Del</button></td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {modal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3>Χρήστης</h3>
                        <div className="form-grid">
                            <label>Όνομα<input value={form.name} onChange={e=>setForm({...form, name:e.target.value})}/></label>
                            <label>Επώνυμο<input value={form.surname} onChange={e=>setForm({...form, surname:e.target.value})}/></label>
                            <label>User<input value={form.username} onChange={e=>setForm({...form, username:e.target.value})}/></label>
                            <label>Pass<input value={form.password} onChange={e=>setForm({...form, password:e.target.value})}/></label>
                            <label>Ρόλος<select value={form.role} onChange={e=>setForm({...form, role:e.target.value})}><option value="user">Χρήστης</option><option value="staff">Προσωπικό</option><option value="admin">Διαχειριστής</option></select></label>
                            <label>Εταιρεία<input value={form.company} onChange={e=>setForm({...form, company:e.target.value})}/></label>
                            <label>Σκάφη (κόμμα)<input value={form.vessels} onChange={e=>setForm({...form, vessels:e.target.value})}/></label>
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
        axios.get(`${API_URL}/admin/reference`)
            .then(res => setList(res.data[type] || []))
            .catch(err => console.error("Ref load error", err));
    }, [type]); 

    const add = async () => { if(text) await axios.post(`${API_URL}/admin/reference`, {type, value:text}); setText(''); window.location.reload(); }; 
    const saveEdit = async () => { await axios.put(`${API_URL}/admin/reference`, {type, old_value: editMode, new_value: editText}); setEditMode(null); window.location.reload(); }; 
    const del = async (val) => { if(window.confirm("Διαγραφή;")) await axios.delete(`${API_URL}/admin/reference?type=${type}&value=${val}`); window.location.reload(); }; 
    
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
    
    const load = () => axios.get(`${API_URL}/announcements`).then(res => setList(res.data)); 
    useEffect(() => { load(); }, []); 
    
    const add = async () => { if(text) await axios.post(`${API_URL}/announcements`, {text}); setText(''); load(); }; 
    const del = async (id) => { await axios.delete(`${API_URL}/announcements?id=${id}`); load(); }; 
    
    return (
        <div className="admin-section">
            <div className="control-bar"><input value={text} onChange={e=>setText(e.target.value)} placeholder="Νέα Ανακοίνωση..." style={{flex:1}}/><button onClick={add}>Δημοσίευση</button></div>
            <ul>{list.map(a => <li key={a.id} style={{marginBottom:10, display:'flex', justifyContent:'space-between'}}>{a.text} <button className="small-btn danger" onClick={()=>del(a.id)}>X</button></li>)}</ul>
        </div>
    );
};