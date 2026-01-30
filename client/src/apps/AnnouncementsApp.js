import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { Trash2, Send, CheckCircle, Edit2, X } from 'lucide-react'; // REMOVED AlertTriangle

export const AnnouncementsApp = ({ user, onExit }) => {
    const [announcements, setAnnouncements] = useState([]);
    const [formData, setFormData] = useState({ text: '', body: '', is_important: false });
    const [successMsg, setSuccessMsg] = useState('');
    const [editId, setEditId] = useState(null);

    useEffect(() => {
        fetchAnnouncements();
    }, []);

    const fetchAnnouncements = async () => {
        const res = await axios.get(`${API_URL}/announcements`);
        setAnnouncements(res.data);
    };

    const handleEdit = (ann) => {
        setFormData({ 
            text: ann.text, 
            body: ann.body || '', 
            is_important: ann.is_important || false 
        });
        setEditId(ann.id);
        window.scrollTo(0, 0);
    };

    const handleCancelEdit = () => {
        setFormData({ text: '', body: '', is_important: false });
        setEditId(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.text) return;
        try {
            if (editId) {
                // Update
                await axios.put(`${API_URL}/announcements`, { ...formData, id: editId });
                setSuccessMsg('Η ανακοίνωση ενημερώθηκε!');
            } else {
                // Create
                await axios.post(`${API_URL}/announcements`, formData);
                setSuccessMsg('Η ανακοίνωση προστέθηκε!');
            }
            
            setFormData({ text: '', body: '', is_important: false });
            setEditId(null);
            setTimeout(() => setSuccessMsg(''), 3000);
            fetchAnnouncements();
        } catch (error) {
            alert('Σφάλμα αποθήκευσης');
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Διαγραφή ανακοίνωσης;")) return;
        await axios.delete(`${API_URL}/announcements?id=${id}`);
        fetchAnnouncements();
    };

    return (
        <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
            <button onClick={onExit} style={{ marginBottom: '20px', background: 'none', border: 'none', cursor: 'pointer', color: '#666', fontSize: '1.1rem' }}>← Πίσω</button>
            <h2 style={{ color: '#002F6C', borderBottom: '2px solid #eee', paddingBottom: '10px', marginBottom: '30px' }}>Διαχείριση Ανακοινώσεων</h2>

            <form onSubmit={handleSubmit} style={{ background: 'white', padding: '30px', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.05)', marginBottom: '40px', borderLeft: editId ? '5px solid #ff9800' : 'none' }}>
                <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#444' }}>
                    {editId ? 'Επεξεργασία Ανακοίνωσης' : 'Νέα Ανακοίνωση'}
                </h3>
                
                <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#555' }}>Τίτλος (Σύνοψη)</label>
                    <input 
                        type="text" 
                        value={formData.text} 
                        onChange={(e) => setFormData({ ...formData, text: e.target.value })} 
                        style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '1rem' }} 
                        placeholder="π.χ. Αλλαγή ωραρίου λειτουργίας..." 
                    />
                </div>

                <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#555' }}>Κυρίως Κείμενο (Προαιρετικό)</label>
                    <textarea 
                        value={formData.body} 
                        onChange={(e) => setFormData({ ...formData, body: e.target.value })} 
                        rows={5}
                        style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '1rem', fontFamily: 'inherit' }} 
                        placeholder="Λεπτομέρειες ανακοίνωσης..." 
                    />
                </div>

                <div style={{ marginBottom: '25px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input 
                        type="checkbox" 
                        id="isImp" 
                        checked={formData.is_important} 
                        onChange={(e) => setFormData({ ...formData, is_important: e.target.checked })} 
                        style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                    />
                    <label htmlFor="isImp" style={{ cursor: 'pointer', fontWeight: '500', color: formData.is_important ? '#d32f2f' : '#555' }}>
                        Σήμανση ως "Σημαντικό" ⚠️
                    </label>
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                    <button type="submit" style={{ background: '#002F6C', color: 'white', border: 'none', padding: '12px 25px', borderRadius: '8px', fontSize: '1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Send size={18} /> {editId ? 'Ενημέρωση' : 'Δημοσίευση'}
                    </button>
                    {editId && (
                        <button type="button" onClick={handleCancelEdit} style={{ background: '#e0e0e0', color: '333', border: 'none', padding: '12px 25px', borderRadius: '8px', fontSize: '1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <X size={18} /> Ακύρωση
                        </button>
                    )}
                </div>
                {successMsg && <div style={{ marginTop: '15px', color: 'green', display: 'flex', alignItems: 'center', gap: '5px' }}><CheckCircle size={18} /> {successMsg}</div>}
            </form>

            <div>
                <h3 style={{ color: '#444', marginBottom: '20px' }}>Ιστορικό</h3>
                {announcements.map((ann) => (
                    <div key={ann.id} style={{ 
                        background: 'white', 
                        padding: '20px', 
                        borderRadius: '10px', 
                        marginBottom: '15px', 
                        borderLeft: ann.is_important ? '5px solid #ff9800' : '5px solid #2196F3',
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'start',
                        boxShadow: '0 2px 5px rgba(0,0,0,0.05)'
                    }}>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.85rem', color: '#888', marginBottom: '5px' }}>{new Date(ann.date).toLocaleDateString('el-GR')}</div>
                            <div style={{ fontWeight: '600', fontSize: '1.1rem', marginBottom: '5px' }}>
                                {ann.is_important && <span style={{ color: '#f57c00', marginRight: '8px' }}>⚠️</span>}
                                {ann.text}
                            </div>
                            {ann.body && <div style={{ color: '#666', fontSize: '0.95rem', marginTop: '5px' }}>{ann.body.substring(0, 100)}{ann.body.length > 100 && '...'}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: 5 }}>
                            <button onClick={() => handleEdit(ann)} style={{ background: '#e3f2fd', color: '#1565c0', border: 'none', padding: '8px', borderRadius: '6px', cursor: 'pointer' }}>
                                <Edit2 size={18} />
                            </button>
                            <button onClick={() => handleDelete(ann.id)} style={{ background: '#ffebee', color: '#c62828', border: 'none', padding: '8px', borderRadius: '6px', cursor: 'pointer' }}>
                                <Trash2 size={18} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};