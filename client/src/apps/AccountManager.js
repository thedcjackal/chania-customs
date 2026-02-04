import React, { useState, useEffect } from 'react';
import api from '../api/axios';
import { API_URL } from '../config';
import { 
    Check, X, Trash2, Edit2, Plus, 
    FileText, Calendar, Megaphone, Users, Phone, Search,
    Briefcase, Lock, Mail, Loader2
} from 'lucide-react';

const AVAILABLE_APPS = [
    { id: 'fuel', label: 'Προγ. Εφοδιασμού', icon: <FileText size={18}/> },
    { id: 'services', label: 'Υπηρεσίες & Βάρδιες', icon: <Calendar size={18}/> },
    { id: 'announcements', label: 'Διαχ. Ανακοινώσεων', icon: <Megaphone size={18}/> },
    { id: 'accounts', label: 'Διαχ. Λογαριασμών', icon: <Users size={18}/> },
    { id: 'directory', label: 'Τηλεφωνικός Κατ.', icon: <Phone size={18}/> },
    { id: 'agents', label: 'Διαχ. Εκτελωνιστών', icon: <Briefcase size={18}/> }
];

export const AccountManager = ({ onExit }) => {
    const [users, setUsers] = useState([]);
    const [editingUser, setEditingUser] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false); 
    
    const [formData, setFormData] = useState({ 
        email: '', 
        password: '', 
        role: 'fuel_user', // UPDATED DEFAULT
        name: '', 
        surname: '', 
        company: '', 
        vessels: [], 
        allowed_apps: [] 
    });
    
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
        
        if (isSubmitting) return;

        setIsSubmitting(true);
        try {
            if (editingUser) {
                // EDIT MODE: Remove sensitive/immutable fields
                const { password, email, ...updateData } = formData;
                
                await api.put(`${API_URL}/admin/users`, { 
                    ...updateData, 
                    id: editingUser.id 
                });
            } else {
                // CREATE MODE: 
                // Fix: Backend requires 'username'. We map email to username.
                const payload = {
                    ...formData,
                    username: formData.email 
                };
                await api.post(`${API_URL}/admin/users`, payload);
            }
            
            setEditingUser(null);
            resetForm();
            fetchUsers();
        } catch (err) { 
            console.error(err);
            if (err.response?.status === 429) {
                alert('Πολλά αιτήματα (Rate Limit). Παρακαλώ περιμένετε λίγο.');
            } else {
                const msg = err.response?.data?.error || 'Σφάλμα αποθήκευσης. Ελέγξτε τα στοιχεία.';
                alert(msg); 
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('Διαγραφή χρήστη;')) {
            try {
                await api.delete(`${API_URL}/admin/users?id=${id}`);
                fetchUsers();
            } catch (err) {
                if (err.response?.status === 429) {
                    alert('Πολλά αιτήματα (Rate Limit). Παρακαλώ περιμένετε.');
                }
            }
        }
    };

    const resetForm = () => {
        setFormData({ 
            email: '', 
            password: '', 
            role: 'fuel_user', // UPDATED DEFAULT
            name: '', 
            surname: '', 
            company: '', 
            vessels: [], 
            allowed_apps: [] 
        });
        setVesselInput('');
        setEditingUser(null);
    };

    const handleEdit = (u) => {
        setEditingUser(u);
        setFormData({ 
            ...u, 
            email: u.email || u.username, 
            password: '', 
            vessels: u.vessels || [], 
            allowed_apps: u.allowed_apps || [] 
        });
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
        const emailOrUser = u.email || u.username || '';
        return (
            emailOrUser.toLowerCase().includes(s) ||
            (u.name || '').toLowerCase().includes(s) ||
            (u.surname || '').toLowerCase().includes(s) ||
            (u.company || '').toLowerCase().includes(s) ||
            (u.role || '').toLowerCase().includes(s)
        );
    });

    return (
        <div style={{ padding: '40px', maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 20 }}>
                <button onClick={onExit} style={{ background: '#444', color: 'white', border: 'none', padding: '10px 20px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>← Πίσω</button>
                <h2 style={{ color: '#002F6C', margin: 0 }}>Διαχείριση Λογαριασμών</h2>
            </div>

            <form onSubmit={handleSubmit} style={{ background: 'white', padding: 30, borderRadius: 12, boxShadow: '0 4px 15px rgba(0,0,0,0.05)', marginBottom: 40 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom:'1px solid #eee', paddingBottom:10, marginBottom: 20 }}>
                    <h3 style={{ margin: 0 }}>{editingUser ? 'Επεξεργασία Στοιχείων' : 'Δημιουργία Νέου Χρήστη'}</h3>
                    {editingUser && (
                        <button type="button" onClick={resetForm} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Plus size={16}/> Νέος Χρήστης
                        </button>
                    )}
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                    
                    {/* EMAIL INPUT */}
                    <div style={{ position: 'relative' }}>
                        <label style={labelStyle}>Email (Username)</label>
                        <div style={{ position: 'relative' }}>
                            <Mail size={18} style={{ position: 'absolute', left: 12, top: 14, color: '#999' }} />
                            <input 
                                type="email"
                                value={formData.email} 
                                onChange={e => setFormData({...formData, email: e.target.value})} 
                                placeholder="user@example.com" 
                                required 
                                disabled={!!editingUser} 
                                style={{ 
                                    ...inpStyle, 
                                    paddingLeft: 40,
                                    background: editingUser ? '#f5f5f5' : 'white',
                                    cursor: editingUser ? 'not-allowed' : 'text',
                                    color: editingUser ? '#666' : 'black'
                                }} 
                            />
                            {editingUser && <Lock size={16} style={{ position: 'absolute', right: 12, top: 15, color: '#999' }} />}
                        </div>
                    </div>

                    {/* PASSWORD INPUT - ONLY SHOWN WHEN CREATING */}
                    {!editingUser ? (
                        <div>
                            <label style={labelStyle}>Κωδικός Πρόσβασης</label>
                            <input 
                                type="password"
                                value={formData.password} 
                                onChange={e => setFormData({...formData, password: e.target.value})} 
                                placeholder="********" 
                                required 
                                style={inpStyle} 
                            />
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', color: '#888', fontStyle: 'italic', fontSize: '0.9rem', marginTop: 25 }}>
                            <Lock size={16} style={{ marginRight: 5 }} /> Ο κωδικός δεν είναι επεξεργάσιμος εδώ.
                        </div>
                    )}

                    <div>
                        <label style={labelStyle}>Όνομα</label>
                        <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Όνομα" style={inpStyle} />
                    </div>
                    
                    <div>
                        <label style={labelStyle}>Επίθετο</label>
                        <input value={formData.surname} onChange={e => setFormData({...formData, surname: e.target.value})} placeholder="Επίθετο" style={inpStyle} />
                    </div>
                    
                    <div>
                        <label style={labelStyle}>Ρόλος</label>
                        <select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} style={inpStyle}>
                            <option value="fuel_user">Χρήστης (Εφοδιασμοί)</option> {/* UPDATED */}
                            <option value="staff">Προσωπικό (Τελωνειακός)</option>
                            <option value="admin">Διαχειριστής</option>
                            <option value="root_admin">Root Admin</option>
                        </select>
                    </div>
                    
                    {formData.role === 'fuel_user' && ( // UPDATED CONDITION
                        <div>
                            <label style={labelStyle}>Εταιρεία</label>
                            <input value={formData.company} onChange={e => setFormData({...formData, company: e.target.value})} placeholder="Εταιρεία" style={inpStyle} />
                        </div>
                    )}
                </div>

                {formData.role === 'fuel_user' && ( // UPDATED CONDITION
                    <div style={{ marginTop: 20 }}>
                        <label style={labelStyle}>Σκάφη (Προαιρετικό)</label>
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
                    <label style={{ ...labelStyle, marginBottom: 10, display: 'block' }}>Επιτρεπόμενες Εφαρμογές</label>
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
                    <button 
                        type="submit" 
                        disabled={isSubmitting} // DISABLE BUTTON
                        style={{ 
                            ...btnStyle, 
                            background: isSubmitting ? '#ccc' : '#002F6C',
                            cursor: isSubmitting ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10
                        }}
                    >
                        {isSubmitting && <Loader2 className="animate-spin" size={20}/>}
                        {editingUser ? 'Ενημέρωση Χρήστη' : 'Δημιουργία Χρήστη'}
                    </button>
                    {editingUser && <button type="button" onClick={resetForm} disabled={isSubmitting} style={{ ...btnStyle, background: '#757575' }}>Ακύρωση</button>}
                </div>
            </form>

            {/* SEARCH BAR */}
            <div style={{ marginBottom: 15, position: 'relative' }}>
                <Search size={20} style={{ position: 'absolute', left: 12, top: 12, color: '#999' }} />
                <input 
                    placeholder="Αναζήτηση (Email, Όνομα, Εταιρεία)..." 
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
                                {u.email || u.username} 
                                <span style={{ 
                                    fontSize: '0.8rem', 
                                    padding: '2px 8px', 
                                    borderRadius: 4, 
                                    background: u.role === 'root_admin' ? '#f3e5f5' : u.role === 'admin' ? '#ffebee' : u.role === 'staff' ? '#e3f2fd' : '#f1f8e9', 
                                    color: '#555' 
                                }}>
                                    {u.role.toUpperCase().replace('_', ' ')}
                                </span>
                            </div>
                            <div style={{ color: '#666', fontSize: '0.9rem', marginTop: 5 }}>
                                {u.name} {u.surname} {u.company ? `• ${u.company}` : ''}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => handleEdit(u)} disabled={isSubmitting} style={{ background: '#e3f2fd', color: '#1565c0', border: 'none', padding: 8, borderRadius: 6, cursor: 'pointer' }}><Edit2 size={18}/></button>
                            <button onClick={() => handleDelete(u.id)} disabled={isSubmitting} style={{ background: '#ffebee', color: '#c62828', border: 'none', padding: 8, borderRadius: 6, cursor: 'pointer' }}><Trash2 size={18}/></button>
                        </div>
                    </div>
                ))}
                {filteredUsers.length === 0 && <div style={{textAlign:'center', color:'#999'}}>Δεν βρέθηκαν αποτελέσματα.</div>}
            </div>
        </div>
    );
};

const inpStyle = { padding: 12, borderRadius: 6, border: '1px solid #ddd', fontSize: '1rem', width: '100%', boxSizing: 'border-box' };
const labelStyle = { fontSize: '0.85rem', fontWeight: 600, color: '#444', marginBottom: 5, display: 'block' };
const btnStyle = { padding: '12px 25px', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '1rem', fontWeight: 600 };