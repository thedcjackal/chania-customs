import React, { useState, useEffect } from 'react';
import api from '../api/axios'; 
import { supabase } from '../supabase'; 
import '../App.css';
import { AlertTriangle, X } from 'lucide-react';

// --- SHARED HELPERS ---
export const formatDate = (isoString) => {
    if(!isoString) return "";
    const [y, m, d] = isoString.split('-');
    return `${d}-${m}-${y}`;
};
export const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
export const getDayName = (year, month, day) => ['Κυρ','Δευ','Τρι','Τετ','Πεμ','Παρ','Σαβ'][new Date(year, month, day).getDay()];

// --- SKELETON COMPONENT ---
const AnnouncementSkeleton = () => (
    <div className="news-card" style={{ borderLeft: '4px solid #e0e0e0', minHeight: '85px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ width: '85px', height: '14px', background: '#e0e0e0', borderRadius: '4px', marginBottom: '10px' }}></div>
        <div style={{ width: '100%', height: '16px', background: '#f5f5f5', borderRadius: '4px', marginBottom: '6px' }}></div>
        <div style={{ width: '70%', height: '16px', background: '#f5f5f5', borderRadius: '4px' }}></div>
    </div>
);

// --- Components ---
export const AppHeader = ({ title, user, onExit, icon }) => (
    <header className="app-header">
        <div style={{display:'flex', gap:10, alignItems:'center'}}>{icon}<h2>{title}</h2></div>
        <div className="header-controls">
            <span style={{fontWeight:'bold'}}>{user.name} {user.surname}</span>
            <button className="secondary small-btn" onClick={onExit}>Έξοδος</button>
        </div>
    </header>
);

export const WelcomePage = ({ onNavigate }) => {
    const [announcements, setAnnouncements] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedAnn, setSelectedAnn] = useState(null);

    useEffect(() => {
        api.get('/api/announcements')
            .then(res => setAnnouncements(res.data.slice(0, 1))) 
            .catch(err => console.error(err))
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className="welcome-container">
            <header className="public-header">
                <img src="/aade-logo.png" className="header-logo" alt="AADE Logo" width="180" height="60" style={{height: '60px', width: 'auto'}} />
                <button className="login-btn" onClick={() => onNavigate('login')}>Είσοδος</button>
            </header>
            
            <div className="hero-section" style={{ position: 'relative', minHeight: '300px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
                <img src="/watermark.jpg" alt="Watermark" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 0, height: 'auto', width: '75%', opacity: 0.15 }} />
                <div style={{ zIndex: 1, textAlign: 'center' }}>
                    <h1>Τελωνείο Χανίων</h1>
                    <p className="hero-subtitle">Ψηφιακή Πύλη</p>
                </div>
            </div>
            
            <div className="news-section">
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 15}}>
                    <h3>Τελευταίες Ανακοινώσεις</h3>
                    <button className="small-btn secondary" onClick={() => onNavigate('announcements')}>Περισσότερα</button>
                </div>
                <div style={{ minHeight: '120px' }}>
                    {loading ? <AnnouncementSkeleton /> : announcements.length > 0 ? (
                        announcements.map(a => (
                            <div key={a.id} className="news-card" onClick={() => setSelectedAnn(a)} style={{ cursor: 'pointer', background: a.is_important ? '#fffde7' : 'white', borderLeft: a.is_important ? '5px solid #ff9800' : '5px solid #2196F3', transition: 'transform 0.2s', minHeight: '85px' }} onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>
                                <small style={{ color: '#666', display: 'flex', alignItems: 'center', gap: '5px' }}>{a.is_important && <AlertTriangle size={24} color="#f57c00" />} {formatDate(a.date)}</small>
                                <p style={{ fontWeight: a.is_important ? '600' : '400', color: '#333' }}>{a.text}</p>
                            </div>
                        ))
                    ) : <div className="news-card" style={{ textAlign:'center', color:'#888', display:'flex', alignItems:'center', justifyContent:'center', minHeight:'85px' }}>Δεν υπάρχουν ανακοινώσεις.</div>}
                </div>
            </div>

             {selectedAnn && (
                <div className="modal-overlay" onClick={() => setSelectedAnn(null)} style={{position:'fixed', top:0, left:0, width:'100%', height:'100%', background:'rgba(0,0,0,0.5)', display:'flex', justifyContent:'center', alignItems:'center', zIndex:1000}}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{background:'white', padding:30, borderRadius:12, maxWidth:600, width:'90%', position:'relative', maxHeight: '80vh', overflowY: 'auto'}}>
                        <button onClick={() => setSelectedAnn(null)} style={{position:'absolute', top:15, right:15, background:'none', border:'none', cursor:'pointer'}}><X size={24} color="#666"/></button>
                        <div style={{borderBottom:'1px solid #eee', paddingBottom:15, marginBottom:20}}>
                            <small style={{color:'#666', display:'block', marginBottom:5}}>{formatDate(selectedAnn.date)}</small>
                            <h2 style={{margin:0, color: selectedAnn.is_important ? '#e65100' : '#002F6C', display:'flex', alignItems:'center', gap:10}}>{selectedAnn.is_important && <AlertTriangle size={24}/>}{selectedAnn.text}</h2>
                        </div>
                        <div style={{fontSize:'1.1rem', lineHeight:1.6, whiteSpace:'pre-wrap', color:'#333'}}>{selectedAnn.body || "Δεν υπάρχει επιπλέον κείμενο."}</div>
                    </div>
                </div>
            )}
        </div>
    );
};

