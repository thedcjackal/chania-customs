import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api/axios';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { API_URL } from '../config';
import { AppHeader, formatDate } from '../components/Layout';

import {
    Plus, Calendar, Truck, Anchor,
    CreditCard, Printer, Lock, Unlock,
    Trash2, Edit2, AlertCircle, AlertTriangle, FileText, User, Users, Settings, Droplet, Building2, X, Maximize, Loader, ChevronDown, Search,
    Hash, DoorOpen
} from 'lucide-react';

// --- STYLES HELPER ---
const GlobalFuelStyles = () => (
    <style>{`
        /* Force App Header Margin to 0 */
        .app-header { margin-bottom: 0 !important; }

        @keyframes spin-animation { 
            0% { transform: rotate(0deg); } 
            100% { transform: rotate(360deg); } 
        }
        .spin-loader { 
            animation: spin-animation 1s linear infinite; 
            display: inline-block; 
        }
        
        /* Modern Input Styles */
        .modern-input {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            font-size: 0.95rem;
            color: #334155;
            transition: border-color 0.2s, box-shadow 0.2s;
            outline: none;
            background: #f8fafc;
        }
        .modern-input:focus {
            border-color: #002F6C;
            box-shadow: 0 0 0 3px rgba(0, 47, 108, 0.1);
            background: white;
        }
        .modern-label {
            display: block;
            font-weight: 600;
            margin-bottom: 6px;
            font-size: 0.85rem;
            color: #475569;
        }
        
        .action-btn { 
            padding: 8px 12px; 
            border-radius: 6px; 
            border: 1px solid #ddd; 
            background: white; 
            cursor: pointer; 
            display: flex; 
            align-items: center; 
            gap: 6px; 
            font-size: 0.9rem; 
            color: #333; 
        }
        .action-btn.pdf { color: #D32F2F; border-color: #ffcdd2; background: #ffebee; }
        .action-btn.locked { color: #1976D2; border-color: #bbdefb; background: #e3f2fd; }
        .action-btn.unlocked { color: #388E3C; border-color: #c8e6c9; background: #e8f5e9; }
        
        .primary-btn { 
            background: #002F6C; 
            color: white; 
            border: none; 
            border-radius: 6px; 
            padding: 10px 24px; 
            cursor: pointer; 
            font-weight: 500;
            font-size: 0.95rem;
            transition: background 0.2s;
        }
        .primary-btn:hover { background: #001e45; }
        
        .secondary-btn { 
            background: #f1f5f9; 
            color: #334155; 
            border: 1px solid #cbd5e1; 
            border-radius: 6px; 
            padding: 10px 24px; 
            cursor: pointer; 
            font-weight: 500;
            font-size: 0.95rem;
        }
        .secondary-btn:hover { background: #e2e8f0; }

        .date-shortcut-btn {
            background: #e0f2f1;
            color: #00695c;
            border: 1px solid #b2dfdb;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8rem;
            cursor: pointer;
            margin-right: 5px;
            margin-bottom: 5px;
            display: inline-block;
        }
        .date-shortcut-btn:hover { background: #b2dfdb; }

        .status-btn { padding: 8px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
        .status-btn.open { background: #E8F5E9; color: #2E7D32; }
        .status-btn.closed { background: #FFEBEE; color: #C62828; }

        /* Map Pin Pulse */
        .map-pin {
            width: 20px;
            height: 20px;
            background: #E53935;
            border: 2px solid white;
            border-radius: 50%;
            position: absolute;
            transform: translate(-50%, -50%);
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            pointer-events: none;
            z-index: 10;
        }

        /* Responsive Card Grid: Always 1fr to ensure full width rows */
        .card-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 15px;
            margin-top: 20px;
        }
        /* Override media query if needed or just keep it 1fr */
        @media (min-width: 768px) {
            .card-grid {
                grid-template-columns: 1fr; 
            }
        }
    `}</style>
);

// --- HELPER: CENTRALIZED SPINNER ---
const PageLoader = () => (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 50, width: '100%' }}>
        <Loader className="spin-loader" size={40} color="#002F6C" />
    </div>
);

