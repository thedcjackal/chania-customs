import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
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
        axios.get(`${API_URL}/announcements`)
            .then(res => setAnnouncements(res.data.slice(0, 1))) 
            .catch(err => console.error(err))
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className="welcome-container">
            <header className="public-header">
                <img 
                    src="/aade-logo.png" 
                    className="header-logo" 
                    alt="AADE Logo" 
                    width="180" 
                    height="60" 
                    style={{height: '60px', width: 'auto'}} 
                />
                <button className="login-btn" onClick={() => onNavigate('login')}>Είσοδος</button>
            </header>
            
            <div className="hero-section" style={{ position: 'relative', minHeight: '300px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
                <img 
                    src="/watermark.jpg" 
                    alt="Watermark" 
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        zIndex: 0,
                        height: 'auto', 
                        width: '75%', 
                        opacity: 0.15 
                    }} 
                />
                
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
                    {loading ? (
                        <AnnouncementSkeleton />
                    ) : (
                        announcements.length > 0 ? (
                            announcements.map(a => (
                                <div 
                                    key={a.id} 
                                    className="news-card" 
                                    onClick={() => setSelectedAnn(a)}
                                    style={{
                                        cursor: 'pointer',
                                        background: a.is_important ? '#fffde7' : 'white',
                                        borderLeft: a.is_important ? '5px solid #ff9800' : '5px solid #2196F3',
                                        transition: 'transform 0.2s',
                                        minHeight: '85px'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                                    onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                                >
                                    <small style={{ color: '#666', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        {a.is_important && <AlertTriangle size={24} color="#f57c00" />} 
                                        {formatDate(a.date)}
                                    </small>
                                    <p style={{ fontWeight: a.is_important ? '600' : '400', color: '#333' }}>{a.text}</p>
                                </div>
                            ))
                        ) : (
                            <div className="news-card" style={{ textAlign:'center', color:'#888', display:'flex', alignItems:'center', justifyContent:'center', minHeight:'85px' }}>
                                Δεν υπάρχουν ανακοινώσεις.
                            </div>
                        )
                    )}
                </div>
            </div>

             {/* DETAIL MODAL */}
             {selectedAnn && (
                <div className="modal-overlay" onClick={() => setSelectedAnn(null)} style={{position:'fixed', top:0, left:0, width:'100%', height:'100%', background:'rgba(0,0,0,0.5)', display:'flex', justifyContent:'center', alignItems:'center', zIndex:1000}}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{background:'white', padding:30, borderRadius:12, maxWidth:600, width:'90%', position:'relative', maxHeight: '80vh', overflowY: 'auto'}}>
                        <button onClick={() => setSelectedAnn(null)} style={{position:'absolute', top:15, right:15, background:'none', border:'none', cursor:'pointer'}}><X size={24} color="#666"/></button>
                        <div style={{borderBottom:'1px solid #eee', paddingBottom:15, marginBottom:20}}>
                            <small style={{color:'#666', display:'block', marginBottom:5}}>{formatDate(selectedAnn.date)}</small>
                            <h2 style={{margin:0, color: selectedAnn.is_important ? '#e65100' : '#002F6C', display:'flex', alignItems:'center', gap:10}}>
                                {selectedAnn.is_important && <AlertTriangle size={24}/>}
                                {selectedAnn.text}
                            </h2>
                        </div>
                        <div style={{fontSize:'1.1rem', lineHeight:1.6, whiteSpace:'pre-wrap', color:'#333'}}>
                            {selectedAnn.body || "Δεν υπάρχει επιπλέον κείμενο."}
                        </div>
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
        axios.get(`${API_URL}/announcements`)
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
                {loading ? (
                    <>
                        <AnnouncementSkeleton />
                        <AnnouncementSkeleton />
                        <AnnouncementSkeleton />
                    </>
                ) : (
                    list.map(a => (
                        <div 
                            key={a.id} 
                            className="news-card" 
                            onClick={() => setSelectedAnn(a)}
                            style={{
                                cursor: 'pointer',
                                background: a.is_important ? '#fffde7' : 'white',
                                borderLeft: a.is_important ? '5px solid #ff9800' : '5px solid #2196F3'
                            }}
                        >
                            <small style={{display:'flex', alignItems:'center', gap:5}}>
                                {a.is_important && <AlertTriangle size={24} color="#f57c00"/>}
                                {formatDate(a.date)}
                            </small>
                            <p style={{fontWeight: a.is_important ? '600' : '400'}}>{a.text}</p>
                        </div>
                    ))
                )}
            </div>

            {selectedAnn && (
                <div className="modal-overlay" onClick={() => setSelectedAnn(null)} style={{position:'fixed', top:0, left:0, width:'100%', height:'100%', background:'rgba(0,0,0,0.5)', display:'flex', justifyContent:'center', alignItems:'center', zIndex:1000}}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{background:'white', padding:30, borderRadius:12, maxWidth:600, width:'90%', position:'relative', maxHeight: '80vh', overflowY: 'auto'}}>
                        <button onClick={() => setSelectedAnn(null)} style={{position:'absolute', top:15, right:15, background:'none', border:'none', cursor:'pointer'}}><X size={24} color="#666"/></button>
                        <div style={{borderBottom:'1px solid #eee', paddingBottom:15, marginBottom:20}}>
                            <small style={{color:'#666', display:'block', marginBottom:5}}>{formatDate(selectedAnn.date)}</small>
                            <h2 style={{margin:0, color: selectedAnn.is_important ? '#e65100' : '#002F6C', display:'flex', alignItems:'center', gap:10}}>
                                {selectedAnn.is_important && <AlertTriangle size={24}/>}
                                {selectedAnn.text}
                            </h2>
                        </div>
                        <div style={{fontSize:'1.1rem', lineHeight:1.6, whiteSpace:'pre-wrap', color:'#333'}}>
                            {selectedAnn.body || "Δεν υπάρχει επιπλέον κείμενο."}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export const Login = ({ onLogin, onBack }) => {
    const [creds, setCreds] = useState({username:'', password:''});
    const handleSubmit = async (e) => { 
        e.preventDefault(); 
        try { 
            const res = await axios.post(`${API_URL}/login`, creds); 
            onLogin(res.data); 
        } catch { alert('Αποτυχία εισόδου.'); } 
    };
    return (
        <div className="login-wrapper">
            <button className="back-btn" onClick={onBack}>← Πίσω</button>
            <div className="login-box">
                <img src="/aade-logo.png" style={{height:60}} alt="" />
                <h2>Είσοδος</h2>
                <input onChange={e=>setCreds({...creds, username:e.target.value})} placeholder="Όνομα Χρήστη"/>
                <input type="password" onChange={e=>setCreds({...creds, password:e.target.value})} placeholder="Κωδικός"/>
                <button onClick={handleSubmit}>Σύνδεση</button>
            </div>
        </div>
    );
};