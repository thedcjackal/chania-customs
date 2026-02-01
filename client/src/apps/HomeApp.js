import React, { useEffect,useState } from 'react';
import { supabase } from '../supabase';
import { Calendar, Info, FileText, Users, Megaphone, LogOut, Phone } from 'lucide-react';
import { MFASetup } from '../components/MFASetup';
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

export const HomeApp = ({ user, onAppSelect, onLogout }) => {
    const [showMFA, setShowMFA] = useState(false);
    const [isLocked, setIsLocked] = useState(false);
    // Ασφαλής ανάκτηση των δικαιωμάτων. Αν είναι root_admin τα βλέπει όλα, αλλιώς ελέγχουμε τη λίστα.
    const allowedApps = user.allowed_apps || [];
    const isRoot = user.role === 'root_admin';

useEffect(() => {
        const checkSecurity = async () => {
            const { data: factors } = await supabase.auth.mfa.listFactors();
            const has2FA = factors?.totp?.some(f => f.status === 'verified');

            if (has2FA) {
                const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
                if (data.currentLevel === 'aal1') {
                    setIsLocked(true); // User slipped through without code -> Lock
                }
            }
        };
        checkSecurity();
    }, []);
    // Helper function to check rights
    const hasRight = (appId) => isRoot || allowedApps.includes(appId);

    // Helper for perfect circle icon containers
    const iconBox = (bgColor, color) => ({
        width: '50px',
        height: '50px',
        borderRadius: '50%',
        background: bgColor,
        color: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0 // Prevent squashing
    });

    // --- LOCK SCREEN ---
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
                
                {/* --- LEFT COLUMN: BRANDING & WELCOME --- */}
                <div className="home-left">
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <img 
                            src="/aade-logo.png" 
                            alt="AADE Logo" 
                            className="home-logo"
                        />
                        <h1 className="home-title">
                            Τελωνείο Χανίων
                        </h1>
                        <p className="welcome-msg">
                            Καλωσήρθες, {toVocative(user?.name || user?.username)}
                        </p>
                        {/* 2FA BUTTON - MODIFIED */}
                    <button 
                        onClick={() => setShowMFA(true)}
                        style={{ 
                            marginBottom: 15, // <--- MARGIN ADDED
                            padding: '8px 16px', 
                            background: '#002F6C', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: 4, 
                            cursor: 'pointer',
                            fontWeight: 'bold'
                        }}
                        title="Διαχείριση Two-Factor Authentication"
                    >
                        2FA
                    </button>
                
                        <button onClick={onLogout} className="home-logout-btn">
                            <LogOut size={20} /> Αποσύνδεση
                        </button>
                    </div>
                </div>
{showMFA && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    background: 'rgba(0,0,0,0.6)', zIndex: 9999, 
                    display: 'flex', justifyContent: 'center', alignItems: 'center',
                    backdropFilter: 'blur(3px)' // Nice blur effect
                }}>
                    <MFASetup 
                        onCancel={() => setShowMFA(false)} 
                        onSuccess={() => setTimeout(() => setShowMFA(false), 2000)}
                    />
                </div>
            )}
                {/* --- RIGHT COLUMN: APPS LIST --- */}
                <div className="home-right">
                    <div style={{ width: '100%', maxWidth: '600px' }}>
                        {/* CENTERED HEADER */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '25px' }}>
                            <Info size={24} color="#002F6C" />
                            <h2 style={{ margin: 0, color: '#333', fontSize: '1.4rem' }}>Διαθέσιμες Εφαρμογές</h2>
                        </div>
                        
                        <div className="apps-grid">
                            {/* --- 1. SERVICES APP --- */}
                            {hasRight('services') && (
                                <button 
                                    onClick={() => onAppSelect('services_app')} 
                                    className="app-card-btn"
                                    style={cardStyle}
                                    onMouseEnter={hoverIn}
                                    onMouseLeave={hoverOut}
                                >
                                    <div style={iconBox('#e3f2fd', '#2196F3')}>
                                        <Calendar size={24} />
                                    </div>
                                    <div style={{ textAlign: 'left', flex: 1 }}>
                                        <h3 style={{ margin: 0, fontSize: '1rem', color: '#002F6C' }}>Υπηρεσίες</h3>
                                    </div>
                                </button>
                            )}

                            {/* --- 2. FUEL APP --- */}
                            {hasRight('fuel') && (
                                <button 
                                    onClick={() => onAppSelect('reservations')}
                                    className="app-card-btn"
                                    style={cardStyle}
                                    onMouseEnter={hoverIn}
                                    onMouseLeave={hoverOut}
                                >
                                    <div style={iconBox('#e0f2f1', '#009688')}>
                                        <FileText size={24} />
                                    </div>
                                    <div style={{ textAlign: 'left', flex: 1 }}>
                                        <h3 style={{ margin: 0, fontSize: '1rem', color: '#002F6C' }}>Εφοδιασμοί</h3>
                                    </div>
                                </button>
                            )}
                            
                            {/* --- 3. ADMIN: USERS --- */}
                            {hasRight('accounts') && (
                                <button 
                                    onClick={() => onAppSelect('accounts_app')}
                                    className="app-card-btn"
                                    style={cardStyle}
                                    onMouseEnter={hoverIn}
                                    onMouseLeave={hoverOut}
                                >
                                    <div style={iconBox('#fff3e0', '#ef6c00')}>
                                        <Users size={24} />
                                    </div>
                                    <div style={{ textAlign: 'left', flex: 1 }}>
                                        <h3 style={{ margin: 0, fontSize: '1rem', color: '#002F6C' }}>Διαχείριση Λογαριασμών</h3>
                                    </div>
                                </button>
                            )}
                            
                            {/* --- 4. ADMIN: ANNOUNCEMENTS --- */}
                            {hasRight('announcements') && (
                                <button 
                                    onClick={() => onAppSelect('announcements_app')}
                                    className="app-card-btn"
                                    style={cardStyle}
                                    onMouseEnter={hoverIn}
                                    onMouseLeave={hoverOut}
                                >
                                    <div style={iconBox('#f3e5f5', '#8e24aa')}>
                                        <Megaphone size={24} />
                                    </div>
                                    <div style={{ textAlign: 'left', flex: 1 }}>
                                        <h3 style={{ margin: 0, fontSize: '1rem', color: '#002F6C' }}>Ανακοινώσεις</h3>
                                    </div>
                                </button>
                            )}

                            {/* --- 5. ADMIN: DIRECTORY --- */}
                            {hasRight('directory') && (
                                <button 
                                    onClick={() => onAppSelect('directory_app')}
                                    className="app-card-btn"
                                    style={cardStyle}
                                    onMouseEnter={hoverIn}
                                    onMouseLeave={hoverOut}
                                >
                                    <div style={iconBox('#e8eaf6', '#3f51b5')}>
                                        <Phone size={24} />
                                    </div>
                                    <div style={{ textAlign: 'left', flex: 1 }}>
                                        <h3 style={{ margin: 0, fontSize: '1rem', color: '#002F6C' }}>Τηλεφωνικός Κατάλογος</h3>
                                    </div>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Inline CSS */}
            <style>{`
                body, html, #root {
                    height: 100%;
                    width: 100%;
                    margin: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #f8f9fa;
                }

                .app-shell {
                    background: #f8f9fa;
                    height: 70vh;
                    width: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0 40px;
                    box-sizing: border-box;
                    overflow: hidden;
                }
                
                .home-layout {
                    display: flex;
                    flex-direction: row;
                    align-items: center;
                    justify-content: space-between;
                    width: 100%;
                    max-width: 1200px;
                    height: 100%;
                }

                .home-left {
                    flex: 1;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }

                .home-right {
                    flex: 1;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }

                .home-logo {
                    height: 110px;
                    margin-bottom: 25px;
                    filter: drop-shadow(0 4px 6px rgba(0,0,0,0.1));
                }

                .home-title {
                    color: #002F6C;
                    font-size: 2.8rem;
                    font-weight: 800;
                    margin: 0;
                    text-align: center;
                    letter-spacing: -0.5px;
                    line-height: 1.1;
                }

                .welcome-msg {
                    color: #666;
                    font-size: 1.4rem;
                    margin-top: 20px;
                    margin-bottom: 30px;
                    font-weight: 500;
                    text-align: center;
                }

                .home-logout-btn {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    background: white;
                    border: 2px solid #e0e0e0;
                    color: #555;
                    padding: 12px 30px;
                    border-radius: 30px;
                    font-size: 1.1rem;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .home-logout-btn:hover {
                    border-color: #d32f2f;
                    color: #d32f2f;
                    background: #ffebee;
                    transform: translateY(-2px);
                }

                .apps-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 15px;
                    width: 100%;
                }

                @media (max-width: 900px) {
                    body, html, #root {
                        display: block;
                        height: auto;
                    }
                    .app-shell {
                        height: auto;
                        min-height: 100vh;
                        overflow-y: auto;
                        align-items: flex-start;
                        padding: 40px 20px;
                    }
                    .home-layout {
                        flex-direction: column;
                        gap: 40px;
                    }
                    .home-left, .home-right {
                        width: 100%;
                    }
                    .apps-grid {
                        grid-template-columns: 1fr;
                    }
                }
            `}</style>
        </div>
    );
};

// --- STYLES & INTERACTION ---
const cardStyle = {
    display: 'flex', 
    alignItems: 'center', 
    gap: '12px',
    justifyContent: 'flex-start',
    background: 'white', 
    padding: '15px',
    borderRadius: '12px', 
    border: '1px solid #eee', 
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
    transition: 'all 0.2s ease',
    width: '100%',
    minHeight: '80px' 
};

const hoverIn = (e) => {
    e.currentTarget.style.transform = 'translateY(-2px)';
    e.currentTarget.style.boxShadow = '0 6px 15px rgba(0,0,0,0.1)';
    e.currentTarget.style.background = '#e6f3ff';
};

const hoverOut = (e) => {
    e.currentTarget.style.transform = 'translateY(0)';
    e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
    e.currentTarget.style.background = 'white';
};