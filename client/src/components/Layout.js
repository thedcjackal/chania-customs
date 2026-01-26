import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import '../App.css';

// --- Helpers ---
export const formatDate = (isoString) => {
    if(!isoString) return "";
    const [y, m, d] = isoString.split('-');
    return `${d}-${m}-${y}`;
};
export const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
export const getDayName = (year, month, day) => ['Κυρ','Δευ','Τρι','Τετ','Πεμ','Παρ','Σαβ'][new Date(year, month, day).getDay()];

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
    useEffect(() => { axios.get(`${API_URL}/announcements`).then(res => setAnnouncements(res.data)); }, []);
    return (
        <div className="welcome-container">
            <header className="public-header"><img src="/aade-logo.png" className="header-logo" alt="" /><button className="login-btn" onClick={() => onNavigate('login')}>Είσοδος</button></header>
            <div className="hero-section"><img src="/watermark.jpg" className="watermark-home" alt="" /><h1>Τελωνείο Χανίων</h1><p className="hero-subtitle">Ψηφιακή Πύλη</p></div>
            <div className="news-section">
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}><h3>Τελευταίες Ανακοινώσεις</h3><button className="small-btn secondary" onClick={() => onNavigate('announcements')}>Περισσότερα</button></div>
                {announcements.slice(0, 1).map(a => (<div key={a.id} className="news-card"><small>{formatDate(a.date)}</small><p>{a.text}</p></div>))}
            </div>
        </div>
    );
};

export const AnnouncementsPage = ({ onNavigate }) => {
    const [list, setList] = useState([]);
    useEffect(() => { axios.get(`${API_URL}/announcements`).then(res => setList(res.data)); }, []);
    return (<div className="welcome-container"><header className="public-header"><button className="back-btn" onClick={() => onNavigate('welcome')}>← Πίσω</button></header><div className="news-section" style={{marginTop: 80}}><h2>Αρχείο Ανακοινώσεων</h2>{list.map(a => (<div key={a.id} className="news-card"><small>{formatDate(a.date)}</small><p>{a.text}</p></div>))}</div></div>);
};

export const Login = ({ onLogin, onBack }) => {
    const [creds, setCreds] = useState({username:'', password:''});
    const handleSubmit = async (e) => { e.preventDefault(); try { const res = await axios.post(`${API_URL}/login`, creds); onLogin(res.data); } catch { alert('Αποτυχία εισόδου.'); } };
    return (<div className="login-wrapper"><button className="back-btn" onClick={onBack}>← Πίσω</button><div className="login-box"><img src="/aade-logo.png" style={{height:60}} alt="" /><h2>Είσοδος</h2><input onChange={e=>setCreds({...creds, username:e.target.value})} placeholder="Όνομα Χρήστη"/><input type="password" onChange={e=>setCreds({...creds, password:e.target.value})} placeholder="Κωδικός"/><button onClick={handleSubmit}>Σύνδεση</button></div></div>);
};

export const ServicePortal = ({ onNavigate, user, onLogout }) => {
    const isAllowed = (appKey) => user.allowed_apps && user.allowed_apps.includes(appKey);
    return (
        <div className="portal-container">
            <header className="portal-header">
                <h3>Ηλεκτρονικές Υπηρεσίες</h3>
                <div style={{display:'flex', gap:10, alignItems:'center'}}>
                    <span>{user.name} {user.surname}</span>
                    <button className="secondary small-btn" onClick={onLogout}>Έξοδος</button>
                </div>
            </header>
            <div className="app-grid">
                <div className={`app-card ${!isAllowed('fuel') ? 'disabled' : ''}`} onClick={() => isAllowed('fuel') && onNavigate('fuel_app')}>
                    <img src="/ship-icon.png" className="icon" alt="" />
                    <h3>Προγραμματισμός Εφοδιασμού Τουριστικών Σκαφών</h3>
                </div>
                {/* Personnel App Removed */}
                <div className={`app-card ${!isAllowed('services') ? 'disabled' : ''}`} onClick={() => isAllowed('services') && onNavigate('services_app')}>
                    <span style={{fontSize:50}}>📅</span>
                    <h3>Υπηρεσίες & Βάρδιες</h3>
                </div>
                {isAllowed('announcements') && <div className="app-card" onClick={() => onNavigate('announcements_app')}><span style={{fontSize:50}}>📢</span><h3>Διαχείριση Ανακοινώσεων</h3></div>}
                {isAllowed('accounts') && <div className="app-card" onClick={() => onNavigate('accounts_app')}><span style={{fontSize:50}}>🔐</span><h3>Διαχείριση Λογαριασμών</h3></div>}
            </div>
        </div>
    );
};