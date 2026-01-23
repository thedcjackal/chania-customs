import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { AppHeader } from '../components/Layout';

export const PersonnelApp = ({ user, onExit }) => {
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