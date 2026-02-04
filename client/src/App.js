import React, { useState, useEffect } from 'react';
import api from './api/axios';
import { supabase } from './supabase'; 
import { Phone, Mail, ChevronDown, ChevronRight } from 'lucide-react';

// --- IMPORT COMPONENTS ---
import { 
  WelcomePage, 
  AnnouncementsPage, 
  Login
} from './components/Layout';
import { MFAVerify } from './components/MFAVerify'; 
import { Profile } from './pages/Profile';
import AgentsApp from './components/AgentsApp'; // <--- 1. NEW IMPORT

// --- IMPORT APPS ---
import { FuelApp } from './apps/FuelApp';
import { AnnouncementsApp } from './apps/AnnouncementsApp';
import { HomeApp } from './apps/HomeApp';
import { DirectoryApp } from './apps/DirectoryApp'; 
import { ServicesApp } from './apps/ServicesApp';
import { AccountManager } from './apps/AccountManager';

// --- SUPERVISOR ICON COMPONENT ---
export const SupervisorIcon = () => (
    <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#e3f2fd', color: '#1565c0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '15px', flexShrink: 0, border: '1px solid #1565c0', cursor: 'default', lineHeight: 1 }} title="Προϊστάμενος">
        Π
    </div>
);

function App() {
    const [view, setView] = useState('welcome');
    
    // --- AUTH STATE ---
    const [session, setSession] = useState(null);
    const [userProfile, setUserProfile] = useState(null); 
    const [loading, setLoading] = useState(true);
    const [profileLoading, setProfileLoading] = useState(false); 

    // --- GLOBAL MODAL STATES ---
    const [showDirectory, setShowDirectory] = useState(false);
    const [showEmail, setShowEmail] = useState(false);
    const [directoryData, setDirectoryData] = useState([]);
    const [expandedIds, setExpandedIds] = useState([]);

    // --- AUTHENTICATION LISTENER ---
    useEffect(() => {
        const handleAuthChange = async (currentSession) => {
            if (!currentSession) {
                setUserProfile(null);
                setSession(null);
                setView('welcome');
                setLoading(false);
                return;
            }

            try {
                // 🔒 MFA GUARD
                const { data: levelData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
                const { data: factorsData } = await supabase.auth.mfa.listFactors();
                
                const currentLevel = levelData?.currentLevel;
                const hasVerified2FA = factorsData?.totp?.some(f => f.status === 'verified');

                // 🛑 BLOCKING: If 2FA is required but we are at Level 1
                if (hasVerified2FA && currentLevel === 'aal1') {
                    console.log("🔒 App.js: 2FA required. Redirecting to Verify.");
                    setSession(currentSession);
                    setView('mfa_verify'); 
                    setLoading(false);
                    return; 
                }

                // ✅ PASS: Security Clear
                console.log("🔓 App.js: Security OK. Loading Profile...");
                setSession(currentSession);
                
                // Fetch Profile
                setProfileLoading(true);
                await fetchUserProfile(currentSession);
                setProfileLoading(false);
                
                // Navigate to Portal (only if not already deep linked)
                setView(prev => {
                    if (prev === 'welcome' || prev === 'login' || prev === 'mfa_verify') return 'portal';
                    return prev;
                });
                
            } catch (e) {
                console.error("MFA Check failed:", e);
                setLoading(false);
            } finally {
                setLoading(false);
            }
        };

        supabase.auth.getSession().then(({ data: { session } }) => {
            handleAuthChange(session);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' || event === 'MFA_CHALLENGE_VERIFIED' || event === 'TOKEN_REFRESHED') {
                handleAuthChange(session);
            } else if (event === 'SIGNED_OUT') {
                setSession(null);
                setUserProfile(null);
                setView('welcome');
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    // --- FETCH BACKEND PROFILE ---
    const fetchUserProfile = async (currentSession) => {
        try {
            // Secure 'api' client handles token injection automatically
            const res = await api.get('/api/auth/exchange'); 
            setUserProfile(res.data);
        } catch (error) {
            console.error("Profile sync failed:", error);
        }
    };

    const activeUser = session && userProfile ? { ...session.user, ...userProfile } : null;

    const handleLogout = async () => {
        // Clear HttpOnly Cookie via Backend
        try { await api.post('/api/auth/logout'); } catch(e) { console.error(e); }
        // Clear LocalStorage
        await supabase.auth.signOut();
    };

    // --- DIRECTORY ---
    const openDirectory = async () => {
        setShowDirectory(true);
        try {
            const res = await api.get('/api/directory');
            setDirectoryData(res.data);
            setExpandedIds([]); 
        } catch (e) { console.error(e); }
    };

    const toggleDept = (id) => {
        setExpandedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const navigate = (target) => {
        // 2. ADD agents_app TO PROTECTED APPS
        const protectedApps = ['services_app', 'fuel_app', 'reservations', 'announcements_app', 'accounts_app', 'directory_app', 'profile', 'agents_app'];
        
        if (protectedApps.includes(target)) {
            if (activeUser) setView(target);
            else setView('login');
        } else {
            setView(target);
        }
    };

    // --- LOADING SCREEN ---
    if (loading || (session && !userProfile && !loading && view === 'portal') || profileLoading) {
        return (
            <div style={{height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#002F6C'}}>
                <div style={{width: 40, height: 40, border: '4px solid #eee', borderTop: '4px solid #002F6C', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: 20}}></div>
                <h2>Φόρτωση Συστήματος...</h2>
                <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    const renderContent = () => {
        switch (view) {
            case 'welcome': return <WelcomePage onNavigate={navigate} />;
            case 'announcements': return <AnnouncementsPage onNavigate={navigate} />;
            
            case 'login': return <Login onBack={() => navigate('welcome')} />; 
            case 'mfa_verify': return <MFAVerify />; 
            
            case 'portal': 
                return activeUser ? (
                    <HomeApp 
                        user={activeUser} 
                        onAppSelect={navigate} 
                        onLogout={handleLogout}
                        onProfileClick={() => setView('profile')} 
                    />
                ) : null;
            
            case 'profile': 
                return activeUser ? (
                    <Profile 
                        user={activeUser} 
                        onBack={() => setView('portal')} 
                    /> 
                ) : null;

            case 'fuel_app': return <FuelApp user={activeUser} onExit={() => setView('portal')} />;
            case 'services_app': return <ServicesApp user={activeUser} onExit={() => setView('portal')} />;
            case 'announcements_app': return <AnnouncementsApp user={activeUser} onExit={() => setView('portal')} />;
            case 'accounts_app': return <AccountManager user={activeUser} onExit={() => setView('portal')} />;
            case 'directory_app': return <DirectoryApp user={activeUser} onExit={() => setView('portal')} />;
            
            // 3. ADD THE CASE FOR THE NEW APP
            case 'agents_app': return <AgentsApp user={activeUser} onExit={() => setView('portal')} />;
            
            default: return <WelcomePage onNavigate={navigate} />;
        }
    };

    return (
        <div className="App">
            {renderContent()}

            {/* FLOATING ACTION BUTTONS */}
            <div className="fab-container">
                <div className="split-rect-btn">
                    <button onClick={openDirectory} className="btn-half left" title="Τηλεφωνικός Κατάλογος"><Phone size={20} strokeWidth={2.5} /></button>
                    <div className="btn-divider"></div>
                    <button onClick={() => setShowEmail(true)} className="btn-half right" title="Email Επικοινωνίας"><Mail size={20} strokeWidth={2.5} /></button>
                </div>
            </div>

            {/* EMAIL MODAL */}
            {showEmail && (
                <div className="modal-overlay" onClick={() => setShowEmail(false)}>
                    <div className="modal-content small-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 style={{margin:0, color:'#002F6C', display:'flex', alignItems:'center', gap:10}}>
                                <Mail size={24} /> Επικοινωνία
                            </h2>
                        </div>
                        <div style={{ padding: '40px 30px', textAlign: 'center', background:'#f8f9fa' }}>
                            <p style={{marginBottom:10, fontSize:'1.1rem', color:'#666'}}>Email Τελωνείου:</p>
                            <a href="mailto:tel.chanion@aade.gr" style={{ fontSize: '1.6rem', color: '#002F6C', textDecoration: 'none', fontWeight: '700', borderBottom: '2px solid #2196F3', paddingBottom: 2 }}>
                                tel.chanion@aade.gr
                            </a>
                        </div>
                    </div>
                </div>
            )}

            {/* DIRECTORY MODAL */}
            {showDirectory && (
                <div className="modal-overlay" onClick={() => setShowDirectory(false)}>
                    <div className="modal-content directory-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 style={{margin:0, color:'#002F6C', display:'flex', alignItems:'center', gap:10}}>
                                <Phone size={24} /> Τηλεφωνικός Κατάλογος
                            </h2>
                        </div>
                        <div className="modal-body">
                            {directoryData.length > 0 ? (
                                <div className="dept-list">
                                    {directoryData.map(dept => {
                                        const isExpanded = expandedIds.includes(dept.id);
                                        return (
                                            <div key={dept.id} className="dept-card">
                                                <div className="dept-header" onClick={() => toggleDept(dept.id)}>
                                                    <div className="header-icon">{isExpanded ? <ChevronDown size={20} color="#666"/> : <ChevronRight size={20} color="#666"/>}</div>
                                                    <h3>{dept.name}</h3><div style={{width: 20}}></div> 
                                                </div>
                                                {isExpanded && (
                                                    <div className="dept-phones">
                                                        {dept.phones.length > 0 ? (
                                                            dept.phones.map(p => (
                                                                <div key={p.id} className="phone-row">
                                                                    <div className="number-anchor">
                                                                        {p.is_supervisor && (<div className="supervisor-badge-abs"><SupervisorIcon /></div>)}
                                                                        <span className="phone-number">{p.number}</span>
                                                                    </div>
                                                                </div>
                                                            ))
                                                        ) : <div className="empty-msg">Κανένα τηλέφωνο</div>}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : <div className="loading-state"><div className="spinner"></div><p>Φόρτωση...</p></div>}
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .fab-container { position: fixed; bottom: 30px; right: 30px; z-index: 2000; }
                .split-rect-btn { display: flex; align-items: center; background-color: #002F6C; border-radius: 12px; box-shadow: 0 4px 15px rgba(0, 47, 108, 0.3); overflow: hidden; height: 48px; transition: transform 0.2s ease, box-shadow 0.2s ease; }
                .split-rect-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0, 47, 108, 0.4); }
                .btn-half { background: transparent; border: none; color: white; cursor: pointer; height: 100%; display: flex; align-items: center; justify-content: center; padding: 0 15px; font-size: 1rem; transition: all 0.2s; min-width: 50px; }
                .btn-half.left { padding-left: 20px; padding-right: 12px; } .btn-half.right { padding-left: 12px; padding-right: 20px; }
                .btn-half:hover { background-color: rgba(255, 255, 255, 0.1); color: #4fc3f7; }
                .btn-divider { width: 1px; height: 24px; background-color: rgba(255, 255, 255, 0.3); }
                .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; justifyContent: center; alignItems: center; z-index: 3000; backdrop-filter: blur(4px); }
                .modal-content { background: white; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 25px 80px rgba(0,0,0,0.4); animation: modalPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); overflow: hidden; max-height: 85vh; }
                .directory-modal { width: 90%; max-width: 900px; height: 80vh; } .small-modal { width: 90%; max-width: 400px; height: auto; }
                .modal-header { padding: 15px 25px; border-bottom: 1px solid #eee; display: flex; justify-content: center; align-items: center; background: white; flex-shrink: 0; }
                .modal-body { flex: 1; overflow-y: auto; background: #f4f6f8; padding: 20px; }
                .dept-list { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; align-items: start; }
                @media (max-width: 700px) { .dept-list { grid-template-columns: 1fr; } }
                .dept-card { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); overflow: hidden; border: 1px solid #e0e0e0; width: 100%; }
                .dept-header { background: #f8f9fa; padding: 12px 15px; border-bottom: 1px solid #eee; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: background 0.2s; gap: 10px; }
                .dept-header:hover { background: #eef1f6; }
                .header-icon { display: flex; align-items: center; flex-shrink: 0; }
                .dept-header h3 { margin: 0; color: #002F6C; font-size: 1.1rem; font-weight: 700; flex: 1; text-align: center; line-height: 1.3; }
                .phone-row { display: flex; align-items: center; justify-content: center; padding: 12px 15px; border-bottom: 1px solid #f0f0f0; min-height: 30px; }
                .phone-row:last-child { border-bottom: none; }
                .number-anchor { position: relative; display: inline-block; }
                .supervisor-badge-abs { position: absolute; left: -40px; top: 50%; transform: translateY(-50%); }
                .phone-number { font-family: 'Roboto Mono', monospace; font-weight: 600; font-size: 1.3rem; color: #333; letter-spacing: 0.5px; }
                .empty-msg { text-align: center; color: #999; padding: 15px; font-style: italic; }
                .loading-state { display: flex; flexDirection: column; alignItems: center; justifyContent: center; height: 100%; color: #666; gap: 10px; }
                .spinner { width: 30px; height: 30px; border: 3px solid #eee; border-top: 3px solid #002F6C; border-radius: 50%; animation: spin 1s linear infinite; }
                @keyframes modalPop { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
                @keyframes spin { 100% { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
}

export default App;