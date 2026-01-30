import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { Plus, Trash2, Edit2, Save, X, ChevronUp, ChevronDown } from 'lucide-react';
import { SupervisorIcon } from '../App'; 

export const DirectoryApp = ({ onExit }) => {
    const [directory, setDirectory] = useState([]);
    const [selectedDept, setSelectedDept] = useState(null);
    const [loading, setLoading] = useState(true);

    const [deptForm, setDeptForm] = useState({ id: null, name: '' });
    const [phoneForm, setPhoneForm] = useState({ number: '', is_supervisor: false });
    const [editingPhone, setEditingPhone] = useState(null);

    useEffect(() => {
        fetchDirectory();
    }, []);

    const fetchDirectory = async () => {
        try {
            const res = await axios.get(`${API_URL}/directory`);
            setDirectory(res.data);
            if (selectedDept) {
                const updated = res.data.find(d => d.id === selectedDept.id);
                setSelectedDept(updated || null);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const saveDepartment = async () => {
        if (!deptForm.name) return;
        if (deptForm.id) {
            await axios.put(`${API_URL}/directory/departments`, { id: deptForm.id, name: deptForm.name });
        } else {
            await axios.post(`${API_URL}/directory/departments`, { name: deptForm.name });
        }
        setDeptForm({ id: null, name: '' });
        fetchDirectory();
    };

    const editDeptStart = (dept) => { setDeptForm({ id: dept.id, name: dept.name }); };
    const cancelDeptEdit = () => { setDeptForm({ id: null, name: '' }); };

    const deleteDepartment = async (id) => {
        if (!window.confirm("Διαγραφή τμήματος και όλων των επαφών του;")) return;
        await axios.delete(`${API_URL}/directory/departments?id=${id}`);
        if (selectedDept?.id === id) setSelectedDept(null);
        fetchDirectory();
    };

    const moveDept = async (index, direction) => {
        const newDirectory = [...directory];
        if (direction === 'up' && index > 0) {
            [newDirectory[index], newDirectory[index - 1]] = [newDirectory[index - 1], newDirectory[index]];
        } else if (direction === 'down' && index < newDirectory.length - 1) {
            [newDirectory[index], newDirectory[index + 1]] = [newDirectory[index + 1], newDirectory[index]];
        } else { return; }
        
        setDirectory(newDirectory);
        const orderedIds = newDirectory.map(d => d.id);
        await axios.post(`${API_URL}/directory/departments`, { action: 'reorder', ordered_ids: orderedIds });
    };

    const savePhone = async () => {
        if (!phoneForm.number || !selectedDept) return;
        if (editingPhone) {
            await axios.put(`${API_URL}/directory/phones`, { ...phoneForm, id: editingPhone.id });
        } else {
            await axios.post(`${API_URL}/directory/phones`, { ...phoneForm, dept_id: selectedDept.id });
        }
        setPhoneForm({ number: '', is_supervisor: false });
        setEditingPhone(null);
        fetchDirectory();
    };

    const deletePhone = async (id) => {
        if (!window.confirm("Διαγραφή επαφής;")) return;
        await axios.delete(`${API_URL}/directory/phones?id=${id}`);
        fetchDirectory();
    };

    const startEditPhone = (phone) => {
        setPhoneForm({ number: phone.number, is_supervisor: phone.is_supervisor });
        setEditingPhone(phone);
    };

    return (
        <div style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
                <h2 style={{ color: '#002F6C', margin: 0 }}>Διαχείριση Τηλεφωνικού Καταλόγου</h2>
                {/* Styled EXACTLY like the Welcome Page Login Button */}
                <button 
                    onClick={onExit} 
                    style={{ 
                        background: '#002F6C', 
                        color: 'white', 
                        padding: '12px 30px', 
                        borderRadius: '30px', 
                        fontWeight: '600', 
                        border: 'none', 
                        cursor: 'pointer',
                        fontSize: '1rem',
                        boxShadow: '0 4px 15px rgba(0,47,108,0.2)',
                        transition: 'transform 0.2s',
                        letterSpacing: '0.5px'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                    Επιστροφή
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 40 }}>
                
                {/* LEFT: DEPARTMENTS LIST */}
                <div style={{ background: 'white', padding: 20, borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,0.05)', height: 'fit-content' }}>
                    <h3 style={{ marginTop: 0, color: '#444' }}>Τμήματα</h3>
                    
                    <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                        <input 
                            placeholder="Όνομα Τμήματος..." 
                            value={deptForm.name} 
                            onChange={e => setDeptForm({...deptForm, name: e.target.value})}
                            style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #ddd' }}
                        />
                        <button onClick={saveDepartment} style={{ background: deptForm.id ? '#4caf50' : '#002F6C', color: 'white', border: 'none', borderRadius: 6, padding: '0 12px', cursor: 'pointer' }}>
                            {deptForm.id ? <Save size={18}/> : <Plus size={18}/>}
                        </button>
                        {deptForm.id && (
                             <button onClick={cancelDeptEdit} style={{ background: '#9e9e9e', color: 'white', border: 'none', borderRadius: 6, padding: '0 12px', cursor: 'pointer' }}>
                                <X size={18}/>
                            </button>
                        )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {directory.map((dept, index) => (
                            <div 
                                key={dept.id} 
                                onClick={() => setSelectedDept(dept)}
                                style={{ 
                                    padding: '12px', 
                                    background: selectedDept?.id === dept.id ? '#e3f2fd' : '#f9f9f9', 
                                    borderRadius: 8, 
                                    cursor: 'pointer',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    border: selectedDept?.id === dept.id ? '1px solid #2196F3' : '1px solid transparent'
                                }}
                            >
                                <span style={{ fontWeight: 500 }}>{dept.name}</span>
                                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', marginRight: 5 }}>
                                        <button onClick={(e) => { e.stopPropagation(); moveDept(index, 'up'); }} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, opacity: index === 0 ? 0.3 : 1 }}><ChevronUp size={14}/></button>
                                        <button onClick={(e) => { e.stopPropagation(); moveDept(index, 'down'); }} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, opacity: index === directory.length -1 ? 0.3 : 1 }}><ChevronDown size={14}/></button>
                                    </div>
                                    <button onClick={(e) => { e.stopPropagation(); editDeptStart(dept); }} style={{ background: 'none', border: 'none', color: '#1565c0', cursor: 'pointer' }}><Edit2 size={16}/></button>
                                    <button onClick={(e) => { e.stopPropagation(); deleteDepartment(dept.id); }} style={{ background: 'none', border: 'none', color: '#d32f2f', cursor: 'pointer', opacity: 0.6 }}><Trash2 size={16}/></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* RIGHT: PHONES MANAGEMENT */}
                <div style={{ background: 'white', padding: 20, borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
                    {selectedDept ? (
                        <>
                            <h3 style={{ marginTop: 0, color: '#002F6C', borderBottom: '1px solid #eee', paddingBottom: 10 }}>
                                Επαφές: {selectedDept.name}
                            </h3>

                            <div style={{ background: '#f8f9fa', padding: 15, borderRadius: 8, marginBottom: 20 }}>
                                <h4 style={{ margin: '0 0 10px 0', color: '#666' }}>{editingPhone ? 'Επεξεργασία' : 'Προσθήκη Επαφής'}</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
                                    <input 
                                        placeholder="Αριθμός Τηλεφώνου" 
                                        value={phoneForm.number}
                                        onChange={e => setPhoneForm({...phoneForm, number: e.target.value})}
                                        style={{ padding: 10, borderRadius: 6, border: '1px solid #ddd' }}
                                    />
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'white', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }}>
                                        <input 
                                            type="checkbox" 
                                            checked={phoneForm.is_supervisor} 
                                            onChange={e => setPhoneForm({...phoneForm, is_supervisor: e.target.checked})}
                                            id="supCheck"
                                        />
                                        <label htmlFor="supCheck" style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 5 }}>
                                            <SupervisorIcon /> Προϊστάμενος
                                        </label>
                                    </div>
                                </div>
                                <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
                                    <button onClick={savePhone} style={{ background: '#4caf50', color: 'white', border: 'none', padding: '8px 15px', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <Save size={16} /> Αποθήκευση
                                    </button>
                                    {editingPhone && (
                                        <button onClick={() => { setEditingPhone(null); setPhoneForm({ number:'', is_supervisor: false }); }} style={{ background: '#9e9e9e', color: 'white', border: 'none', padding: '8px 15px', borderRadius: 6, cursor: 'pointer' }}>
                                            Ακύρωση
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {selectedDept.phones && selectedDept.phones.length > 0 ? (
                                    selectedDept.phones.map(phone => (
                                        <div key={phone.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px', borderBottom: '1px solid #eee' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                {phone.is_supervisor && <SupervisorIcon />}
                                                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#333', fontFamily: 'monospace' }}>{phone.number}</div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 5 }}>
                                                <button onClick={() => startEditPhone(phone)} style={{ background: '#e3f2fd', border: 'none', padding: 6, borderRadius: 4, color: '#1565c0', cursor: 'pointer' }}><Edit2 size={16}/></button>
                                                <button onClick={() => deletePhone(phone.id)} style={{ background: '#ffebee', border: 'none', padding: 6, borderRadius: 4, color: '#c62828', cursor: 'pointer' }}><Trash2 size={16}/></button>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div style={{ color: '#888', textAlign: 'center', padding: 20 }}>Κανένα τηλέφωνο καταχωρημένο.</div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
                            Επιλέξτε ένα τμήμα από αριστερά για διαχείριση.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};