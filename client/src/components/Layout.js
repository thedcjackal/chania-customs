import React, { useState, useEffect } from 'react';
import api from '../api/axios';
import { supabase } from '../supabase';
import '../App.css';
import {
    AlertTriangle,
    X,
    Briefcase,
    Phone,
    Mail,
    MapPin,
    ChevronDown,
    ChevronUp,
    User
} from 'lucide-react';

// --- SHARED HELPERS ---
export const formatDate = (isoString) => {
    if (!isoString) return "";
    const [y, m, d] = isoString.split('-');
    return `${d}-${m}-${y}`;
};
export const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
export const getDayName = (year, month, day) => ['Κυρ', 'Δευ', 'Τρι', 'Τετ', 'Πεμ', 'Παρ', 'Σαβ'][new Date(year, month, day).getDay()];

// --- SKELETON COMPONENT ---
const AnnouncementSkeleton = () => (
    <div style={{
        width: '100%',
        boxSizing: 'border-box',
        borderLeft: '4px solid #e0e0e0',
        backgroundColor: '#fff',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        borderRadius: '4px',
        padding: '15px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
    }}>
        <div style={{ width: '85px', height: '14px', background: '#e0e0e0', borderRadius: '4px', marginBottom: '10px' }}></div>
        <div style={{ width: '90%', height: '16px', background: '#f5f5f5', borderRadius: '4px', marginBottom: '6px' }}></div>
        <div style={{ width: '60%', height: '16px', background: '#f5f5f5', borderRadius: '4px' }}></div>
    </div>
);

// --- TRANSLATIONS ---
const translations = {
    el: {
        login: "Είσοδος",
        title: "Τελωνείο Χανίων",
        subtitle: "Ψηφιακή Πύλη",
        latestAnn: "Τελευταία Ανακοίνωση",
        noAnn: "Δεν υπάρχουν ανακοινώσεις.",
        agents: "Τελωνειακοί Αντιπρόσωποι",
        more: "Περισσότερα",
        footerRights: "Τελωνείο Χανίων",
        terms: "Όροι Χρήσης",
        termsTitle: "Όροι Χρήσης",
        termsBody: "Η ιστοσελίδα δεν αποτελεί προϊόν ανάπτυξης από πλευράς της κεντρικής διοίκησης της ΑΑΔΕ αλλά μια προσπάθεια των υπαλλήλων του Τελωνείου Χανίων για μια βελτιωμένη εμπειρία των συναλλασομένων.",
        randomOrder: "⚠️ Η σειρά εμφάνισης είναι τυχαία",
        loading: "Φόρτωση...",
        noAgents: "Δεν βρέθηκαν καταχωρημένοι τελωνειακοί αντιπρόσωποι.",
        close: "Κλείσιμο"
    },
    en: {
        login: "Login",
        title: "Chania Customs",
        subtitle: "Web Portal",
        latestAnn: "Latest Announcement",
        noAnn: "No announcements available.",
        agents: "Customs Agents",
        more: "More",
        footerRights: "Chania Customs",
        terms: "Terms of Use",
        termsTitle: "Terms of Use",
        termsBody: "This website is not a product developed by the central administration of IAPR (AADE) but an effort by the employees of Chania Customs to provide an improved experience for traders.",
        randomOrder: "⚠️ Display order is random",
        loading: "Loading...",
        noAgents: "No registered agents found.",
        close: "Close"
    }
};

// --- Components ---
// --- COMPONENTS ---
export const AppHeader = ({ title, user, onExit, icon }) => {
    const [isMobile, setIsMobile] = useState(window.innerWidth < 600);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 600);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return (
        <header className="app-header" style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            justifyContent: isMobile ? 'center' : 'space-between',
            gap: isMobile ? '12px' : '0',
            alignItems: 'center',
            padding: isMobile ? '15px' : '15px 30px',
            textAlign: isMobile ? 'center' : 'left'
        }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center' }}>
                {icon}
                <h2 style={{ margin: 0, fontSize: isMobile ? '1.2rem' : '1.5rem' }}>{title}</h2>
            </div>
            <div className="header-controls" style={{
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                gap: isMobile ? '8px' : '15px',
                width: isMobile ? '100%' : 'auto',
                alignItems: 'center'
            }}>
                <span style={{ fontWeight: 'bold', textAlign: 'center', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <User size={18} color="#002F6C" />
                    {user.name} {user.surname}
                </span>
                <button className="secondary small-btn" onClick={onExit} style={{ width: isMobile ? '100%' : 'auto' }}>Έξοδος</button>
            </div>
        </header>
    );
};

