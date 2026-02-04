import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase'; 
import { Calendar, Info, FileText, Users, Megaphone, LogOut, Phone, User, Briefcase } from 'lucide-react';

// --- HELPER: Greek Vocative Case Converter ---
const toVocative = (name) => {
    if (!name) return '';
    const n = name.trim();
    if (n.endsWith('ος')) return n.slice(0, -2) + 'ε';
    if (n.endsWith('ός')) return n.slice(0, -2) + 'έ';
    if (n.endsWith('ης')) return n.slice(0, -1);
    if (n.endsWith('ής')) return n.slice(0, -1);
    if (n.endsWith('ας')) return n.slice(0, -1);
    if (n.endsWith('άς')) return n.slice(0, -1);
    return n;
};

// --- APP CONFIGURATION ---
const APP_CONFIG = [
    { 
        id: 'services', 
        target: 'services_app', 
        label: 'Υπηρεσίες', 
        icon: <Calendar size={24} />, 
        bg: '#e3f2fd', 
        color: '#2196F3' 
    },
    { 
        id: 'fuel', 
        target: 'fuel_app', 
        label: 'Εφοδιασμοί', 
        icon: <FileText size={24} />, 
        bg: '#e0f2f1', 
        color: '#009688' 
    },
    { 
        id: 'accounts', 
        target: 'accounts_app', 
        label: 'Διαχείριση Λογαριασμών', 
        icon: <Users size={24} />, 
        bg: '#fff3e0', 
        color: '#ef6c00' 
    },
    { 
        id: 'agents', 
        target: 'agents_app', 
        label: 'Εκτελωνιστές', 
        icon: <Briefcase size={24} />, 
        bg: '#e8f5e9', 
        color: '#2e7d32' 
    },
    { 
        id: 'announcements', 
        target: 'announcements_app', 
        label: 'Ανακοινώσεις', 
        icon: <Megaphone size={24} />, 
        bg: '#f3e5f5', 
        color: '#8e24aa' 
    },
    { 
        id: 'directory', 
        target: 'directory_app', 
        label: 'Τηλεφωνικός Κατάλογος', 
        icon: <Phone size={24} />, 
        bg: '#e8eaf6', 
        color: '#3f51b5' 
    }
];

