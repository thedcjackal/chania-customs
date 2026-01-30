import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from './config';
import { Phone, Mail, ChevronDown, ChevronRight, X } from 'lucide-react';

// --- IMPORT COMPONENTS ---
import { 
  WelcomePage, 
  AnnouncementsPage, 
  Login
} from './components/Layout';

// --- IMPORT APPS ---
import { FuelApp } from './apps/FuelApp';
import { AnnouncementsApp } from './apps/AnnouncementsApp';
import { HomeApp } from './apps/HomeApp';
import { DirectoryApp } from './apps/DirectoryApp'; 
import { ServicesApp } from './apps/ServicesApp';
import { AccountManager } from './apps/AccountManager';

// --- SUPERVISOR ICON COMPONENT ---
export const SupervisorIcon = () => (
    <div style={{
        width: 28, 
        height: 28, 
        borderRadius: '50%', 
        background: '#e3f2fd',
        color: '#1565c0', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        fontWeight: 'bold', 
        fontSize: '15px', 
        flexShrink: 0,
        border: '1px solid #1565c0', 
        cursor: 'default',
        lineHeight: 1
    }} title="Προϊστάμενος">
        Π
    </div>
);

function App() {
    const [view, setView] = useState('welcome');
    const [user, setUser] = useState(null);

    // --- GLOBAL MODAL STATES ---
    const [showDirectory, setShowDirectory] = useState(false);
    const [showEmail, setShowEmail] = useState(false);
    const [directoryData, setDirectoryData] = useState([]);
    
    // Track which departments are expanded (by ID)
    const [expandedIds, setExpandedIds] = useState([]);

    useEffect(() => {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
            setUser(JSON.parse(storedUser));
            setView('portal');
        }
    }, []);

    const handleLogin = (userData) => {
        setUser(userData);
        localStorage.setItem('user', JSON.stringify(userData));
        setView('portal');
    };

    const handleLogout = () => {
        setUser(null);
        localStorage.removeItem('user');
        setView('welcome');
    };

    const openDirectory = async () => {
        setShowDirectory(true);
        try {
            const res = await axios.get(`${API_URL}/directory`);
            setDirectoryData(res.data);
            // Default: All CLOSED (Empty Array)
            setExpandedIds([]); 
        } catch (e) { console.error(e); }
    };

    const toggleDept = (id) => {
        setExpandedIds(prev => 
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    const navigate = (target) => {
        if (target === 'services_app' && user) setView('services_app');
        else if (target === 'fuel_app' && user) setView('fuel_app'); 
        else if (target === 'reservations' && user) setView('fuel_app'); 
        else if (target === 'announcements_app' && user) setView('announcements_app');
        else if (target === 'accounts_app' && user) setView('accounts_app');
        else if (target === 'directory_app' && user) setView('directory_app');
        else setView(target);
    };

    const renderContent = () => {
        switch (view) {
            case 'welcome': return <WelcomePage onNavigate={navigate} />;
            case 'announcements': return <AnnouncementsPage onNavigate={navigate} />;
            case 'login': return <Login onLogin={handleLogin} onBack={() => navigate('welcome')} />;
            case 'portal': return <HomeApp user={user} onAppSelect={navigate} onLogout={handleLogout} />;
            case 'fuel_app': return <FuelApp user={user} onExit={() => setView('portal')} />;
            case 'services_app': return <ServicesApp user={user} onExit={() => setView('portal')} />;
            case 'announcements_app': return <AnnouncementsApp user={user} onExit={() => setView('portal')} />;
            case 'accounts_app': return <AccountManager user={user} onExit={() => setView('portal')} />;
            case 'directory_app': return <DirectoryApp user={user} onExit={() => setView('portal')} />;
            default: return <WelcomePage onNavigate={navigate} />;
        }
    };

    return (
        <div className="App">
            {renderContent()}

            {/* --- GLOBAL FLOATING BUTTON (RECTANGULAR SPLIT) --- */}
            <div className="fab-container">
                <div className="split-rect-btn">
                    <button 
                        onClick={openDirectory} 
                        className="btn-half left"
                        title="Τηλεφωνικός Κατάλογος"
                    >
                        <Phone size={20} strokeWidth={2.5} />
                    </button>
                    <div className="btn-divider"></div>
                    <button 
                        onClick={() => setShowEmail(true)} 
                        className="btn-half right"
                        title="Email Επικοινωνίας"
                    >
                        <Mail size={20} strokeWidth={2.5} />
                    </button>
                </div>
            </div>

            {/* --- MODALS --- */}

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
                            <a href="mailto:tel.chanion@aade.gr" style={{ 
                                fontSize: '1.6rem', 
                                color: '#002F6C', 
                                textDecoration: 'none', 
                                fontWeight: '700',
                                borderBottom: '2px solid #2196F3',
                                paddingBottom: 2
                            }}>
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
                                                {/* CLICKABLE HEADER */}
                                                <div className="dept-header" onClick={() => toggleDept(dept.id)}>
                                                    <div className="header-icon">
                                                        {isExpanded ? <ChevronDown size={20} color="#666"/> : <ChevronRight size={20} color="#666"/>}
                                                    </div>
                                                    <h3>{dept.name}</h3>
                                                    {/* Spacer for centering balance */}
                                                    <div style={{width: 20}}></div> 
                                                </div>
                                                
                                                {/* CONDITIONAL BODY */}
                                                {isExpanded && (
                                                    <div className="dept-phones">
                                                        {dept.phones.length > 0 ? (
                                                            dept.phones.map(p => (
                                                                <div key={p.id} className="phone-row">
                                                                    <div className="number-anchor">
                                                                        {p.is_supervisor && (
                                                                            <div className="supervisor-badge-abs">
                                                                                <SupervisorIcon />
                                                                            </div>
                                                                        )}
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
                            ) : (
                                <div className="loading-state">
                                    <div className="spinner"></div>
                                    <p>Φόρτωση...</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* GLOBAL STYLES */}
            <style>{`
                /* FLOATING BUTTON STYLES */
                .fab-container {
                    position: fixed;
                    bottom: 30px;
                    right: 30px;
                    z-index: 2000;
                }

                .split-rect-btn {
                    display: flex;
                    align-items: center;
                    background-color: #002F6C;
                    border-radius: 12px;
                    box-shadow: 0 4px 15px rgba(0, 47, 108, 0.3);
                    overflow: hidden;
                    height: 48px;
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                }

                .split-rect-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(0, 47, 108, 0.4);
                }

                .btn-half {
                    background: transparent;
                    border: none;
                    color: white;
                    cursor: pointer;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0 15px;
                    font-size: 1rem;
                    transition: all 0.2s;
                    min-width: 50px;
                }

                .btn-half.left { padding-left: 20px; padding-right: 12px; }
                .btn-half.right { padding-left: 12px; padding-right: 20px; }

                .btn-half:hover {
                    background-color: rgba(255, 255, 255, 0.1);
                    color: #4fc3f7;
                }

                .btn-divider {
                    width: 1px;
                    height: 24px;
                    background-color: rgba(255, 255, 255, 0.3);
                }

                /* MODAL OVERLAY & CONTAINER */
                .modal-overlay {
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0,0,0,0.6);
                    display: flex; justifyContent: center; alignItems: center;
                    z-index: 3000;
                    backdrop-filter: blur(4px);
                }
                
                .modal-content {
                    background: white; 
                    border-radius: 12px; 
                    display: flex; 
                    flex-direction: column;
                    box-shadow: 0 25px 80px rgba(0,0,0,0.4);
                    animation: modalPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                    overflow: hidden;
                    max-height: 85vh;
                }
                
                /* WIDER MODAL FOR TWO COLUMNS */
                .directory-modal { width: 90%; max-width: 900px; height: 80vh; }
                .small-modal { width: 90%; max-width: 400px; height: auto; }

                .modal-header {
                    padding: 15px 25px; 
                    border-bottom: 1px solid #eee;
                    display: flex; 
                    justify-content: center;
                    align-items: center;
                    background: white;
                    flex-shrink: 0;
                }

                .modal-body {
                    flex: 1;
                    overflow-y: auto;
                    background: #f4f6f8;
                    padding: 20px;
                }

                /* TWO COLUMN GRID LAYOUT */
                .dept-list { 
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 15px;
                    align-items: start; /* Prevents cards stretching to match height */
                }
                
                /* Responsive fallback to 1 column on smaller screens */
                @media (max-width: 700px) {
                    .dept-list {
                        grid-template-columns: 1fr;
                    }
                }
                
                .dept-card {
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                    overflow: hidden;
                    border: 1px solid #e0e0e0;
                    width: 100%;
                }
                
                /* CLICKABLE HEADER STYLES */
                .dept-header {
                    background: #f8f9fa;
                    padding: 12px 15px;
                    border-bottom: 1px solid #eee;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    cursor: pointer;
                    transition: background 0.2s;
                    gap: 10px;
                }
                .dept-header:hover {
                    background: #eef1f6;
                }
                
                .header-icon {
                    display: flex;
                    align-items: center;
                    flex-shrink: 0;
                }

                .dept-header h3 { 
                    margin: 0; 
                    color: #002F6C; 
                    font-size: 1.1rem; 
                    font-weight: 700;
                    flex: 1; 
                    text-align: center; 
                    line-height: 1.3;
                }
                
                .phone-row {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 12px 15px;
                    border-bottom: 1px solid #f0f0f0;
                    min-height: 30px;
                }
                .phone-row:last-child { border-bottom: none; }

                .number-anchor {
                    position: relative;
                    display: inline-block;
                }
                
                .supervisor-badge-abs {
                    position: absolute;
                    left: -40px;
                    top: 50%;
                    transform: translateY(-50%);
                }
                
                .phone-number {
                    font-family: 'Roboto Mono', monospace;
                    font-weight: 600;
                    font-size: 1.3rem;
                    color: #333;
                    letter-spacing: 0.5px;
                }
                .empty-msg { text-align: center; color: #999; padding: 15px; font-style: italic; }

                .loading-state {
                    display: flex; flexDirection: column; alignItems: center; justifyContent: center;
                    height: 100%; color: #666; gap: 10px;
                }
                .spinner {
                    width: 30px; height: 30px; border: 3px solid #eee; border-top: 3px solid #002F6C;
                    border-radius: 50%; animation: spin 1s linear infinite;
                }

                @keyframes modalPop {
                    from { opacity: 0; transform: scale(0.95); }
                    to { opacity: 1; transform: scale(1); }
                }
                @keyframes spin { 100% { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
}

export default App;