export const AnnouncementsPage = ({ onNavigate }) => {
    const [list, setList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedAnn, setSelectedAnn] = useState(null);

    useEffect(() => { 
        api.get('/api/announcements')
            .then(res => setList(res.data))
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className="welcome-container" style={{overflow:'auto', height:'auto', minHeight:'100vh'}}>
            <header className="public-header">
                <button className="back-btn" onClick={() => onNavigate('welcome')}>← Πίσω</button>
            </header>
            <div className="news-section" style={{marginTop: 40, maxWidth: 800, margin: '40px auto', padding: '0 20px'}}>
                <h2 style={{color: '#002F6C', borderBottom:'2px solid #eee', paddingBottom: 10}}>Αρχείο Ανακοινώσεων</h2>
                {loading ? <><AnnouncementSkeleton /><AnnouncementSkeleton /></> : list.map(a => (
                    <div key={a.id} className="news-card" onClick={() => setSelectedAnn(a)} style={{ cursor: 'pointer', background: a.is_important ? '#fffde7' : 'white', borderLeft: a.is_important ? '5px solid #ff9800' : '5px solid #2196F3' }}>
                        <small style={{display:'flex', alignItems:'center', gap:5}}>{a.is_important && <AlertTriangle size={24} color="#f57c00"/>}{formatDate(a.date)}</small>
                        <p style={{fontWeight: a.is_important ? '600' : '400'}}>{a.text}</p>
                    </div>
                ))}
            </div>
            {selectedAnn && (
                <div className="modal-overlay" onClick={() => setSelectedAnn(null)} style={{position:'fixed', top:0, left:0, width:'100%', height:'100%', background:'rgba(0,0,0,0.5)', display:'flex', justifyContent:'center', alignItems:'center', zIndex:1000}}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{background:'white', padding:30, borderRadius:12, maxWidth:600, width:'90%', position:'relative', maxHeight: '80vh', overflowY: 'auto'}}>
                        <button onClick={() => setSelectedAnn(null)} style={{position:'absolute', top:15, right:15, background:'none', border:'none', cursor:'pointer'}}><X size={24} color="#666"/></button>
                        <div style={{borderBottom:'1px solid #eee', paddingBottom:15, marginBottom:20}}>
                            <small style={{color:'#666', display:'block', marginBottom:5}}>{formatDate(selectedAnn.date)}</small>
                            <h2 style={{margin:0, color: selectedAnn.is_important ? '#e65100' : '#002F6C', display:'flex', alignItems:'center', gap:10}}>{selectedAnn.is_important && <AlertTriangle size={24}/>}{selectedAnn.text}</h2>
                        </div>
                        <div style={{fontSize:'1.1rem', lineHeight:1.6, whiteSpace:'pre-wrap', color:'#333'}}>{selectedAnn.body || "Δεν υπάρχει επιπλέον κείμενο."}</div>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- LOGIN COMPONENT (Must Use Supabase, NOT Axios) ---
export const Login = ({ onBack }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    
    // 2FA STATE
    const [needs2FA, setNeeds2FA] = useState(false);
    const [token2FA, setToken2FA] = useState('');
    const [factorId, setFactorId] = useState('');
    
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSubmit = async (e) => { 
        e.preventDefault(); 
        setLoading(true);
        setError(null);
        
        try {
            if (!needs2FA) {
                // PHASE 1: PASSWORD LOGIN (Supabase)
                console.log("Attempting Password Login...");
                // FIX: Removed unused 'data' variable
                const { error } = await supabase.auth.signInWithPassword({
                    email: email,
                    password: password,
                });

                if (error) throw error;

                // CHECK FOR 2FA
                console.log("Password Success. Checking 2FA status...");
                const { data: factors } = await supabase.auth.mfa.listFactors();
                const totpFactor = factors?.totp?.find(f => f.status === 'verified');

                if (totpFactor) {
                    console.log("2FA Found:", totpFactor.id);
                    setFactorId(totpFactor.id);
                    setNeeds2FA(true); 
                    setLoading(false); 
                    return; 
                }
            } else {
                // PHASE 2: VERIFY 2FA CODE
                console.log("Verifying 2FA Code...");
                // FIX: Removed unused 'data' variable
                const { error } = await supabase.auth.mfa.challengeAndVerify({
                    factorId: factorId,
                    code: token2FA,
                });

                if (error) throw error;
            }
        } catch (err) {
            console.error("Login Error:", err);
            setError(err.message === "Invalid login credentials" ? "Λάθος στοιχεία" : "Σφάλμα: " + err.message);
            setLoading(false);
        }
    };

    return (
        <div className="login-wrapper">
            <button className="back-btn" onClick={onBack}>← Πίσω</button>
            <div className="login-box">
                <img src="/aade-logo.png" style={{height:60}} alt="" />
                
                <h2>{needs2FA ? 'Έλεγχος 2FA' : 'Είσοδος'}</h2>
                
                {error && <div style={{background:'#ffebee', color:'#c62828', padding:'10px', borderRadius:'4px', marginBottom:'10px', fontSize:'0.9rem'}}>{error}</div>}
                
                <form onSubmit={handleSubmit} style={{display:'flex', flexDirection:'column', gap:'10px', width:'100%'}}>
                    {!needs2FA ? (
                        <>
                            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" required style={{padding:'10px', borderRadius:'4px', border:'1px solid #ccc'}}/>
                            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Κωδικός" required style={{padding:'10px', borderRadius:'4px', border:'1px solid #ccc'}}/>
                        </>
                    ) : (
                        <>
                            <p style={{textAlign:'center', marginBottom:5, fontSize:'0.9rem', color:'#555'}}>Εισάγετε τον 6ψήφιο κωδικό.</p>
                            <input type="text" maxLength="6" value={token2FA} onChange={e => setToken2FA(e.target.value)} placeholder="000000" required autoFocus autoComplete="one-time-code" style={{padding:'15px', borderRadius:'8px', border:'2px solid #002F6C', textAlign:'center', fontSize:'1.5rem', letterSpacing:'8px', fontWeight:'bold'}}/>
                        </>
                    )}
                    <button type="submit" disabled={loading} style={{marginTop:'10px', padding:'10px', background: loading ? '#ccc' : '#002F6C', color:'white', border:'none', borderRadius:'4px', cursor: loading ? 'default' : 'pointer'}}>{loading ? 'Έλεγχος...' : (needs2FA ? 'Επιβεβαίωση' : 'Σύνδεση')}</button>
                </form>
            </div>
        </div>
    );
};