// --- STYLES FOR MOBILE CARD VIEW ---
const MobileCard = ({ title, subtitle, status, onClick, children, actions, headerAction, style = {} }) => (
    <div onClick={onClick} style={{
        background: 'white',
        borderRadius: '12px',
        padding: '12px 16px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        border: '1px solid #f1f5f9',
        borderLeft: status === 'Οφειλή' ? '4px solid #EF4444' : (status ? '4px solid #10B981' : '4px solid #002F6C'),
        cursor: onClick ? 'pointer' : 'default',
        position: 'relative',
        transition: 'transform 0.2s, box-shadow 0.2s',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        ...style
    }}
        onMouseEnter={e => { if (onClick) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)'; } }}
        onMouseLeave={e => { if (onClick) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)'; } }}
    >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: (children || subtitle) ? 10 : 0 }}>
            <div>
                <h4 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#1e293b', fontWeight: 600 }}>{title}</h4>
                <p style={{ margin: 0, fontSize: '0.9rem', color: '#64748b' }}>{subtitle}</p>
            </div>
            {status && <span style={{
                fontSize: '0.75rem',
                padding: '4px 10px',
                borderRadius: '20px',
                background: status === 'Οφειλή' ? '#FEF2F2' : '#ECFDF5',
                color: status === 'Οφειλή' ? '#EF4444' : '#059669',
                fontWeight: '600',
                border: status === 'Οφειλή' ? '1px solid #FECACA' : '1px solid #A7F3D0'
            }}>{status}</span>}
            {headerAction && <div>{headerAction}</div>}
        </div>
        {(children || subtitle) && <div style={{ fontSize: '0.95rem', color: '#475569', flex: 1, marginBottom: actions ? 15 : 0 }}>
            {children}
        </div>}
        {actions && <div style={{ marginTop: 'auto', paddingTop: '15px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            {actions}
        </div>}
    </div>
);

const SettingsManager = () => {
    const [settings, setSettings] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get(`${API_URL}/admin/settings`).then(res => {
            const data = res.data || {};
            // Map backend fields (lock_days, lock_time) to frontend structure (lock_rules)
            if (!data.lock_rules) {
                data.lock_rules = {
                    days_before: data.lock_days || 0,
                    time: data.lock_time || '10:00'
                };
            }
            if (!data.weekly_schedule) data.weekly_schedule = {};
            setSettings(data);
        }).finally(() => setLoading(false));
    }, []);

    if (loading) return <PageLoader />;
    if (!settings) return <div style={{ padding: 20 }}>Σφάλμα φόρτωσης.</div>;

    const save = (s) => { setSettings(s); api.post(`${API_URL}/admin/settings`, s); };
    const days = ["Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο", "Κυριακή"];

    return (
        <div className="admin-section" style={{ padding: '15px' }}>
            <div className="split-panel flex-align" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '15px' }}>
                <h4 style={{ margin: 0, borderBottom: '1px solid #eee', paddingBottom: 5 }}>Κανόνες Κλειδώματος</h4>
                <div style={{ display: 'flex', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.8rem', color: '#666' }}>Ημέρες Πριν</label>
                        <input type="number" value={settings.lock_rules?.days_before || 0} onChange={e => { const s = { ...settings }; s.lock_rules.days_before = e.target.value; save(s) }} style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #ccc' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.8rem', color: '#666' }}>Ώρα (HH:MM)</label>
                        <input type="time" value={settings.lock_rules?.time || '10:00'} onChange={e => { const s = { ...settings }; s.lock_rules.time = e.target.value; save(s) }} style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #ccc' }} />
                    </div>
                </div>
            </div>

            <h4 style={{ marginTop: 20, borderBottom: '1px solid #eee', paddingBottom: 5 }}>Εβδομαδιαίο Πρόγραμμα</h4>
            <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: 10 }}>Ορίστε αν η υπηρεσία είναι ανοιχτή και το μέγιστο αριθμό κρατήσεων ανά ημέρα.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {days.map(d => (
                    <div key={d} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f9f9f9', padding: 12, borderRadius: 6 }}>
                        <span style={{ fontWeight: 600, minWidth: 100 }}>{d}</span>
                        <div style={{ display: 'flex', gap: 15, alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <label style={{ fontSize: '0.8rem', color: '#555' }}>Μέγ. Κρατήσεις:</label>
                                <input
                                    type="number"
                                    min="0"
                                    placeholder="∞"
                                    value={settings.weekly_schedule[d]?.limit || ''}
                                    onChange={e => { const s = { ...settings }; if (!s.weekly_schedule[d]) s.weekly_schedule[d] = {}; s.weekly_schedule[d].limit = parseInt(e.target.value) || null; save(s) }}
                                    style={{ width: 60, padding: 6, borderRadius: 4, border: '1px solid #ccc', textAlign: 'center' }}
                                />
                            </div>
                            <button className={`status-btn ${settings.weekly_schedule[d]?.open ? 'open' : 'closed'}`} onClick={() => { const s = { ...settings }; if (!s.weekly_schedule[d]) s.weekly_schedule[d] = {}; s.weekly_schedule[d].open = !s.weekly_schedule[d].open; save(s) }} style={{ minWidth: 90, padding: '6px 12px' }}>
                                {settings.weekly_schedule[d]?.open ? '✓ Ανοιχτή' : '✗ Κλειστή'}
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const DailyReport = ({ user }) => {
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [reservations, setReservations] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [isFinalized, setIsFinalized] = useState(false);
    const [assignMode, setAssignMode] = useState('');
    const [empA, setEmpA] = useState('');
    const [empB, setEmpB] = useState('');
    const [singleEmp, setSingleEmp] = useState('');
    const [viewRes, setViewRes] = useState(null);
    const [refs, setRefs] = useState({ fuel_types: [], companies: [] });
    const printRef = useRef();

    const [loading, setLoading] = useState(true);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const loadRes = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get(`${API_URL}/reservations?date=${date}`);
            const safeData = res.data.map(r => ({
                ...r,
                location: r.location || { x: r.location_x || 0, y: r.location_y || 0 }
            }));
            setReservations(safeData.sort((a, b) => b.location.x - a.location.x).map((r, i) => ({ ...r, sn: i + 1 })));
        } finally {
            setLoading(false);
        }
    }, [date]);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const [empRes, refRes, statusRes] = await Promise.all([
                    api.get(`${API_URL}/admin/employees`),
                    api.get(`${API_URL}/admin/reference`),
                    api.get(`${API_URL}/daily_status?date=${date}`)
                ]);
                setEmployees(empRes.data);
                setRefs(refRes.data);
                setIsFinalized(statusRes.data.finalized);
                await loadRes();
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [date, loadRes]);

    const handleAssign = async (id, name) => { await api.put(`${API_URL}/reservations`, { id, role: 'admin', updates: { assigned_employee: name } }); loadRes(); };
    const toggleFinalize = async () => { try { const ns = !isFinalized; await api.post(`${API_URL}/daily_status`, { date, finalized: ns }); setIsFinalized(ns); } catch (err) { alert("Error"); } };
    const runAssign = async () => { if (assignMode === 'single') { if (!singleEmp) return alert("Select Employee"); for (const r of reservations) await api.put(`${API_URL}/reservations`, { id: r.id, role: 'admin', updates: { assigned_employee: singleEmp } }); } else if (assignMode === 'split') { if (!empA || !empB) return alert("Select 2 Employees"); const groups = {}; reservations.forEach(r => { const k = `${r.supply_company || 'U'}|${r.fuel_type || 'U'}`; if (!groups[k]) groups[k] = []; groups[k].push(r); }); let maxKey = null; let maxSize = -1; Object.keys(groups).forEach(k => { if (groups[k].length > maxSize) { maxSize = groups[k].length; maxKey = k; } }); for (const r of reservations) { const k = `${r.supply_company || 'U'}|${r.fuel_type || 'U'}`; const emp = (k === maxKey ? empA : empB); await api.put(`${API_URL}/reservations`, { id: r.id, role: 'admin', updates: { assigned_employee: emp } }); } } setAssignMode(''); loadRes(); };
    const toggleDebt = async (r, action) => { const newFlags = action === 'remove' ? r.flags.filter(f => f !== 'Οφειλή') : [...r.flags, 'Οφειλή']; await api.put(`${API_URL}/reservations`, { id: r.id, role: 'admin', updates: { flags: newFlags } }); setViewRes({ ...viewRes, flags: newFlags }); loadRes(); };
    const saveChanges = async () => { await api.put(`${API_URL}/reservations`, { id: viewRes.id, role: 'admin', updates: viewRes }); setViewRes(null); loadRes(); };

    const handleMapClick = (e) => {
        if (isFinalized) return;
        const rect = e.target.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        setViewRes({ ...viewRes, location: { x, y } });
    };

    const generatePDF = async () => { if (!printRef.current) return; printRef.current.style.display = 'block'; const pdf = new jsPDF('l', 'mm', 'a4'); const pdfWidth = pdf.internal.pageSize.getWidth(); const employeesToPrint = [...new Set(reservations.map(r => r.assigned_employee || 'Unassigned'))]; for (let i = 0; i < employeesToPrint.length; i++) { const empElement = document.getElementById(`print-section-${i}`); if (empElement) { const canvas = await html2canvas(empElement, { scale: 2 }); const imgData = canvas.toDataURL('image/png'); const imgHeight = (canvas.height * pdfWidth) / canvas.width; if (i > 0) pdf.addPage(); pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgHeight); } } printRef.current.style.display = 'none'; pdf.save(`Report_${date}.pdf`); };

    return (
        <div className="admin-section" style={{ padding: isMobile ? '10px' : '20px' }}>
            <div className="control-bar-daily" style={{ flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center', gap: '15px' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'white', padding: 8, borderRadius: 8, border: '1px solid #eee' }}>
                    <Calendar size={20} color="#666" />
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ border: 'none', fontSize: '1rem', outline: 'none', width: '100%' }} />
                </div>
                <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 5 }}>
                    <button onClick={() => setAssignMode(assignMode === 'single' ? '' : 'single')} disabled={isFinalized} className={`action-btn ${isFinalized ? 'disabled' : ''}`} style={{ whiteSpace: 'nowrap' }}>
                        <User size={16} /> {isMobile ? "1" : "Ανάθεση σε 1"}
                    </button>
                    <button onClick={() => setAssignMode(assignMode === 'split' ? '' : 'split')} disabled={isFinalized} className={`action-btn ${isFinalized ? 'disabled' : ''}`} style={{ whiteSpace: 'nowrap' }}>
                        <Users size={16} /> {isMobile ? "2" : "Ανάθεση σε 2"}
                    </button>
                    <button onClick={toggleFinalize} className={`action-btn ${isFinalized ? 'locked' : 'unlocked'}`} style={{ whiteSpace: 'nowrap' }}>
                        {isFinalized ? <Lock size={16} /> : <Unlock size={16} />} {isFinalized ? (isMobile ? "Lock" : "Ξεκλείδωμα") : (isMobile ? "Final" : "Οριστικοποίηση")}
                    </button>
                    <button onClick={generatePDF} className="action-btn pdf" style={{ whiteSpace: 'nowrap' }}>
                        <Printer size={16} /> PDF
                    </button>
                </div>
            </div>

            {assignMode === 'single' && !isFinalized && (<div className="split-panel" style={{ flexDirection: isMobile ? 'column' : 'row' }}><label>Ανάθεση ΟΛΩΝ σε:</label><select onChange={e => setSingleEmp(e.target.value)} style={{ flex: 1, padding: 8 }}><option value="">Επιλογή...</option>{employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}</select><button onClick={runAssign} className="primary-btn">Εφαρμογή</button></div>)}
            {assignMode === 'split' && !isFinalized && (<div className="split-panel" style={{ flexDirection: isMobile ? 'column' : 'row' }}><select onChange={e => setEmpA(e.target.value)} style={{ flex: 1, padding: 8 }}><option value="">Υπάλληλος Α (Κύριος)</option>{employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}</select><select onChange={e => setEmpB(e.target.value)} style={{ flex: 1, padding: 8 }}><option value="">Υπάλληλος Β (Υπόλοιπα)</option>{employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}</select><button onClick={runAssign} className="primary-btn">Εφαρμογή</button></div>)}

            {loading ? <PageLoader /> : (
                isMobile ? (
                    <div style={{ marginTop: 20 }}>
                        {reservations.map(r => (
                            <MobileCard key={r.id} title={`${r.vessel} (${r.sn})`} subtitle={r.user_company} status={r.flags.includes('Οφειλή') ? 'Οφειλή' : ''} onClick={() => setViewRes(r)}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginTop: 5 }}>
                                    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}><Droplet size={14} color="#666" /> {r.fuel_type}</div>
                                    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}><Truck size={14} color="#666" /> {r.quantity}</div>
                                    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}><Building2 size={14} color="#666" /> {r.supply_company}</div>
                                </div>
                                <div style={{ marginTop: 10, borderTop: '1px solid #f0f0f0', paddingTop: 5 }}>
                                    <span style={{ fontSize: '0.8rem', color: '#888' }}>Ανάθεση:</span>
                                    <select value={r.assigned_employee || ''} disabled={isFinalized} onClick={e => e.stopPropagation()} onChange={(e) => handleAssign(r.id, e.target.value)} style={{ width: '100%', marginTop: 5, padding: 5, borderRadius: 4, border: '1px solid #ddd' }}><option value="">-- Επιλογή --</option>{employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}</select>
                                </div>
                            </MobileCard>
                        ))}
                    </div>
                ) : (
                    <table style={{ marginTop: 20 }}><thead><tr><th>#</th><th>Εταιρεία</th><th>Σκάφος</th><th>Καύσιμο</th><th>Ποσότητα</th><th>Σημάνσεις</th><th>Ανατέθηκε</th></tr></thead><tbody>{reservations.map(r => (<tr key={r.id} onClick={() => setViewRes(r)} style={{ cursor: 'pointer', background: viewRes?.id === r.id ? '#e3f2fd' : 'transparent' }}><td>{r.sn}</td><td>{r.user_company}</td><td>{r.vessel}</td><td>{r.fuel_type}</td><td>{r.quantity}</td><td style={{ color: 'red' }}>{r.flags.join(', ')}</td><td onClick={e => e.stopPropagation()}><select value={r.assigned_employee || ''} disabled={isFinalized} onChange={(e) => handleAssign(r.id, e.target.value)} style={{ padding: 5, borderRadius: 4, border: '1px solid #ddd' }}><option value="">Επιλογή...</option>{employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}</select></td></tr>))}</tbody></table>
                )
            )}

            {/* Modal */}
            {viewRes && (
                <div className="modal-overlay" onClick={() => setViewRes(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: isMobile ? '95%' : '800px', padding: 0 }}>
                        <div style={{ padding: 20, borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0 }}>Επεξεργασία #{viewRes.sn}</h3>
                            <button onClick={() => setViewRes(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={24} /></button>
                        </div>
                        <div style={{ padding: 20, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20, maxHeight: '70vh', overflowY: 'auto' }}>
                            <div className="form-group-vertical">
                                <label className="modern-label">Ημερομηνία</label><input type="date" disabled={isFinalized} value={viewRes.date} onChange={e => setViewRes({ ...viewRes, date: e.target.value })} className="modern-input" />
                                <label className="modern-label">Σκάφος</label><input disabled={isFinalized} value={viewRes.vessel} onChange={e => setViewRes({ ...viewRes, vessel: e.target.value })} className="modern-input" />
                                <label className="modern-label">Εταιρεία Χρήστη</label><input disabled={isFinalized} value={viewRes.user_company} onChange={e => setViewRes({ ...viewRes, user_company: e.target.value })} className="modern-input" />
                                <label className="modern-label">Εταιρεία Εφοδ.</label><select disabled={isFinalized} value={viewRes.supply_company} onChange={e => setViewRes({ ...viewRes, supply_company: e.target.value })} className="modern-input">{refs.companies.map(c => <option key={c}>{c}</option>)}</select>
                                <label className="modern-label">Καύσιμο</label><select disabled={isFinalized} value={viewRes.fuel_type} onChange={e => setViewRes({ ...viewRes, fuel_type: e.target.value })} className="modern-input">{refs.fuel_types.map(f => <option key={f}>{f}</option>)}</select>
                                <label className="modern-label">Ποσότητα</label><input type="number" disabled={isFinalized} value={viewRes.quantity} onChange={e => setViewRes({ ...viewRes, quantity: e.target.value })} className="modern-input" />
                                <label className="modern-label">Πληρωμή</label><select disabled={isFinalized} value={viewRes.payment_method} onChange={e => setViewRes({ ...viewRes, payment_method: e.target.value })} className="modern-input"><option>Ηλεκτρονικά</option><option>Δια ζώσης</option><option>MRN/Αριθμός Πρωτοκόλλου</option></select>
                                <label className="modern-label">MRN</label><input disabled={isFinalized} value={viewRes.mrn || ''} onChange={e => setViewRes({ ...viewRes, mrn: e.target.value })} className="modern-input" />
                                <div style={{ marginTop: 15 }}>{!isFinalized && (viewRes.flags.includes("Οφειλή") ? <button className="status-btn closed" onClick={() => toggleDebt(viewRes, 'remove')} style={{ width: '100%' }}>✅ Εξόφληση</button> : <button className="status-btn open" onClick={() => toggleDebt(viewRes, 'add')} style={{ width: '100%' }}>💰 + Οφειλή</button>)}</div>
                            </div>

                            <div className="map-wrapper" style={{ width: '100%', height: 'auto', borderRadius: 8, overflow: 'hidden', border: '2px solid #e2e8f0', position: 'relative' }}>
                                <div className="map-container" onClick={handleMapClick} style={{ width: '100%', height: '100%', position: 'relative', display: 'block' }}>
                                    <img src="/map-chania-old-town-L.jpg" className="modal-map-image" alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
                                    <div className="map-pin" style={{ left: `${viewRes.location.x}%`, top: `${viewRes.location.y}%` }} />
                                </div>
                            </div>
                        </div>
                        <div style={{ padding: 20, borderTop: '1px solid #eee', background: '#f9f9f9', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                            {!isFinalized && <button onClick={saveChanges} className="primary-btn">Αποθήκευση</button>}
                            <button className="secondary-btn" onClick={() => setViewRes(null)}>Κλείσιμο</button>
                        </div>
                    </div>
                </div>
            )}

            <div id="print-area" ref={printRef} style={{ display: 'none', width: '297mm' }}>{[...new Set(reservations.map(r => r.assigned_employee || 'Unassigned'))].map((emp, index) => (<div key={emp} id={`print-section-${index}`} style={{ padding: '20px', background: 'white', height: '210mm', boxSizing: 'border-box' }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}><img src="/aade-logo.png" style={{ height: '50px' }} alt="" /><h2>Πρόγραμμα Εφοδιασμού Σκαφών με Καύσιμα ({formatDate(date)})</h2></div><h3 style={{ background: '#002F6C', color: 'white', padding: '5px' }}>Υπάλληλος: {emp}</h3><table className="print-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt', tableLayout: 'fixed' }}><colgroup><col style={{ width: '5%' }} /><col style={{ width: '14%' }} /><col style={{ width: '14%' }} /><col style={{ width: '8%' }} /><col style={{ width: '14%' }} /><col style={{ width: '8%' }} /><col style={{ width: '10%' }} /><col style={{ width: '12%' }} /><col style={{ width: '15%' }} /></colgroup><thead><tr style={{ background: '#eee' }}><th style={{ padding: 5 }}>A/A</th><th style={{ padding: 5 }}>Εταιρεία</th><th style={{ padding: 5 }}>Σκάφος</th><th style={{ padding: 5 }}>Καύσιμο</th><th style={{ padding: 5 }}>Εφοδιάστρια<br />Εταιρεία</th><th style={{ padding: 5 }}>Ποσ.</th><th style={{ padding: 5 }}>Πληρωμή</th><th style={{ padding: 5 }}>MRN</th><th style={{ padding: 5 }}>Σημ.</th></tr></thead><tbody>{reservations.filter(r => (r.assigned_employee || 'Unassigned') === emp).map(r => (<tr key={r.id} style={{ borderBottom: '1px solid #ddd' }}><td style={{ padding: 5, verticalAlign: 'top' }}>{r.sn}</td><td style={{ padding: 5, verticalAlign: 'top', whiteSpace: 'normal', wordWrap: 'break-word' }}>{r.user_company}</td><td style={{ padding: 5, verticalAlign: 'top', whiteSpace: 'normal', wordWrap: 'break-word' }}>{r.vessel}</td><td style={{ padding: 5, verticalAlign: 'top', whiteSpace: 'normal', wordWrap: 'break-word' }}>{r.fuel_type.split('(')[0]}</td><td style={{ padding: 5, verticalAlign: 'top', whiteSpace: 'normal', wordWrap: 'break-word' }}>{r.supply_company}</td><td style={{ padding: 5, verticalAlign: 'top' }}>{r.quantity}</td><td style={{ padding: 5, verticalAlign: 'top', whiteSpace: 'normal', wordWrap: 'break-word' }}>{r.payment_method}</td><td style={{ padding: 5, verticalAlign: 'top', whiteSpace: 'normal', wordWrap: 'break-word' }}>{r.mrn}</td><td style={{ padding: 5, verticalAlign: 'top', color: 'red', whiteSpace: 'normal', wordWrap: 'break-word' }}>{r.flags.join(', ')}</td></tr>))}</tbody></table><div style={{ width: '100%', height: '350px', position: 'relative', overflow: 'hidden' }}><img src="/map-chania-old-town-L.jpg" style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />{reservations.filter(r => (r.assigned_employee || 'Unassigned') === emp).map(r => (<div key={r.id} style={{ position: 'absolute', left: `${r.location.x}%`, top: `${r.location.y}%`, width: 20, height: 20, background: 'red', borderRadius: '50%', color: 'white', display: 'flex', justifyContent: 'center', alignItems: 'center', fontWeight: 'bold', transform: 'translate(-50%,-50%)' }}>{r.sn}</div>))}</div></div>))}</div>
        </div>
    );
};

const DebtReport = () => {
    const [debts, setDebts] = useState([]);
    const [filter, setFilter] = useState('');
    const [loading, setLoading] = useState(true);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    useEffect(() => {
        load();
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const load = async () => {
        setLoading(true);
        try {
            const res = await api.get(`${API_URL}/reservations`);
            setDebts(res.data.filter(r => r.flags.includes("Οφειλή")));
        } finally {
            setLoading(false);
        }
    };
    const clear = async (r) => { if (!window.confirm("Εξόφληση;")) return; await api.put(`${API_URL}/reservations`, { id: r.id, role: 'admin', updates: { flags: r.flags.filter(f => f !== 'Οφειλή') } }); load(); };

    return (
        <div className="admin-section" style={{ padding: isMobile ? '10px' : '20px' }}>
            <div className="control-bar" style={{ background: 'white', padding: 10, borderRadius: 8, border: '1px solid #eee', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Search size={20} color="#64748b" />
                <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Αναζήτηση Εταιρείας..." style={{ flex: 1, padding: '8px 0', border: 'none', outline: 'none', fontSize: '1rem' }} />
            </div>
            {loading ? <PageLoader /> : (
                isMobile ? (
                    <div>
                        {debts.filter(d => d.user_company.toLowerCase().includes(filter.toLowerCase())).map(r => (
                            <MobileCard
                                key={r.id}
                                title={r.user_company}
                                subtitle={formatDate(r.date)}
                                status="Οφειλή"
                                actions={<button className="small-btn open" onClick={() => clear(r)}>Εξόφληση</button>}
                            >
                                <div style={{ display: 'flex', gap: 10 }}>
                                    <span><Droplet size={14} /> {r.fuel_type}</span>
                                    <span><Truck size={14} /> {r.quantity}</span>
                                </div>
                            </MobileCard>
                        ))}
                    </div>
                ) : (
                    <table><thead><tr><th>Ημερομηνία</th><th>Εταιρεία</th><th>Ποσότητα</th><th>Ενέργειες</th></tr></thead><tbody>{debts.filter(d => d.user_company.toLowerCase().includes(filter.toLowerCase())).map(r => <tr key={r.id}><td>{formatDate(r.date)}</td><td>{r.user_company}</td><td>{r.quantity}</td><td><button className="small-btn open" onClick={() => clear(r)}>Εξόφληση</button></td></tr>)}</tbody></table>
                )
            )}
        </div>
    );
};

// --- REUSABLE CUSTOM SELECT (With Icons in Options) ---
const CustomSelect = ({ value, onChange, options, placeholder, icon: Icon, getOptionIcon, disabled }) => {
    const [open, setOpen] = useState(false);

    // Determine the icon to show in the trigger button
    const TriggerIcon = getOptionIcon && value ? getOptionIcon(value) : Icon;

    // DEBUG:
    // console.log('CustomSelect Value:', value);
    // console.log('TriggerIcon determined:', TriggerIcon === Icon ? 'Default Icon' : TriggerIcon?.displayName || 'Custom Icon');

    return (
        <div style={{ position: 'relative', width: '100%' }}>
            {/* Trigger Button */}
            <div
                className={`modern-input ${disabled ? 'disabled' : ''}`}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px 10px 10px',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    background: disabled ? '#f5f5f5' : 'white',
                    opacity: disabled ? 0.7 : 1,
                    minHeight: '42px',
                    boxSizing: 'border-box'
                }}
                onClick={() => !disabled && setOpen(!open)}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: value ? '#334155' : '#94a3b8' }}>
                    {TriggerIcon && <TriggerIcon size={16} color={value ? '#002F6C' : '#64748b'} />}
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value || placeholder}</span>
                </div>
                <ChevronDown size={16} color="#cbd5e1" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
            </div>

            {/* Backdrop to close */}
            {open && <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 10 }} onClick={() => setOpen(false)} />}

            {/* Dropdown Options */}
            {open && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    width: '100%',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    background: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    marginTop: 5,
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                    zIndex: 20
                }}>
                    {options.length === 0 ? (
                        <div style={{ padding: 10, color: '#94a3b8', textAlign: 'center', fontSize: '0.9rem' }}>Δεν βρέθηκαν επιλογές</div>
                    ) : (
                        options.map(o => {
                            const OptionIcon = getOptionIcon ? getOptionIcon(o) : Icon;
                            return (
                                <div
                                    key={o}
                                    onClick={() => {
                                        // mimic native event
                                        onChange({ target: { value: o } });
                                        setOpen(false);
                                    }}
                                    style={{
                                        padding: '10px 12px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 10,
                                        cursor: 'pointer',
                                        transition: 'background 0.1s',
                                        background: value === o ? '#f0f9ff' : 'white',
                                        color: value === o ? '#0ea5e9' : '#334155',
                                        fontSize: '0.95rem'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                                    onMouseLeave={e => e.currentTarget.style.background = value === o ? '#f0f9ff' : 'white'}
                                >
                                    {OptionIcon && <OptionIcon size={16} style={{ opacity: value === o ? 1 : 0.7 }} />}
                                    {o}
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div >
    );
};

const ReservationForm = ({ user, existing, onSuccess, vessels }) => {
    const [form, setForm] = useState(() => {
        if (existing) {
            return { ...existing, location: existing.location || { x: existing.location_x || -1, y: existing.location_y || -1 } };
        }
        return {
            date: '', // Will be set by effect
            vessel: '',
            user_company: user.company || '',
            fuel_type: '',
            quantity: 0,
            payment_method: 'Ηλεκτρονικά',
            mrn: '',
            supply_company: '',
            location: { x: -1, y: -1 }
        };
    });

    const [refs, setRefs] = useState({ fuel_types: [], companies: [] });
    const [vesselMap, setVesselMap] = useState({});
    const [defaults, setDefaults] = useState({});
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [showFullscreenMap, setShowFullscreenMap] = useState(false);
    const [loadingDefaults, setLoadingDefaults] = useState(false);
    const [dateShortcuts, setDateShortcuts] = useState([]);
    const [quantityError, setQuantityError] = useState(false);
    const quantityRef = useRef(null);

    useEffect(() => {
        const init = async () => {
            // 1. Fetch Refs
            api.get(`${API_URL}/admin/reference`).then(r => setRefs(r.data));

            // 2. Fetch Vessel Map (if admin/staff) - optional, may not exist
            if (user.role !== 'fuel_user') {
                api.get(`${API_URL}/vessel_map`).then(res => setVesselMap(res.data)).catch(() => { });
            }

            // 3. Fetch Settings for Date Logic
            try {
                const sRes = await api.get(`${API_URL}/admin/settings`);
                const schedule = sRes.data?.weekly_schedule || {};

                // Helper to get Greek Day Name
                const days = ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"];
                const shortDays = ["Κυρ", "Δευ", "Τρι", "Τετ", "Πεμ", "Παρ", "Σαβ"];
                const months = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαΐ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];

                // Logic: Find next 3 available days
                let availableDays = [];
                let d = new Date();
                d.setDate(d.getDate() + 1); // Start from tomorrow

                // Safety break after 30 days
                let safety = 0;
                while (availableDays.length < 3 && safety < 30) {
                    const dayName = days[d.getDay()];
                    if (schedule[dayName]?.open) {
                        availableDays.push(new Date(d));
                    }
                    d.setDate(d.getDate() + 1);
                    safety++;
                }

                if (availableDays.length > 0 && !existing) {
                    // Set default date to first available
                    const defaultDate = availableDays[0].toISOString().split('T')[0];
                    setForm(prev => ({ ...prev, date: defaultDate }));

                    // Set Shortcuts for next 2
                    if (availableDays.length > 1) {
                        setDateShortcuts(availableDays.slice(1).map(dt => ({
                            val: dt.toISOString().split('T')[0],
                            label: `${shortDays[dt.getDay()]} ${dt.getDate()} ${months[dt.getMonth()]}`
                        })));
                    }
                }
            } catch (e) { console.error("Date Logic Error", e); }
        };
        init();

        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [user.role, existing]);

    // --- LAZY LOAD DEFAULTS ON VESSEL CHANGE ---
    const handleVesselChange = async (vesselName) => {
        setForm(prev => ({ ...prev, vessel: vesselName }));
        if (!existing && vesselName) {
            try {
                let currentDefaults = defaults;

                // For admin users, get defaults from vesselMap
                if (user.role !== 'fuel_user' && form.user_company && vesselMap[form.user_company]?.defaults) {
                    currentDefaults = vesselMap[form.user_company].defaults;
                }
                // For fuel users, load from API if not already loaded
                else if (user.role === 'fuel_user' && Object.keys(currentDefaults).length === 0) {
                    setLoadingDefaults(true);
                    try {
                        const res = await api.get(`${API_URL}/fuel/defaults`);
                        currentDefaults = res.data;
                        setDefaults(currentDefaults);
                    } catch (err) { console.error(err); }
                    finally { setLoadingDefaults(false); }
                }

                if (currentDefaults[vesselName]) {
                    const def = currentDefaults[vesselName];
                    setForm(prev => ({
                        ...prev,
                        fuel_type: def.fuel_type || '',
                        supply_company: def.supply_company || '',
                        payment_method: def.payment_method || 'Ηλεκτρονικά',
                        mrn: def.mrn || '',
                        location: (def.location && def.location.x > -1) ? def.location : prev.location
                    }));
                }
            } catch (err) { console.error(err); }
        }
    };



    const handleMapClick = (e) => {
        const rect = e.target.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        setForm({ ...form, location: { x, y } });
        if (showFullscreenMap) setShowFullscreenMap(false);
    };

    const [showLimitWarning, setShowLimitWarning] = useState(false);
    const [limitInfo, setLimitInfo] = useState(null);

    const onMapAreaClick = (e) => {
        if (isMobile && !showFullscreenMap) { e.stopPropagation(); setShowFullscreenMap(true); }
        else { handleMapClick(e); }
    };

    const checkLimitAndSubmit = async () => {
        if (!form.date || !form.vessel || !form.fuel_type || !form.supply_company) return alert("Συμπληρώστε όλα τα πεδία");
        if (form.location.x === -1) return alert("Επιλέξτε τοποθεσία στο χάρτη");

        // Quantity Validation
        if (!form.quantity || parseFloat(form.quantity) <= 0) {
            setQuantityError(true);
            setTimeout(() => {
                quantityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                quantityRef.current?.focus();
            }, 100);
            return;
        }

        // Check reservation limit (only for new reservations)
        if (!existing) {
            try {
                const res = await api.get(`${API_URL}/reservation_count?date=${form.date}`);
                if (res.data.is_over_limit) {
                    setLimitInfo(res.data);
                    setShowLimitWarning(true);
                    return;
                }
            } catch (e) { console.error("Limit check error", e); }
        }

        // Submit normally
        submitReservation(false);
    };

    const submitReservation = (overLimit = false) => {
        const payload = {
            ...form,
            quantity: Number(form.quantity),
            flags: overLimit ? ['over_limit'] : []
        };
        if (existing) {
            api.put(`${API_URL}/reservations?id=${existing.id}&role=${user.role}`, payload).then(onSuccess).catch(e => alert(e.response?.data?.error || "Error"));
        } else {
            api.post(`${API_URL}/reservations?role=${user.role}`, payload).then(onSuccess).catch(e => alert(e.response?.data?.error || "Error"));
        }
        setShowLimitWarning(false);
    };

    const availableVessels = (user.role !== 'fuel_user' && form.user_company) ? (vesselMap[form.user_company]?.vessels || []) : (vessels || user.vessels);

    return (
        <div style={{ padding: isMobile ? 15 : 25, background: 'white', borderRadius: 12, boxShadow: '0 4px 15px rgba(0,0,0,0.05)' }}>
            <h3 style={{ marginTop: 0, marginBottom: existing?.flags?.includes('over_limit') ? 10 : 20, color: '#002F6C', borderBottom: '1px solid #eee', paddingBottom: 10 }}>{existing ? 'Επεξεργασία' : 'Νέα Κράτηση'}</h3>

            {/* Over-limit Warning Banner */}
            {existing?.flags?.includes('over_limit') && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                    border: '2px solid #f59e0b',
                    borderRadius: 8,
                    padding: '12px 15px',
                    marginBottom: 20
                }}>
                    <AlertTriangle size={24} color="#f59e0b" style={{ flexShrink: 0 }} />
                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#92400e', lineHeight: 1.4 }}>
                        Η κράτησή σας θα εξυπηρετηθεί αλλά μπορεί να έχει αυξημένο κόστος λόγω πιθανής απασχόλησης άνω του ενός υπαλλήλου. Μπορείτε να κάνετε κράτηση για μία άλλη ημέρα.
                    </p>
                </div>
            )}

            <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20 }}>
                {/* --- LEFT COLUMN: DATE & QTY --- */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                    <div className="form-group">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                            <label className="modern-label">Ημερομηνία</label>
                            {/* Date Shortcuts */}
                            {!existing && dateShortcuts.length > 0 && (
                                <div style={{ marginBottom: 2 }}>
                                    {dateShortcuts.map(ds => (
                                        <button key={ds.val} className="date-shortcut-btn" onClick={() => setForm({ ...form, date: ds.val })}>
                                            {ds.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} disabled={!!existing} className="modern-input" />
                    </div>

                    <div className="form-group">
                        <label className="modern-label">Ποσότητα (Λίτρα)</label>
                        <input
                            ref={quantityRef}
                            type="number"
                            value={form.quantity}
                            onChange={e => {
                                setForm({ ...form, quantity: e.target.value });
                                if (parseFloat(e.target.value) > 0) setQuantityError(false);
                            }}
                            className={`modern-input ${quantityError ? 'error-border' : ''}`}
                            style={quantityError ? { borderColor: '#ef4444' } : {}}
                        />
                        {quantityError && (
                            <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <AlertCircle size={14} />
                                <span>Η ποσότητα πρέπει να είναι μεγαλύτερη από 0</span>
                            </div>

                        )}
                    </div>
                </div>

                {/* --- RIGHT COLUMN: VESSEL & DETAILS --- */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                    {/* ... (rest of right column) ... */}
                    {user.role !== 'fuel_user' ? (
                        <>
                            <div className="form-group"><label className="modern-label">Εταιρεία Συναλλασσόμενου</label><CustomSelect value={form.user_company} onChange={e => setForm({ ...form, user_company: e.target.value, vessel: '' })} options={Object.keys(vesselMap)} placeholder="Επιλογή..." icon={Building2} /></div>
                            <div className="form-group">
                                <label className="modern-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>Σκάφος {loadingDefaults && <Loader className="spin-loader" size={14} color="#002F6C" />}</label>
                                <CustomSelect value={form.vessel} onChange={e => handleVesselChange(e.target.value)} options={availableVessels} placeholder="Επιλογή..." icon={Anchor} disabled={!form.user_company} />
                            </div>
                        </>
                    ) : (
                        <div className="form-group">
                            <label className="modern-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>Σκάφος {loadingDefaults && <Loader className="spin-loader" size={14} color="#002F6C" />}</label>
                            <CustomSelect value={form.vessel} onChange={e => handleVesselChange(e.target.value)} options={availableVessels} placeholder="Επιλογή..." icon={Anchor} />
                        </div>
                    )}

                    <div className="form-group"><label className="modern-label">Καύσιμο</label><CustomSelect value={form.fuel_type} onChange={e => setForm({ ...form, fuel_type: e.target.value })} options={refs.fuel_types} placeholder="Επιλογή..." icon={Droplet} /></div>
                    <div className="form-group"><label className="modern-label">Εταιρεία Εφοδ.</label><CustomSelect value={form.supply_company} onChange={e => setForm({ ...form, supply_company: e.target.value })} options={refs.companies} placeholder="Επιλογή..." icon={Building2} /></div>
                    <div className="form-group">
                        <label className="modern-label">Τρόπος Πληρωμής</label>
                        <CustomSelect
                            value={form.payment_method}
                            onChange={e => setForm({ ...form, payment_method: e.target.value })}
                            options={['Ηλεκτρονικά', 'Δια ζώσης', 'MRN/Αριθμός Πρωτοκόλλου']}
                            placeholder="Επιλογή..."
                            icon={CreditCard}
                            getOptionIcon={(opt) => {
                                if (opt === 'Δια ζώσης' || opt.includes('ζώσης')) return DoorOpen;
                                if (opt === 'MRN/Αριθμός Πρωτοκόλλου' || opt.includes('MRN')) return Hash;
                                return CreditCard;
                            }}
                        />
                    </div>
                    <div className="form-group"><label className="modern-label">MRN/Πρωτόκολλο</label><input value={form.mrn} onChange={e => setForm({ ...form, mrn: e.target.value })} className="modern-input" /></div>
                </div>
            </div>

            {/* --- ACTION BUTTONS (ABOVE MAP) --- */}
            <div style={{ marginTop: 25, marginBottom: 15, display: 'flex', gap: 15, justifyContent: isMobile ? 'stretch' : 'flex-end' }}>
                <button onClick={onSuccess} className="secondary-btn" style={{ flex: isMobile ? 1 : '0 0 auto' }}>Ακύρωση</button>
                <button onClick={checkLimitAndSubmit} className="primary-btn" style={{ flex: isMobile ? 1 : '0 0 auto', background: '#002F6C', color: 'white', border: 'none', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
                    {existing ? 'Αποθήκευση' : 'Υποβολή'}
                </button>
            </div>

            {/* --- MAP SECTION (FIXED ASPECT RATIO) --- */}
            <div className="map-wrapper" style={{ width: '100%', height: 'auto', borderRadius: 8, overflow: 'hidden', border: '2px solid #e2e8f0', position: 'relative' }}>
                <div className="map-container" onClick={onMapAreaClick} style={{ width: '100%', position: 'relative', display: 'block' }}>
                    {/* FIXED: width 100%, height auto to preserve aspect ratio */}
                    <img src="/map-chania-old-town-L.jpg" className="map-image" alt="map" style={{ width: '100%', height: 'auto', display: 'block' }} />
                    {form.location.x > -1 && <div className="map-pin" style={{ left: `${form.location.x}%`, top: `${form.location.y}%` }} />}
                    {isMobile && (<div style={{ position: 'absolute', bottom: 10, right: 10, background: 'rgba(0,0,0,0.6)', color: 'white', padding: '5px 10px', borderRadius: 20, fontSize: '0.8rem', pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 5 }}><Maximize size={14} /> Μεγέθυνση</div>)}
                </div>
            </div>

            {/* Mobile Fullscreen Map */}
            {
                isMobile && showFullscreenMap && (
                    <div className="modal-overlay" style={{ zIndex: 9999, background: 'black', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                        {/* Map Container - limit max width/height to ensure it fits */}
                        <div className="map-container" onClick={handleMapClick} style={{ width: '100%', maxHeight: '80%', position: 'relative', display: 'flex', justifyContent: 'center' }}>
                            <img src="/map-chania-old-town-L.jpg" alt="map" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                            {/* Pin removed as per request */}
                        </div>
                        {/* Text below map */}
                        <div style={{ marginTop: 20, color: 'white', background: 'rgba(0,0,0,0.7)', padding: '10px 20px', borderRadius: 20 }}>
                            Πατήστε στο χάρτη για επιλογή
                        </div>
                    </div>
                )
            }


            {/* Limit Warning Modal */}
            {showLimitWarning && (
                <div className="modal-overlay" style={{ zIndex: 9999 }}>
                    <div className="modal-content" style={{ maxWidth: 450, padding: 25, textAlign: 'center' }}>
                        <div style={{ marginBottom: 20 }}>
                            <AlertCircle size={48} color="#f59e0b" style={{ marginBottom: 10 }} />
                            <h3 style={{ margin: 0, color: '#002F6C' }}>Προειδοποίηση Ορίου Κρατήσεων</h3>
                        </div>
                        <p style={{ color: '#555', marginBottom: 20, lineHeight: 1.6 }}>
                            Η ημερομηνία που επιλέξατε έχει ήδη <strong>{limitInfo?.count}</strong> κρατήσεις
                            (όριο: <strong>{limitInfo?.limit}</strong>).
                            <br /><br />
                            Η κράτησή σας θα εξυπηρετηθεί αλλά μπορεί να έχει αυξημένο κόστος λόγω πιθανής απασχόλησης άνω του ενός υπαλλήλου. Μπορείτε να κάνετε κράτηση για μία άλλη ημέρα.
                        </p>
                        <div style={{ display: 'flex', gap: 15, justifyContent: 'center' }}>
                            <button
                                onClick={() => setShowLimitWarning(false)}
                                className="secondary-btn"
                                style={{ padding: '10px 25px' }}
                            >
                                Ακύρωση
                            </button>
                            <button
                                onClick={() => submitReservation(true)}
                                className="primary-btn"
                                style={{ padding: '10px 25px', background: '#f59e0b', color: 'white', border: 'none' }}
                            >
                                Υποβολή Ούτως ή Άλλως
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <GlobalFuelStyles />
        </div >
    );
};

// ... [UserDashboard Component - UPDATED with Card Grid for all screens] ...
const UserDashboard = ({ user }) => {
    const [view, setView] = useState('list');
    const [list, setList] = useState([]);
    const [editItem, setEditItem] = useState(null);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [vessels, setVessels] = useState(user.vessels || []); // Local state
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get(`${API_URL}/reservations?company=${user.company}`);
            // Sort by date descending, then by over_limit flag (over_limit first within same day)
            const sorted = res.data.sort((a, b) => {
                const dateCompare = new Date(b.date) - new Date(a.date);
                if (dateCompare !== 0) return dateCompare;
                // Same date: show over_limit first
                const aOverLimit = a.flags?.includes('over_limit') ? 1 : 0;
                const bOverLimit = b.flags?.includes('over_limit') ? 1 : 0;
                return bOverLimit - aOverLimit;
            });
            setList(sorted);
        } finally {
            setLoading(false);
        }
    }, [user.company]);

    useEffect(() => {
        load();
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [load]);

    // Update local state when vessels change
    const updateUserVessels = (newVessels) => {
        user.vessels = newVessels;
        setVessels(newVessels);
    };

    const del = async (r) => { if (window.confirm("Delete?")) { try { await api.delete(`${API_URL}/reservations?id=${r.id}&role=fuel_user`); load(); } catch (e) { alert("Error"); } } };

    return (
        <div className="user-dash" style={{ padding: isMobile ? 10 : 20 }}>
            <div className="dash-header" style={{
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                gap: 10, marginBottom: 20
            }}>
                <button className={`tab-btn ${view === 'list' ? 'active' : ''}`} onClick={() => { setEditItem(null); setView('list'); }} style={{ justifyContent: 'center', padding: 12, display: 'flex', alignItems: 'center', gap: 8 }}><FileText size={18} /> Λίστα</button>
                <button className={`tab-btn ${view === 'new' ? 'active' : ''}`} onClick={() => { setEditItem(null); setView('new'); }} style={{ justifyContent: 'center', padding: 12, display: 'flex', alignItems: 'center', gap: 8 }}><Plus size={18} /> Νέα Κράτηση</button>
                <button className={`tab-btn ${view === 'vessels' ? 'active' : ''}`} onClick={() => setView('vessels')} style={{ justifyContent: 'center', padding: 12, display: 'flex', alignItems: 'center', gap: 8 }}><Anchor size={18} /> Σκάφη</button>
            </div>

            {view === 'list' && (
                loading ? <PageLoader /> : (
                    <div className="card-grid">
                        {list.map(r => {
                            const isOverLimit = r.flags?.includes('over_limit');
                            const warningText = "Η κράτησή σας θα εξυπηρετηθεί αλλά μπορεί να έχει αυξημένο κόστος λόγω πιθανής απασχόλησης άνω του ενός υπαλλήλου. Μπορείτε να κάνετε κράτηση για μία άλλη ημέρα.";

                            return (
                                <div
                                    key={r.id}
                                    title={isOverLimit ? warningText : undefined}
                                >
                                    <MobileCard
                                        title={`${r.vessel}`}
                                        subtitle={formatDate(r.date)}
                                        status={r.flags?.includes('Οφειλή') ? 'Οφειλή' : ''}
                                        style={isOverLimit ? {
                                            background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                                            boxShadow: '0 2px 8px rgba(245, 158, 11, 0.3)',
                                            border: '2px solid #f59e0b',
                                            borderLeft: '4px solid #f59e0b',
                                            overflow: 'hidden'
                                        } : {}}
                                    >
                                        {/* Watermark */}
                                        {isOverLimit && (
                                            <AlertTriangle
                                                size={80}
                                                color="rgba(245, 158, 11, 0.2)"
                                                style={{
                                                    position: 'absolute',
                                                    left: '50%',
                                                    top: '50%',
                                                    transform: 'translate(-50%, -50%)',
                                                    pointerEvents: 'none',
                                                    zIndex: 0
                                                }}
                                            />
                                        )}
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 5, flexWrap: 'wrap', gap: 10, position: 'relative', zIndex: 1 }}>
                                            <div style={{ display: 'flex', gap: 15, alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
                                                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}><Droplet size={14} color="#64748b" /> {r.fuel_type}</div>
                                                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}><Truck size={14} color="#64748b" /> {r.quantity} LT</div>
                                                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}><Building2 size={14} color="#64748b" /> {r.supply_company}</div>
                                            </div>

                                            <div style={{ display: 'flex', gap: 10 }}>
                                                <button className="small-btn" onClick={(e) => { e.stopPropagation(); setEditItem(r); setView('new'); }} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                                                    <Edit2 size={16} /> Επεξεργασία
                                                </button>
                                                <button className="small-btn danger" onClick={(e) => { e.stopPropagation(); del(r); }} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                                                    <Trash2 size={16} /> Διαγραφή
                                                </button>
                                            </div>
                                        </div>
                                    </MobileCard>
                                </div>
                            );
                        })}
                    </div>
                )
            )}
            {/* Pass vessels state to form and manager */}
            {view === 'new' && <ReservationForm user={user} existing={editItem} onSuccess={() => { setView('list'); load(); }} vessels={vessels} />}
            {view === 'vessels' && <VesselManager user={{ ...user, vessels: vessels }} onUpdate={updateUserVessels} />}
        </div>
    );
};

const VesselManager = ({ user, onUpdate }) => {
    const [newVessel, setNewVessel] = useState('');
    const add = async () => { if (!newVessel) return; const updated = [...user.vessels, newVessel]; const res = await api.post(`${API_URL}/user/vessels`, { id: user.id, vessels: updated }); onUpdate(res.data.vessels); setNewVessel(''); };
    const remove = async (v) => { if (!window.confirm("Delete?")) return; const updated = user.vessels.filter(item => item !== v); const res = await api.post(`${API_URL}/user/vessels`, { id: user.id, vessels: updated }); onUpdate(res.data.vessels); };
    return (
        <div className="admin-section" style={{ padding: 20 }}>
            <div className="control-bar" style={{ background: '#f8f9fa', padding: 15, borderRadius: 8, marginBottom: 20, display: 'flex', gap: 10 }}>
                <input value={newVessel} onChange={e => setNewVessel(e.target.value)} placeholder="Όνομα Σκάφους" className="modern-input" style={{ flex: 1 }} />
                <button onClick={add} className="primary-btn">Προσθήκη</button>
            </div>

            <div className="card-grid">
                {user.vessels.map(v => (
                    <MobileCard
                        key={v}
                        title={v}
                        headerAction={
                            <button className="small-btn danger" onClick={() => remove(v)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', fontSize: '0.8rem' }}>
                                <Trash2 size={14} />
                            </button>
                        }
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: '0.85rem' }}>
                            <Anchor size={14} /> Σκάφος
                        </div>
                    </MobileCard>
                ))}
            </div>
        </div>
    );
};

// --- 4. GENERIC REFERENCE MANAGER (Modern Style) ---
const FuelReferenceManager = ({ type, title, placeholder, icon: Icon }) => {
    const [list, setList] = useState([]);
    const [newItem, setNewItem] = useState('');
    const [loading, setLoading] = useState(true);

    const load = useCallback(() => {
        setLoading(true);
        api.get(`${API_URL}/admin/reference`)
            .then(res => setList(res.data[type] || []))
            .catch(err => console.error("Ref load error", err))
            .finally(() => setLoading(false));
    }, [type]);

    useEffect(() => {
        load();
    }, [load]);

    const add = async () => {
        if (!newItem) return;
        await api.post(`${API_URL}/admin/reference`, { type, value: newItem });
        setNewItem('');
        load();
    };

    const del = async (val) => {
        if (window.confirm("Διαγραφή;")) {
            await api.delete(`${API_URL}/admin/reference?type=${type}&value=${val}`);
            load();
        }
    };

    return (
        <div className="admin-section" style={{ padding: 20 }}>
            <div className="control-bar" style={{ background: '#f8f9fa', padding: 15, borderRadius: 8, marginBottom: 20, display: 'flex', gap: 10 }}>
                <input
                    value={newItem}
                    onChange={e => setNewItem(e.target.value)}
                    placeholder={placeholder}
                    className="modern-input"
                    style={{ flex: 1 }}
                />
                <button onClick={add} className="primary-btn">Προσθήκη</button>
            </div>

            {loading ? <PageLoader /> : (
                <div className="card-grid">
                    {list.map(v => (
                        <MobileCard
                            key={v}
                            title={v}
                            headerAction={
                                <button className="small-btn danger" onClick={() => del(v)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', fontSize: '0.8rem' }}>
                                    <Trash2 size={14} />
                                </button>
                            }
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: '0.85rem' }}>
                                {Icon && <Icon size={14} />} {title}
                            </div>
                        </MobileCard>
                    ))}
                </div>
            )}
        </div>
    );
};

// ================= 3. EXPORT =================
export const FuelApp = ({ user, onExit }) => {
    const [tab, setTab] = useState('overview');
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const isAdminOrStaff = ['admin', 'root_admin', 'staff'].includes(user.role);
    const isAdmin = ['admin', 'root_admin'].includes(user.role);

    // Services Tab Design
    const tabButtonStyle = {
        background: 'transparent',
        border: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        padding: '10px 15px',
        color: '#64748b',
        cursor: 'pointer',
        fontSize: '0.85rem',
        fontWeight: 500,
        position: 'relative',
        transition: 'all 0.2s ease',
        borderBottom: '2px solid transparent'
    };

    const activeTabButtonStyle = {
        ...tabButtonStyle,
        color: '#002F6C',
        fontWeight: 600,
        borderBottom: '2px solid #0EA5E9' // Light Blue (Sky 500)
    };

    return (
        <div className="app-shell" style={{ paddingBottom: 20 }}>
            <AppHeader title="Εφοδιασμοί" user={user} onExit={onExit} icon={<Anchor size={24} />} />
            {isAdminOrStaff ? (
                <>
                    <div className="tabs" style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 20, padding: '15px 10px' }}>
                        <button style={tab === 'overview' ? activeTabButtonStyle : tabButtonStyle} onClick={() => setTab('overview')}><Calendar size={20} /> <span>Πρόγραμμα</span></button>
                        <button style={tab === 'debts' ? activeTabButtonStyle : tabButtonStyle} onClick={() => setTab('debts')}><CreditCard size={20} /> <span>Οφειλές</span></button>
                        <button style={tab === 'new_res' ? activeTabButtonStyle : tabButtonStyle} onClick={() => setTab('new_res')}><Plus size={20} /> <span>Νέος Εφοδιασμός</span></button>
                        {isAdmin && (
                            <>
                                <button style={tab === 'comps' ? activeTabButtonStyle : tabButtonStyle} onClick={() => setTab('comps')}><Building2 size={20} /> <span>Εταιρείες Εφοδιασμού</span></button>
                                <button style={tab === 'fuel' ? activeTabButtonStyle : tabButtonStyle} onClick={() => setTab('fuel')}><Droplet size={20} /> <span>Καύσιμα</span></button>
                                <button style={tab === 'settings' ? activeTabButtonStyle : tabButtonStyle} onClick={() => setTab('settings')}><Settings size={20} /> <span>Ρυθμίσεις</span></button>
                            </>
                        )}
                    </div>
                    <div style={{ padding: isMobile ? '0 10px' : '0 20px' }}>
                        {tab === 'overview' && <DailyReport user={user} />}
                        {tab === 'debts' && <DebtReport />}
                        {tab === 'new_res' && <ReservationForm user={user} onSuccess={() => setTab('overview')} />}
                        {isAdmin && (
                            <>

                                {tab === 'comps' && <FuelReferenceManager type="companies" title="Εταιρεία Εφοδιασμού" placeholder="Νέα Εταιρεία Εφοδιασμού" icon={Building2} />}
                                {tab === 'fuel' && <FuelReferenceManager type="fuel_types" title="Καύσιμο" placeholder="Νέο Καύσιμο" icon={Droplet} />}
                                {tab === 'settings' && <SettingsManager />}
                            </>
                        )}
                    </div>
                </>
            ) : (<UserDashboard user={user} />)}
            <GlobalFuelStyles />
        </div>
    );
};