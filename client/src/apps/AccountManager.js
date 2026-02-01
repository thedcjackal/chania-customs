import React, { useState, useEffect } from 'react';
import api from '../api/axios';
import { API_URL } from '../config';
import { 
    Check, X, Trash2, Edit2, Plus, 
    FileText, Calendar, Megaphone, Users, Phone, Search 
} from 'lucide-react';

const AVAILABLE_APPS = [
    { id: 'fuel', label: 'Προγ. Εφοδιασμού', icon: <FileText size={18}/> },
    { id: 'services', label: 'Υπηρεσίες & Βάρδιες', icon: <Calendar size={18}/> },
    { id: 'announcements', label: 'Διαχ. Ανακοινώσεων', icon: <Megaphone size={18}/> },
    { id: 'accounts', label: 'Διαχ. Λογαριασμών', icon: <Users size={18}/> },
    { id: 'directory', label: 'Τηλεφωνικός Κατ.', icon: <Phone size={18}/> }
];

export const AccountManager = ({ onExit }) => {
    const [users, setUsers] = useState([]);
    const [editingUser, setEditingUser] = useState(null);
    const [formData, setFormData] = useState({ username: '', password: '', role: 'user', name: '', surname: '', company: '', vessels: [], allowed_apps: [] });
    const [vesselInput, setVesselInput] = useState('');
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => { fetchUsers(); }, []);

    const fetchUsers = async () => {
        try {
            const res = await api.get(`${API_URL}/admin/users`);
            setUsers(res.data);
        } catch (e) { console.error(e); }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (editingUser) {
                await api.put(`${API_URL}/admin/users`, { ...formData, id: editingUser.id });
            } else {
                await api.post(`${API_URL}/admin/users`, formData);
            }
            setEditingUser(null);
            resetForm();
            fetchUsers();
        } catch { alert('Σφάλμα αποθήκευσης.'); }
    };

    const handleDelete = async (id) => {
        if (window.confirm('Διαγραφή χρήστη;')) {
            await api.delete(`${API_URL}/admin/users?id=${id}`);
            fetchUsers();
        }
    };

    const resetForm = () => {
        setFormData({ username: '', password: '', role: 'user', name: '', surname: '', company: '', vessels: [], allowed_apps: [] });
        setVesselInput('');
    };

    const handleEdit = (u) => {
        setEditingUser(u);
        setFormData({ ...u, password: u.password, vessels: u.vessels || [], allowed_apps: u.allowed_apps || [] });
    };

    const toggleApp = (appId) => {
        const current = formData.allowed_apps;
        if (current.includes(appId)) {
            setFormData({ ...formData, allowed_apps: current.filter(id => id !== appId) });
        } else {
            setFormData({ ...formData, allowed_apps: [...current, appId] });
        }
    };

    const addVessel = () => {
        if (vesselInput && !formData.vessels.includes(vesselInput)) {
            setFormData({ ...formData, vessels: [...formData.vessels, vesselInput] });
            setVesselInput('');
        }
    };

    // Filter Logic
    const filteredUsers = users.filter(u => {
        const s = searchTerm.toLowerCase();
        return (
            (u.username || '').toLowerCase().includes(s) ||
            (u.name || '').toLowerCase().includes(s) ||
            (u.surname || '').toLowerCase().includes(s) ||
            (u.company || '').toLowerCase().includes(s) ||
            (u.role || '').toLowerCase().includes(s)
        );
    });

    return (
        <div style={{ padding: '40px', maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 20 }}>
                {/* Dark Grey Back Button */}
                <button onClick={onExit} style={{ background: '#444', color: 'white', border: 'none', padding: '10px 20px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>← Πίσω</button>
                <h2 style={{ color: '#002F6C', margin: 0 }}>Διαχείριση Λογαριασμών</h2>
            </div>

            <form onSubmit={handleSubmit} style={{ background: 'white', padding: 30, borderRadius: 12, boxShadow: '0 4px 15px rgba(0,0,0,0.05)', marginBottom: 40 }}>
                <h3 style={{ marginTop: 0, borderBottom:'1px solid #eee', paddingBottom:10 }}>{editingUser ? 'Επεξεργασία' : 'Νέος Χρήστης'}</h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                    <input value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} placeholder="Username" required style={inpStyle} />
                    <input value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} placeholder="Password" required style={inpStyle} />
                    <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Όνομα" style={inpStyle} />
                    <input value={formData.surname} onChange={e => setFormData({...formData, surname: e.target.value})} placeholder="Επίθετο" style={inpStyle} />
                    
                    <select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} style={inpStyle}>
                        <option value="user">Χρήστης (Πράκτορας)</option>
                        <option value="staff">Προσωπικό (Τελωνειακός)</option>
                        <option value="admin">Διαχειριστής</option>
                    </select>
                    
                    {formData.role === 'user' && (
                        <input value={formData.company} onChange={e => setFormData({...formData, company: e.target.value})} placeholder="Εταιρεία" style={inpStyle} />
                    )}
                </div>

                {formData.role === 'user' && (
                    <div style={{ marginTop: 20 }}>
                        <label>Σκάφη (Προαιρετικό)</label>
                        <div style={{ display: 'flex', gap: 10, marginTop: 5 }}>
                            <input value={vesselInput} onChange={e => setVesselInput(e.target.value)} placeholder="Όνομα Σκάφους" style={{ ...inpStyle, flex: 1 }} />
                            <button type="button" onClick={addVessel} style={{ background: '#2196F3', color: 'white', border: 'none', borderRadius: 6, padding: '0 15px' }}><Plus/></button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
                            {formData.vessels.map(v => (
                                <span key={v} style={{ background: '#e3f2fd', padding: '4px 10px', borderRadius: 15, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 5 }}>
                                    {v} <X size={14} style={{ cursor: 'pointer' }} onClick={() => setFormData({...formData, vessels: formData.vessels.filter(x => x !== v)})} />
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                <div style={{ marginTop: 20 }}>
                    <label style={{ fontWeight: 600, display: 'block', marginBottom: 10 }}>Επιτρεπόμενες Εφαρμογές</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                        {AVAILABLE_APPS.map(app => (
                            <div key={app.id} onClick={() => toggleApp(app.id)} style={{
                                padding: 12, borderRadius: 8, border: formData.allowed_apps.includes(app.id) ? '1px solid #4caf50' : '1px solid #eee',
                                background: formData.allowed_apps.includes(app.id) ? '#e8f5e9' : 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10
                            }}>
                                {formData.allowed_apps.includes(app.id) ? <Check size={18} color="green"/> : <div style={{width:18}}/>}
                                <div style={{color:'#555'}}>{app.icon}</div>
                                <span style={{ fontSize: '0.95rem', fontWeight:500 }}>{app.label}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ marginTop: 30, display: 'flex', gap: 10 }}>
                    <button type="submit" style={{ ...btnStyle, background: '#002F6C' }}>{editingUser ? 'Ενημέρωση' : 'Δημιουργία'}</button>
                    {editingUser && <button type="button" onClick={resetForm} style={{ ...btnStyle, background: '#757575' }}>Ακύρωση</button>}
                </div>
            </form>

            {/* SEARCH BAR */}
            <div style={{ marginBottom: 15, position: 'relative' }}>
                <Search size={20} style={{ position: 'absolute', left: 12, top: 12, color: '#999' }} />
                <input 
                    placeholder="Αναζήτηση χρηστών..." 
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    style={{ width: '100%', padding: '12px 12px 12px 45px', borderRadius: 8, border: '1px solid #ddd', fontSize: '1rem', boxSizing: 'border-box' }}
                />
            </div>

            <div style={{ display: 'grid', gap: 15 }}>
                {filteredUsers.map(u => (
                    <div key={u.id} style={{ background: 'white', padding: 20, borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
                        <div>
                            <div style={{ fontWeight: 'bold', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                                {u.username} 
                                <span style={{ fontSize: '0.8rem', padding: '2px 8px', borderRadius: 4, background: u.role === 'admin' ? '#ffebee' : u.role === 'staff' ? '#e3f2fd' : '#f1f8e9', color: '#555' }}>
                                    {u.role.toUpperCase()}
                                </span>
                            </div>
                            <div style={{ color: '#666', fontSize: '0.9rem', marginTop: 5 }}>
                                {u.name} {u.surname} {u.company ? `• ${u.company}` : ''}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => handleEdit(u)} style={{ background: '#e3f2fd', color: '#1565c0', border: 'none', padding: 8, borderRadius: 6, cursor: 'pointer' }}><Edit2 size={18}/></button>
                            <button onClick={() => handleDelete(u.id)} style={{ background: '#ffebee', color: '#c62828', border: 'none', padding: 8, borderRadius: 6, cursor: 'pointer' }}><Trash2 size={18}/></button>
                        </div>
                    </div>
                ))}
                {filteredUsers.length === 0 && <div style={{textAlign:'center', color:'#999'}}>Δεν βρέθηκαν αποτελέσματα.</div>}
            </div>
        </div>
    );
};

const inpStyle = { padding: 12, borderRadius: 6, border: '1px solid #ddd', fontSize: '1rem' };
const btnStyle = { padding: '12px 25px', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '1rem', fontWeight: 600 };