export const WelcomePage = ({ onNavigate, language, setLanguage }) => {
    const [announcements, setAnnouncements] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedAnn, setSelectedAnn] = useState(null);

    // --- RESPONSIVE STATE ---
    const [isMobile, setIsMobile] = useState(window.innerWidth < 600);

    // --- LANGUAGE CONST ---
    const t = translations[language];

    // --- STATE FOR MODALS ---
    const [showTerms, setShowTerms] = useState(false);

    // --- AGENTS STATE ---
    const [showAgents, setShowAgents] = useState(false);
    const [agentsLoading, setAgentsLoading] = useState(false);
    const [randomAgents, setRandomAgents] = useState([]);
    const [expandedAgentId, setExpandedAgentId] = useState(null);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 600);
        window.addEventListener('resize', handleResize);

        api.get('/api/announcements')
            .then(res => setAnnouncements(res.data.slice(0, 1)))
            .catch(err => console.error(err))
            .finally(() => setLoading(false));

        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // --- AGENTS HANDLERS ---
    const handleOpenAgents = async () => {
        setShowAgents(true);
        setAgentsLoading(true);
        setExpandedAgentId(null);

        try {
            const { data, error } = await supabase
                .from('customs_agents')
                .select('*');

            if (error) throw error;

            if (data) {
                let shuffled = [...data];
                for (let i = shuffled.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                }
                setRandomAgents(shuffled);
            }
        } catch (err) {
            console.error("Error loading agents:", err);
            setRandomAgents([]);
        } finally {
            setAgentsLoading(false);
        }
    };

    const toggleAgent = (id) => {
        setExpandedAgentId(expandedAgentId === id ? null : id);
    };

    return (
        <div className="welcome-container" style={{ position: 'relative', minHeight: '100vh', paddingBottom: '60px' }}>
            {/* Header */}
            <header className="public-header" style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: isMobile ? '10px 15px' : '10px 40px'
            }}>
                <img
                    src="/aade-logo.png"
                    className="header-logo"
                    alt="AADE Logo"
                    width={isMobile ? "140" : "180"}
                    height="60"
                    style={{ height: isMobile ? '45px' : '60px', width: 'auto' }}
                />

                <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '10px' : '20px' }}>
                    {/* LANGUAGE SWITCHER */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', fontWeight: '500' }}>
                        <span onClick={() => setLanguage('el')} style={{ cursor: 'pointer', color: language === 'el' ? '#002F6C' : '#888', fontWeight: language === 'el' ? 'bold' : 'normal' }}>GR</span>
                        <span style={{ color: '#ccc' }}>|</span>
                        <span onClick={() => setLanguage('en')} style={{ cursor: 'pointer', color: language === 'en' ? '#002F6C' : '#888', fontWeight: language === 'en' ? 'bold' : 'normal' }}>EN</span>
                    </div>

                    <button
                        className="login-btn"
                        onClick={() => onNavigate('login')}
                        style={{ padding: isMobile ? '6px 12px' : '8px 16px', fontSize: isMobile ? '0.9rem' : '1rem' }}
                    >
                        {t.login}
                    </button>
                </div>
            </header>

            {/* Hero Section */}
            <div className="hero-section" style={{
                position: 'relative',
                minHeight: isMobile ? '220px' : '300px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                overflow: 'hidden'
            }}>
                <img
                    src="/watermark.jpg"
                    alt="Watermark"
                    style={{
                        position: 'absolute',
                        top: '45%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        zIndex: 0,
                        height: 'auto',
                        width: isMobile ? '60%' : '45%',
                        opacity: 0.15
                    }}
                />
                <div style={{ zIndex: 1, textAlign: 'center' }}>
                    <h1 style={{ fontSize: isMobile ? '1.8rem' : '3.2rem', margin: '0 0 10px 0' }}>{t.title}</h1>
                    <p className="hero-subtitle" style={{ fontSize: isMobile ? '1.5rem' : '1.9rem', margin: '0   ' }}>{t.subtitle}</p>
                </div>
            </div>

            {/* --- MAIN CONTENT CONTAINER --- */}
            <div style={{
                width: isMobile ? '95%' : '55%',
                maxWidth: isMobile ? '100%' : '55%',
                margin: '0 auto',
                padding: isMobile ? '10px' : '20px',
                boxSizing: 'border-box'
            }}>

                {/* ROW 1: Title (Far Left) */}
                <div style={{ marginBottom: 15, textAlign: 'left' }}>
                    <h3 style={{ margin: 0, fontSize: isMobile ? '1.1rem' : '1.3rem' }}>{t.latestAnn}</h3>
                </div>

                {/* ROW 2: Cards (News + Agents) */}
                <div style={{
                    display: 'flex',
                    flexDirection: isMobile ? 'column' : 'row',
                    gap: isMobile ? '4px' : '8px',
                    alignItems: 'stretch'
                }}>

                    {/* LEFT: News Card */}
                    <div style={{ flex: '9', width: '100%', minWidth: 0 }}>
                        {loading ? (
                            <AnnouncementSkeleton />
                        ) : announcements.length > 0 ? (
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
                                        borderRadius: '4px',
                                        height: '100%',
                                        minHeight: isMobile ? '100px' : 'auto',
                                        boxSizing: 'border-box',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        justifyContent: 'center',
                                        width: '100%',
                                        padding: '15px'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                                    onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                                >
                                    <small style={{ color: '#666', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '5px' }}>
                                        {a.is_important && <AlertTriangle size={24} color="#f57c00" />} {formatDate(a.date)}
                                    </small>
                                    <p style={{
                                        fontWeight: a.is_important ? '600' : '400',
                                        color: '#333',
                                        margin: 0,
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        textAlign: "left",
                                        fontSize: isMobile ? '1rem' : 'inherit'
                                    }}>
                                        {a.text}
                                    </p>
                                </div>
                            ))
                        ) : (
                            <div className="news-card" style={{ textAlign: 'center', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '85px', borderRadius: '4px', width: '100%' }}>
                                {t.noAnn}
                            </div>
                        )}
                    </div>

                    {/* RIGHT: Agents Card (Button on Mobile) */}
                    <div
                        onClick={handleOpenAgents}
                        style={{
                            flex: '1',
                            minWidth: isMobile ? '100%' : '140px',
                            background: 'white',
                            borderRight: isMobile ? 'none' : '5px solid #2196F3',
                            borderLeft: isMobile ? '5px solid #2196F3' : 'none',
                            borderRadius: '4px',
                            padding: '10px',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: isMobile ? 'row' : 'column',
                            justifyContent: isMobile ? 'flex-start' : 'center',
                            alignItems: 'center',
                            color: '#333',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                            transition: 'transform 0.2s',
                            minHeight: isMobile ? '60px' : '110px',
                            gap: isMobile ? '15px' : '0'
                        }}
                        onMouseEnter={e => {
                            if (!isMobile) {
                                e.currentTarget.style.transform = 'translateY(-2px)';
                                e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
                            }
                        }}
                        onMouseLeave={e => {
                            if (!isMobile) {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
                            }
                        }}
                    >
                        <Briefcase size={isMobile ? 24 : 28} style={{ marginBottom: isMobile ? '0' : '8px', color: '#2196F3', opacity: 0.9 }} />
                        <h3 style={{ margin: '0', fontSize: '0.9rem', textAlign: 'center', fontWeight: '600' }}>{t.agents}</h3>
                    </div>

                </div>

                {/* ROW 3: Button (Far Left) */}
                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-start' }}>
                    <button
                        className="small-btn secondary"
                        onClick={() => onNavigate('announcements')}
                        style={{ padding: '8px 12px', fontSize: '0.8rem', height: 'auto' }}
                    >
                        {t.more}
                    </button>
                </div>

            </div>

            {/* --- ANNOUNCEMENT MODAL --- */}
            {selectedAnn && (
                <div className="modal-overlay" onClick={() => setSelectedAnn(null)} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ background: 'white', padding: isMobile ? '20px' : '30px', borderRadius: 12, maxWidth: 600, width: '90%', position: 'relative', maxHeight: '80vh', overflowY: 'auto' }}>
                        <button onClick={() => setSelectedAnn(null)} style={{ position: 'absolute', top: 15, right: 15, background: 'none', border: 'none', cursor: 'pointer' }}><X size={24} color="#666" /></button>
                        <div style={{ borderBottom: '1px solid #eee', paddingBottom: 15, marginBottom: 20 }}>
                            <small style={{ color: '#666', display: 'block', marginBottom: 5 }}>{formatDate(selectedAnn.date)}</small>
                            <h2 style={{
                                height: "100%",
                                margin: isMobile ? "10px 0" : "20px",
                                color: selectedAnn.is_important ? '#e65100' : '#002F6C',
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 10,
                                overflow: 'normal',
                                lineHeight: 1.4,
                                fontSize: isMobile ? '1.2rem' : '1.5rem'
                            }}>
                                {selectedAnn.is_important && <AlertTriangle size={24} style={{ flexShrink: 0, marginTop: 4 }} />}
                                {selectedAnn.text}
                            </h2>
                        </div>
                        <div style={{ fontSize: isMobile ? '1rem' : '1.1rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#333' }}>{selectedAnn.body || (language === 'en' ? "No additional text." : "Δεν υπάρχει επιπλέον κείμενο.")}</div>
                    </div>
                </div>
            )}

            {/* --- AGENTS MODAL --- */}
            {showAgents && (
                <div className="modal-overlay" onClick={() => setShowAgents(false)} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ background: '#f9fafb', padding: 0, borderRadius: 12, maxWidth: 600, width: isMobile ? '95%' : '90%', position: 'relative', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

                        {/* Modal Header */}
                        <div style={{
                            padding: '20px',
                            background: '#002F6C',
                            position: 'relative',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center'
                        }}>
                            {/* Close Button */}
                            <button
                                onClick={() => setShowAgents(false)}
                                style={{
                                    position: 'absolute',
                                    right: '15px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: '#E3F2FD'
                                }}
                            >
                                <X size={24} />
                            </button>

                            <div style={{ textAlign: 'center' }}>
                                <h2 style={{
                                    margin: 0,
                                    fontSize: isMobile ? '1.2rem' : '1.4rem',
                                    color: '#90CAF9',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '10px'
                                }}>
                                    <Briefcase size={24} /> {t.agents}
                                </h2>
                                <p style={{ margin: '5px 0 0 0', fontSize: '0.8rem', color: '#E3F2FD', opacity: 0.9 }}>{t.randomOrder}</p>
                            </div>
                        </div>

                        {/* Modal Body */}
                        <div style={{ overflowY: 'auto', padding: isMobile ? '10px' : '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {agentsLoading ? (
                                <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>{t.loading}</div>
                            ) : randomAgents.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>{t.noAgents}</div>
                            ) : (
                                randomAgents.map(agent => (
                                    <div key={agent.id} style={{ background: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                                        {/* Card Header (Clickable) */}
                                        <div
                                            onClick={() => toggleAgent(agent.id)}
                                            style={{ padding: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: expandedAgentId === agent.id ? '#f0f7ff' : 'white' }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                                <div style={{ width: 40, height: 40, background: '#e3f2fd', color: '#1976d2', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                                                    {agent.surname.charAt(0)}
                                                </div>
                                                <div>
                                                    <h3 style={{ margin: 0, fontSize: '1rem', color: '#333' }}>{agent.surname} {agent.name}</h3>
                                                    <small style={{ color: '#666' }}>{agent.company}</small>
                                                </div>
                                            </div>
                                            {expandedAgentId === agent.id ? <ChevronUp size={20} color="#666" /> : <ChevronDown size={20} color="#666" />}
                                        </div>

                                        {/* Card Details (Collapsible) */}
                                        {expandedAgentId === agent.id && (
                                            <div style={{ padding: '0 15px 15px 15px', borderTop: '1px solid #f0f0f0', marginTop: '-1px' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '15px' }}>

                                                    {/* PHONE: Now Clickable */}
                                                    <a
                                                        href={`tel:${agent.phone}`}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '10px',
                                                            color: '#555',
                                                            fontSize: '0.95rem',
                                                            textDecoration: 'none'
                                                        }}
                                                    >
                                                        <Phone size={16} color="#1976d2" /> {agent.phone}
                                                    </a>

                                                    {/* EMAIL: Fixed Overflow & Size */}
                                                    {agent.email && (
                                                        <div style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '10px',
                                                            color: '#555',
                                                            // Reduced size on mobile, standard on desktop
                                                            fontSize: isMobile ? '0.8rem' : '0.95rem',
                                                            // Ensure text breaks to next line if too long
                                                            wordBreak: 'break-all',
                                                            overflowWrap: 'anywhere'
                                                        }}>
                                                            {/* Icon stays fixed size */}
                                                            <Mail size={16} color="#1976d2" style={{ flexShrink: 0 }} />
                                                            {agent.email}
                                                        </div>
                                                    )}
                                                    {agent.address && (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#555', fontSize: '0.95rem' }}>
                                                            <MapPin size={16} color="#1976d2" /> {agent.address}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* --- SEAMLESS FOOTER --- */}
            <footer style={{
                position: 'absolute',
                bottom: 0,
                width: '100%',
                textAlign: 'center',
                padding: '15px 0',
                background: 'transparent',
                color: '#888',
                fontSize: '0.8rem',
                border: 'none'
            }}>
                <span>&copy; {new Date().getFullYear()} {t.footerRights} &nbsp;|&nbsp; </span>
                <button
                    onClick={() => setShowTerms(true)}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: '#002F6C',
                        textDecoration: 'none',
                        cursor: 'pointer',
                        fontSize: 'inherit',
                        padding: 0,
                        fontWeight: '500'
                    }}
                    onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                    onMouseLeave={e => e.target.style.textDecoration = 'none'}
                >
                    {t.terms}
                </button>
            </footer>

            {/* --- TERMS OF USE MODAL --- */}
            {showTerms && (
                <div className="modal-overlay" onClick={() => setShowTerms(false)} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ background: 'white', padding: '30px', borderRadius: 12, maxWidth: 500, width: '90%', position: 'relative' }}>
                        <button onClick={() => setShowTerms(false)} style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} color="#666" /></button>
                        <h3 style={{ marginTop: 0, marginBottom: 15, color: '#002F6C' }}>{t.termsTitle}</h3>
                        <p style={{ lineHeight: 1.6, color: '#333', textAlign: 'justify', fontSize: '0.95rem' }}>
                            {t.termsBody}
                        </p>
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
        <div className="welcome-container" style={{ overflow: 'auto', height: 'auto', minHeight: '100vh' }}>
            <header className="public-header">
                <button className="back-btn" onClick={() => onNavigate('welcome')}>← Πίσω</button>
            </header>
            <div className="news-section" style={{ marginTop: 40, maxWidth: 800, margin: '40px auto', padding: '0 20px' }}>
                <h2 style={{ color: '#002F6C', borderBottom: '2px solid #eee', paddingBottom: 10 }}>Αρχείο Ανακοινώσεων</h2>
                {loading ? <><AnnouncementSkeleton /><AnnouncementSkeleton /></> : list.map(a => (
                    <div key={a.id} className="news-card" onClick={() => setSelectedAnn(a)} style={{ cursor: 'pointer', background: a.is_important ? '#fffde7' : 'white', borderLeft: a.is_important ? '5px solid #ff9800' : '5px solid #2196F3' }}>
                        <small style={{ display: 'flex', alignItems: 'center', gap: 5 }}>{a.is_important && <AlertTriangle size={24} color="#f57c00" />}{formatDate(a.date)}</small>
                        <p style={{ fontWeight: a.is_important ? '600' : '400' }}>{a.text}</p>
                    </div>
                ))}
            </div>
            {selectedAnn && (
                <div className="modal-overlay" onClick={() => setSelectedAnn(null)} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ background: 'white', padding: 30, borderRadius: 12, maxWidth: 600, width: '90%', position: 'relative', maxHeight: '80vh', overflowY: 'auto' }}>
                        <button onClick={() => setSelectedAnn(null)} style={{ position: 'absolute', top: 15, right: 15, background: 'none', border: 'none', cursor: 'pointer' }}><X size={24} color="#666" /></button>
                        <div style={{ borderBottom: '1px solid #eee', paddingBottom: 15, marginBottom: 20 }}>
                            <small style={{ color: '#666', display: 'block', marginBottom: 5 }}>{formatDate(selectedAnn.date)}</small>
                            <h2 style={{ margin: 0, color: selectedAnn.is_important ? '#e65100' : '#002F6C', display: 'flex', alignItems: 'center', gap: 10 }}>{selectedAnn.is_important && <AlertTriangle size={24} />}{selectedAnn.text}</h2>
                        </div>
                        <div style={{ fontSize: '1.1rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#333' }}>{selectedAnn.body || "Δεν υπάρχει επιπλέον κείμενο."}</div>
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

    // --- HELPER: HANDSHAKE WITH FLASK ---
    const secureBackendSession = async () => {
        try {
            console.log("Syncing session with Backend...");

            // 1. Get current session token
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error("No session found");

            // 2. Use 'api' instance instead of raw axios
            // We still pass 'withCredentials: true' to allow the browser to save the cookie
            await api.post('/api/auth/session',
                { access_token: session.access_token },
                { withCredentials: true }
            );

            console.log("Backend Session Secured via Cookie.");
        } catch (err) {
            console.error("Backend Sync Failed:", err);
            // Non-blocking error logging
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            if (!needs2FA) {
                // PHASE 1: PASSWORD LOGIN
                console.log("Attempting Password Login...");
                const { error } = await supabase.auth.signInWithPassword({
                    email: email,
                    password: password,
                });

                if (error) throw error;

                // CHECK FOR 2FA
                const { data: factors } = await supabase.auth.mfa.listFactors();
                const totpFactor = factors?.totp?.find(f => f.status === 'verified');

                if (totpFactor) {
                    setFactorId(totpFactor.id);
                    setNeeds2FA(true);
                    setLoading(false);
                    return;
                }

                // SUCCESS -> SECURE SESSION
                await secureBackendSession();

            } else {
                // PHASE 2: VERIFY 2FA CODE
                console.log("Verifying 2FA Code...");
                const { error } = await supabase.auth.mfa.challengeAndVerify({
                    factorId: factorId,
                    code: token2FA,
                });

                if (error) throw error;

                // SUCCESS -> SECURE SESSION
                await secureBackendSession();
            }

            // LOGIN COMPLETE
            // Depending on your routing, you might need to force a reload or redirect here
            // window.location.reload(); 

        } catch (err) {
            console.error("Login Error:", err);
            setError(err.message === "Invalid login credentials" ? "Λάθος στοιχεία" : "Σφάλμα: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-wrapper">
            <button className="back-btn" onClick={onBack}>← Πίσω</button>
            <div className="login-box">
                <img src="/aade-logo.png" style={{ height: 60 }} alt="Logo" />

                <h2>{needs2FA ? 'Έλεγχος 2FA' : 'Είσοδος'}</h2>

                {error && <div style={{ background: '#ffebee', color: '#c62828', padding: '10px', borderRadius: '4px', marginBottom: '10px', fontSize: '0.9rem' }}>{error}</div>}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
                    {!needs2FA ? (
                        <>
                            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" required style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} />
                            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Κωδικός" required style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} />
                        </>
                    ) : (
                        <>
                            <p style={{ textAlign: 'center', marginBottom: 5, fontSize: '0.9rem', color: '#555' }}>Εισάγετε τον 6ψήφιο κωδικό.</p>
                            <input type="text" maxLength="6" value={token2FA} onChange={e => setToken2FA(e.target.value)} placeholder="000000" required autoFocus autoComplete="one-time-code" style={{ padding: '15px', borderRadius: '8px', border: '2px solid #002F6C', textAlign: 'center', fontSize: '1.5rem', letterSpacing: '8px', fontWeight: 'bold' }} />
                        </>
                    )}
                    <button type="submit" disabled={loading} style={{ marginTop: '10px', padding: '10px', background: loading ? '#ccc' : '#002F6C', color: 'white', border: 'none', borderRadius: '4px', cursor: loading ? 'default' : 'pointer' }}>{loading ? 'Έλεγχος...' : (needs2FA ? 'Επιβεβαίωση' : 'Σύνδεση')}</button>
                </form>
            </div>
        </div>
    );
};