export const HomeApp = ({ user, onAppSelect, onLogout, onProfileClick }) => {
    const [isLocked, setIsLocked] = useState(false);
    
    // Secure rights retrieval
    const allowedApps = user.allowed_apps || [];
    const isRoot = user.role === 'root_admin';

    // --- FIX: DISPLAY NAME PRIORITY ---
    const displayName = user?.name || user?.username || user?.email;

    // --- FILTER VISIBLE APPS ---
    const hasRight = (appId) => isRoot || allowedApps.includes(appId);
    const visibleApps = APP_CONFIG.filter(app => hasRight(app.id));

    useEffect(() => {
        const checkSecurity = async () => {
            const { data: factors } = await supabase.auth.mfa.listFactors();
            const has2FA = factors?.totp?.some(f => f.status === 'verified');

            if (has2FA) {
                const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
                if (data.currentLevel === 'aal1') {
                    setIsLocked(true); 
                }
            }
        };
        checkSecurity();
    }, []);

    const iconBox = (bgColor, color) => ({
        width: '50px',
        height: '50px',
        borderRadius: '50%',
        background: bgColor,
        color: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0 
    });

    if (isLocked) {
        return (
            <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa' }}>
                <h2 style={{color: '#c62828'}}>⚠️ Απαιτείται Έλεγχος Ασφαλείας</h2>
                <p>Ο λογαριασμός σας διαθέτει 2FA, αλλά δεν έχει γίνει επιβεβαίωση.</p>
                <button onClick={onLogout} style={{padding: '10px 20px', background: '#002F6C', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', marginTop: 20}}>
                    Επιστροφή στην Είσοδο
                </button>
            </div>
        );
    }

    return (
        <div className="app-shell">
            <div className="home-layout">
                <div className="home-left">
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <img src="/aade-logo.png" alt="AADE Logo" className="home-logo" />
                        <h1 className="home-title">Τελωνείο Χανίων</h1>
                        
                        <p className="welcome-msg">
                            Καλωσήρθες, {toVocative(displayName)}
                        </p>

                        <button onClick={onProfileClick} className="home-action-btn profile-btn">
                            <User size={20} /> Προφίλ
                        </button>
                    
                        <button onClick={onLogout} className="home-action-btn logout-btn">
                            <LogOut size={20} /> Αποσύνδεση
                        </button>
                    </div>
                </div>

                <div className="home-right">
                    <div style={{ width: '100%', maxWidth: '600px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '25px' }}>
                            <Info size={24} color="#002F6C" />
                            <h2 style={{ margin: 0, color: '#333', fontSize: '1.4rem' }}>Διαθέσιμες Εφαρμογές</h2>
                        </div>
                        
                        {/* Dynamic Grid Class Logic */}
                        <div className={`apps-grid ${visibleApps.length === 1 ? 'single-item' : ''}`}>
                            {visibleApps.map(app => (
                                <button 
                                    key={app.id} 
                                    onClick={() => onAppSelect(app.target)} 
                                    className="app-card-btn" 
                                    style={cardStyle} 
                                    onMouseEnter={hoverIn} 
                                    onMouseLeave={hoverOut}
                                >
                                    <div style={iconBox(app.bg, app.color)}>{app.icon}</div>
                                    <div style={{ textAlign: 'left', flex: 1 }}>
                                        <h3 style={{ margin: 0, fontSize: '1rem', color: '#002F6C' }}>{app.label}</h3>
                                    </div>
                                </button>
                            ))}
                            {visibleApps.length === 0 && (
                                <div style={{textAlign: 'center', color: '#999', gridColumn: '1 / -1'}}>
                                    Δεν υπάρχουν διαθέσιμες εφαρμογές.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <style>{`
                body, html, #root { height: 100%; width: 100%; margin: 0; display: flex; align-items: center; justify-content: center; background: #f8f9fa; }
                .app-shell { background: #f8f9fa; height: 70vh; width: 100%; display: flex; align-items: center; justify-content: center; padding: 0 40px; box-sizing: border-box; overflow: hidden; }
                
                /* UPDATED: Added gap: 60px and changed justify-content to center */
                .home-layout { display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 60px; width: 100%; max-width: 1200px; height: 100%; }
                
                .home-left, .home-right { flex: 1; display: flex; justify-content: center; align-items: center; }
                .home-logo { height: 110px; margin-bottom: 25px; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.1)); }
                .home-title { color: #002F6C; font-size: 2.8rem; font-weight: 800; margin: 0; text-align: center; letter-spacing: -0.5px; line-height: 1.1; }
                .welcome-msg { color: #666; font-size: 1.4rem; margin-top: 20px; margin-bottom: 30px; font-weight: 500; text-align: center; }
                .home-action-btn { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 12px 30px; border-radius: 30px; font-size: 1.1rem; font-weight: 600; cursor: pointer; transition: all 0.2s ease; width: 100%; max-width: 250px; margin-bottom: 15px; }
                .profile-btn { background: #002F6C; color: white; border: 2px solid #002F6C; }
                .profile-btn:hover { background: #004494; border-color: #004494; transform: translateY(-2px); box-shadow: 0 4px 10px rgba(0, 47, 108, 0.2); }
                .logout-btn { background: white; border: 2px solid #e0e0e0; color: #555; }
                .logout-btn:hover { border-color: #d32f2f; color: #d32f2f; background: #ffebee; transform: translateY(-2px); }
                
                /* Standard Grid: 2 Columns */
                .apps-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; width: 100%; }
                
                /* Single Item Grid: 1 Column, Centered, Limited Width */
                .apps-grid.single-item { grid-template-columns: 1fr; max-width: 350px; margin: 0 auto; }

                @media (max-width: 900px) { 
                    body, html, #root { display: block; height: auto; } 
                    .app-shell { height: auto; min-height: 100vh; overflow-y: auto; align-items: flex-start; padding: 40px 20px; } 
                    .home-layout { flex-direction: column; gap: 40px; } 
                    .home-left, .home-right { width: 100%; } 
                    .apps-grid { grid-template-columns: 1fr; } 
                }
            `}</style>
        </div>
    );
};

const cardStyle = { display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'flex-start', background: 'white', padding: '15px', borderRadius: '12px', border: '1px solid #eee', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', transition: 'all 0.2s ease', width: '100%', minHeight: '80px' };
const hoverIn = (e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 15px rgba(0,0,0,0.1)'; e.currentTarget.style.background = '#e6f3ff'; };
const hoverOut = (e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)'; e.currentTarget.style.background = 'white'; };