import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase'; 
import { Plus, Trash2, Edit2, Save, X, Search, Briefcase, Loader2, Phone, Mail, MapPin } from 'lucide-react';

const AgentsApp = ({ onExit }) => {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [currentAgent, setCurrentAgent] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [formData, setFormData] = useState({
    name: '',
    surname: '',
    company: '',
    phone: '',
    email: '',
    address: ''
  });

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('customs_agents').select('*').order('surname', { ascending: true });
      if (error) throw error;
      setAgents(data);
    } catch (error) {
      console.error('Error fetching agents:', error.message);
      alert('Σφάλμα κατά τη φόρτωση των δεδομένων.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (currentAgent) {
        const { error } = await supabase.from('customs_agents').update(formData).eq('id', currentAgent.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('customs_agents').insert([formData]);
        if (error) throw error;
      }
      await fetchAgents();
      resetForm();
    } catch (error) {
      console.error('Error saving agent:', error.message);
      if (error.code === '42501') alert('Δεν έχετε δικαίωμα επεξεργασίας (Απαιτείται ρόλος Admin).');
      else alert('Σφάλμα κατά την αποθήκευση.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Είστε σίγουροι ότι θέλετε να διαγράψετε αυτόν τον εκτελωνιστή;')) {
      try {
        const { error } = await supabase.from('customs_agents').delete().eq('id', id);
        if (error) throw error;
        setAgents(agents.filter(agent => agent.id !== id));
      } catch (error) {
        console.error('Error deleting agent:', error.message);
        if (error.code === '42501') alert('Δεν έχετε δικαίωμα διαγραφής (Απαιτείται ρόλος Admin).');
        else alert('Σφάλμα κατά τη διαγραφή.');
      }
    }
  };

  const handleEdit = (agent) => {
    setFormData({
      name: agent.name,
      surname: agent.surname,
      company: agent.company || '',
      phone: agent.phone || '',
      email: agent.email || '',
      address: agent.address || ''
    });
    setCurrentAgent(agent);
    setIsEditing(true);
  };

  const resetForm = () => {
    setFormData({ name: '', surname: '', company: '', phone: '', email: '', address: '' });
    setIsEditing(false);
    setCurrentAgent(null);
  };

  const filteredAgents = agents.filter(agent => 
    (agent.surname || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (agent.company || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
            {onExit && (
                <button onClick={onExit} style={{ background: '#444', color: 'white', border: 'none', padding: '10px 20px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>← Πίσω</button>
            )}
            <div>
                <h1 style={{ margin: 0, color: '#002F6C', fontSize: '2rem' }}>Διαχείριση Εκτελωνιστών</h1>
                <p style={{ margin: '5px 0 0 0', color: '#666' }}>Προσθήκη, επεξεργασία και διαγραφή συνεργατών</p>
            </div>
        </div>
        <button
          onClick={() => { resetForm(); setIsEditing(true); }}
          style={{ ...btnStyle, background: isEditing ? '#ccc' : '#002F6C', cursor: isEditing ? 'default' : 'pointer' }}
          disabled={isEditing}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Plus size={20} /> Νέος Εκτελωνιστής
          </div>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isEditing ? '1fr 2fr' : '1fr', gap: 30 }}>
        
        {/* FORM SECTION */}
        {isEditing && (
          <div>
            <div style={{ background: 'white', padding: 25, borderRadius: 12, boxShadow: '0 4px 15px rgba(0,0,0,0.05)', position: 'sticky', top: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom: '1px solid #eee', paddingBottom: 15 }}>
                <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#333' }}>
                  {currentAgent ? 'Επεξεργασία' : 'Νέα Καταχώρηση'}
                </h2>
                <button onClick={resetForm} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}>
                  <X size={24} />
                </button>
              </div>
              
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                <div>
                  <label style={labelStyle}>Όνομα</label>
                  <input required type="text" name="name" value={formData.name} onChange={handleInputChange} style={inpStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Επώνυμο</label>
                  <input required type="text" name="surname" value={formData.surname} onChange={handleInputChange} style={inpStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Επωνυμία Εταιρείας</label>
                  <input type="text" name="company" value={formData.company} onChange={handleInputChange} style={inpStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Τηλέφωνο</label>
                  <input required type="text" name="phone" value={formData.phone} onChange={handleInputChange} style={inpStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Email</label>
                  <input type="email" name="email" value={formData.email} onChange={handleInputChange} style={inpStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Διεύθυνση</label>
                  <input type="text" name="address" value={formData.address} onChange={handleInputChange} style={inpStyle} />
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button type="submit" disabled={loading} style={{ ...btnStyle, background: '#2e7d32', flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
                    {loading ? <Loader2 size={20} className="animate-spin" /> : <><Save size={20} /> Αποθήκευση</>}
                  </button>
                  <button type="button" onClick={resetForm} style={{ ...btnStyle, background: '#f5f5f5', color: '#333', border: '1px solid #ddd', flex: 1 }}>
                    Ακύρωση
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* LIST SECTION */}
        <div>
          <div style={{ background: 'white', borderRadius: 12, boxShadow: '0 4px 15px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
            <div style={{ padding: 20, borderBottom: '1px solid #eee', background: '#f8f9fa', display: 'flex', alignItems: 'center' }}>
              <Search size={20} style={{ color: '#999', marginRight: 10 }} />
              <input 
                type="text" 
                placeholder="Αναζήτηση με επώνυμο ή εταιρεία..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '1rem', color: '#333' }}
              />
            </div>

            {loading && !isEditing ? (
              <div style={{ padding: 50, textAlign: 'center', color: '#666' }}>
                <Loader2 size={30} className="animate-spin" style={{ margin: '0 auto 10px' }} />
                Φόρτωση δεδομένων...
              </div>
            ) : filteredAgents.length === 0 ? (
              <div style={{ padding: 50, textAlign: 'center', color: '#666' }}>
                Δεν βρέθηκαν αποτελέσματα.
              </div>
            ) : (
              <div>
                {filteredAgents.map((agent) => (
                  <div key={agent.id} style={{ 
                      padding: '20px', 
                      borderBottom: '1px solid #f0f0f0', 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center', /* Changed to center for better button alignment */
                      transition: 'background 0.2s',
                      gap: '20px' 
                  }} onMouseEnter={e => e.currentTarget.style.background = '#f9fbff'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                    
                    {/* Agent Info - Takes up available space */}
                    <div style={{ flex: 1, minWidth: 0 }}> 
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5, flexWrap: 'wrap' }}>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#333', whiteSpace: 'nowrap' }}>{agent.surname} {agent.name}</h3>
                        {agent.company && (
                            <span style={{ background: '#e3f2fd', color: '#1565c0', fontSize: '0.8rem', padding: '2px 8px', borderRadius: 12, whiteSpace: 'nowrap' }}>
                                {agent.company}
                            </span>
                        )}
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                        <div style={infoRowStyle}>
                            <Phone size={14} color="#666" style={{flexShrink:0}} /> <span style={{overflow: 'hidden', textOverflow: 'ellipsis'}}>{agent.phone}</span>
                        </div>
                        {agent.email && (
                            <div style={infoRowStyle}>
                                <Mail size={14} color="#666" style={{flexShrink:0}} /> <span style={{overflow: 'hidden', textOverflow: 'ellipsis'}}>{agent.email}</span>
                            </div>
                        )}
                        {agent.address && (
                            <div style={infoRowStyle}>
                                <MapPin size={14} color="#666" style={{flexShrink:0}} /> <span style={{overflow: 'hidden', textOverflow: 'ellipsis'}}>{agent.address}</span>
                            </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Action Buttons - Fixed width, doesn't shrink */}
                    <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                      <button onClick={() => handleEdit(agent)} style={actionBtnStyle('#e3f2fd', '#1565c0')} title="Επεξεργασία">
                        <Edit2 size={18} />
                      </button>
                      <button onClick={() => handleDelete(agent.id)} style={actionBtnStyle('#ffebee', '#c62828')} title="Διαγραφή">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      
      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
};

// --- STYLES ---
const inpStyle = { 
  width: '100%', 
  padding: '10px 12px', 
  borderRadius: 8, 
  border: '1px solid #ddd', 
  fontSize: '0.95rem', 
  boxSizing: 'border-box',
  outline: 'none',
  transition: 'border 0.2s'
};

const labelStyle = { 
  display: 'block', 
  marginBottom: 6, 
  fontSize: '0.85rem', 
  fontWeight: 600, 
  color: '#555' 
};

const btnStyle = { 
  padding: '10px 20px', 
  color: 'white', 
  border: 'none', 
  borderRadius: 8, 
  fontSize: '0.95rem', 
  fontWeight: 600, 
  cursor: 'pointer',
  transition: 'all 0.2s'
};

const infoRowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: '#666',
    fontSize: '0.9rem',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
};

const actionBtnStyle = (bg, color) => ({
    background: bg,
    color: color,
    border: 'none',
    padding: 0, // IMPORTANT: Reset padding
    width: '36px', // Explicit units
    height: '36px', // Explicit units
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'transform 0.1s',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
});

export default AgentsApp;