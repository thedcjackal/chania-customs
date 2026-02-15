import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api/axios';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { API_URL } from '../config';
import { AppHeader, formatDate, getDaysInMonth, getDayName } from '../components/Layout';
import {
    Calendar, Settings, Users, BarChart,
    Play, Save, Lock, AlertTriangle,
    Trash2, Plus, X, Printer, Edit2, Clock, Moon, Briefcase, Calendar as CalIcon, FileText, UserCheck, RefreshCw
} from 'lucide-react';

// --- HELPER: Name Formatter (J. Doe) ---
const formatName = (fullName) => {
    if (!fullName) return '';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    const firstInitial = parts[0][0].toUpperCase() + '.';
    const lastName = parts[parts.length - 1];
    return `${firstInitial} ${lastName}`;
};

// --- HELPER: Greek Uppercase without Accents ---
const toGreekUpper = (str) => {
    return str
        .normalize('NFD').replace(/[\u0300-\u036f]/g, "") // Remove accents
        .toUpperCase();
};

const isDateInActiveRange = (dateStr, range) => {
    if (!range || !range.start || !range.end) return true;
    const [, m, d] = dateStr.split('-').map(Number);
    const parseDM = (s) => {
        const p = s.split(/[-/.]/);
        return [parseInt(p[0]), parseInt(p[1])];
    }
    try {
        const [sD, sM] = parseDM(range.start);
        const [eD, eM] = parseDM(range.end);
        const current = new Date(2000, m - 1, d);
        const start = new Date(2000, sM - 1, sD);
        const end = new Date(2000, eM - 1, eD);
        current.setHours(0, 0, 0, 0); start.setHours(0, 0, 0, 0); end.setHours(0, 0, 0, 0);
        return start > end ? (current >= start || current <= end) : (current >= start && current <= end);
    } catch (e) { return true; }
};

// --- HELPER COMPONENT: Action Button with Hover ---
const ActionButton = ({ onClick, icon: Icon, label, color, hoverColor }) => {
    const [hover, setHover] = useState(false);
    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                background: hover ? hoverColor : color,
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                transition: 'background 0.2s ease',
                fontWeight: 500,
                fontSize: '0.9rem'
            }}
        >
            <Icon size={16} /> {label}
        </button>
    );
};

const QueueManager = ({ user }) => {
    const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
    const [queues, setQueues] = useState({ rotation_queues: {}, next_round_queues: {} });
    const [loading, setLoading] = useState(false);
    const [employees, setEmployees] = useState([]);

    const fetchEmployees = async () => {
        try {
            const res = await api.get(`${API_URL}/admin/employees`);
            setEmployees(res.data);
        } catch (error) {
            console.error("Failed to fetch employees", error);
        }
    };

    const fetchQueueState = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get(`${API_URL}/admin/queue_history?month=${month}`);
            setQueues(res.data);
        } catch (error) {
            console.error("Failed to fetch queues", error);
            setQueues({ rotation_queues: {}, next_round_queues: {} });
        } finally {
            setLoading(false);
        }
    }, [month]);

    useEffect(() => {
        fetchEmployees();
    }, []);

    useEffect(() => {
        fetchQueueState();
    }, [month, fetchQueueState]);

    const handleInit = async () => {
        if (!window.confirm("This will overwrite any existing queues for this month with a fresh default set. Continue?")) return;

        try {
            await api.post(`${API_URL}/admin/queue_init`, { month: month });

            alert("Queues Initialized!");
            fetchQueueState();
        } catch (error) {
            console.error("Failed to initialize queues", error);
            alert("Failed to initialize: " + (error.response?.data?.error || error.message));
        }
    };

    const handleSave = async () => {
        if (!window.confirm("Are you sure you want to save changes to the queue state?")) return;
        try {
            await api.post(`${API_URL}/admin/queue_history?month=` + month, queues);
            alert("Queue state saved successfully!");
        } catch (error) {
            alert("Failed to save: " + (error.response?.data?.error || error.message));
        }
    };

    const handleReset = async () => {
        if (!window.confirm("WARNING: This will DELETE the saved queue state for this month. The next scheduler run will use default initialization (Seniority Based). Continue?")) return;
        try {
            await api.delete(`${API_URL}/admin/queue_history?month=${month}`);
            alert("Queue state reset/deleted!");
            fetchQueueState();
        } catch (error) {
            alert("Failed to reset: " + (error.response?.data?.error || error.message));
        }
    };

    const moveItem = (queueType, queueName, fromIndex, toIndex) => {
        const list = [...(queues[queueType][queueName] || [])];
        const [removed] = list.splice(fromIndex, 1);
        list.splice(toIndex, 0, removed);
        setQueues({
            ...queues,
            [queueType]: {
                ...queues[queueType],
                [queueName]: list
            }
        });
    };

    const transferItem = (sourceType, targetType, queueName, empId) => {
        const sourceList = (queues[sourceType][queueName] || []).filter(id => id !== empId);
        const targetList = [...(queues[targetType][queueName] || []), empId];

        setQueues({
            ...queues,
            [sourceType]: { ...queues[sourceType], [queueName]: sourceList },
            [targetType]: { ...queues[targetType], [queueName]: targetList }
        });
    };

    const getName = (id) => employees.find(e => e.id === id)?.name || `Unknown (${id})`;

    return (
        <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto', fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>

            {/* GLOBAL LOADING RIBBON */}
            {loading && (
                <div style={{
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    background: 'white',
                    padding: '20px 40px',
                    borderRadius: '8px',
                    boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '15px',
                    pointerEvents: 'none' // Blocks clicks on itself, but we want to block clicks BEHIND it too.
                }}>
                    <div className="spinner" style={{
                        width: '24px',
                        height: '24px',
                        border: '3px solid #f3f3f3',
                        borderTop: '3px solid #002F6C',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                    }} />
                    <span style={{ fontWeight: 600, color: '#333' }}>Φόρτωση...</span>
                    <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                </div>
            )}

            {/* Global Overlay to block clicks interaction when loading */}
            {loading && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    zIndex: 9998,
                    cursor: 'wait'
                }} onClick={e => e.stopPropagation()} />
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2>Queue Management (Σειρές)</h2>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <input
                        type="month"
                        value={month}
                        onChange={e => setMonth(e.target.value)}
                        style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                    />
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <ActionButton icon={Play} label="Initialize Queues" color="#007bff" hoverColor="#0056b3" onClick={handleInit} />
                        <ActionButton icon={Save} label="Save Changes" color="#28a745" hoverColor="#218838" onClick={handleSave} />
                        <ActionButton icon={Trash2} label="Delete Queues" color="#dc3545" hoverColor="#c82333" onClick={handleReset} />
                    </div>
                </div>
            </div>

            {loading ? <p>Loading...</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {Object.keys(queues.rotation_queues || {}).sort().map(qName => (
                        <div key={qName} style={{ border: '1px solid #eee', borderRadius: '8px', padding: '15px', background: '#f9f9f9' }}>
                            <h3 style={{ margin: '0 0 10px 0', color: '#555' }}>{qName}</h3>
                            <div style={{ display: 'flex', gap: '20px' }}>
                                <div style={{ flex: 1 }}>
                                    <h4 style={{ fontSize: '0.9rem', color: '#4CAF50' }}>Current Round</h4>
                                    <ul style={{ listStyle: 'none', padding: 0, background: 'white', border: '1px solid #ddd', borderRadius: '4px', minHeight: '50px' }}>
                                        {(queues.rotation_queues[qName] || []).map((empId, idx) => (
                                            <li key={`${empId}-${idx}`} style={{ padding: '8px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span>{idx + 1}. {getName(empId)}</span>
                                                <div style={{ display: 'flex', gap: '5px' }}>
                                                    <button onClick={() => moveItem('rotation_queues', qName, idx, idx - 1)} disabled={idx === 0}>↑</button>
                                                    <button onClick={() => moveItem('rotation_queues', qName, idx, idx + 1)} disabled={idx === (queues.rotation_queues[qName].length - 1)}>↓</button>
                                                    <button onClick={() => transferItem('rotation_queues', 'next_round_queues', qName, empId)} title="Move to Next Round">→</button>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <h4 style={{ fontSize: '0.9rem', color: '#2196F3' }}>Next Round (Waiting)</h4>
                                    <ul style={{ listStyle: 'none', padding: 0, background: 'white', border: '1px solid #ddd', borderRadius: '4px', minHeight: '50px' }}>
                                        {(queues.next_round_queues[qName] || []).map((empId, idx) => (
                                            <li key={`${empId}-${idx}`} style={{ padding: '8px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span>{idx + 1}. {getName(empId)}</span>
                                                <div style={{ display: 'flex', gap: '5px' }}>
                                                    <button onClick={() => transferItem('next_round_queues', 'rotation_queues', qName, empId)} title="Move to Current">←</button>
                                                    <button onClick={() => moveItem('next_round_queues', qName, idx, idx - 1)} disabled={idx === 0}>↑</button>
                                                    <button onClick={() => moveItem('next_round_queues', qName, idx, idx + 1)} disabled={idx === (queues.next_round_queues[qName].length - 1)}>↓</button>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        </div>
                    ))}
                    {Object.keys(queues.rotation_queues || {}).length === 0 && (
                        <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
                            <p>No queue history found for {month}.</p>
                            <p style={{ fontSize: '0.8rem' }}>Run the scheduler for this month to generate queues, or Initialize manual history.</p>
                            <div style={{ background: '#eee', padding: 10, marginTop: 10, textAlign: 'left', fontSize: '0.7em', fontFamily: 'monospace' }}>
                                DEBUG: {JSON.stringify(queues).slice(0, 200)}...
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export const ServicesApp = ({ user, onExit }) => {
    const isAdmin = user.role === 'admin' || user.role === 'root_admin';
    const isRoot = user.role === 'root_admin';
    const [tab, setTab] = useState(isAdmin ? 'schedule' : 'myschedule');
    const [config, setConfig] = useState({ duties: [], special_dates: [], rotation_queues: {} });
    const [schedule, setSchedule] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [currentMonth, setCurrentMonth] = useState(() => {
        const saved = localStorage.getItem('services_currentMonth');
        return saved ? new Date(saved) : new Date();
    });
    const [modal, setModal] = useState(null);
    const [dutyForm, setDutyForm] = useState({});
    const [dutyEditMode, setDutyEditMode] = useState(null);
    const [myUnavail, setMyUnavail] = useState([]);
    const [schedulerLogs, setSchedulerLogs] = useState([]);
    const [balanceStats, setBalanceStats] = useState([]);
    const [balanceRange, setBalanceRange] = useState(() => {
        const saved = localStorage.getItem('services_balanceRange');
        if (saved) { try { return JSON.parse(saved); } catch (e) { } }
        return { start: new Date().toISOString().slice(0, 7), end: new Date().toISOString().slice(0, 7) };
    });
    const [showSpecialReport, setShowSpecialReport] = useState(false);
    const [specialReportData, setSpecialReportData] = useState([]);

    // Global Loading State
    const [loading, setLoading] = useState(false);

    // Axios Interceptors for Global Loading
    useEffect(() => {
        let reqInterceptor = api.interceptors.request.use(req => {
            setLoading(true);
            return req;
        }, err => {
            setLoading(false);
            return Promise.reject(err);
        });

        let resInterceptor = api.interceptors.response.use(res => {
            setLoading(false);
            return res;
        }, err => {
            setLoading(false);
            return Promise.reject(err);
        });

        return () => {
            api.interceptors.request.eject(reqInterceptor);
            api.interceptors.response.eject(resInterceptor);
        };
    }, []);

    // General Settings State
    const [generalSettings, setGeneralSettings] = useState({ declaration_deadline: 25, signee_name: '' });
    const [protocolData, setProtocolData] = useState({ protocol_num: '', protocol_date: '' });

    // Double Duty Preference State (User)
    const [doubleDutyPref, setDoubleDutyPref] = useState(false);

    // --- ADMIN DECLARATIONS STATE ---
    const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
    const [adminUnavail, setAdminUnavail] = useState([]);
    const [adminDoubleDutyPref, setAdminDoubleDutyPref] = useState(false);

    // New Special Date Input State
    const [newSpecialDate, setNewSpecialDate] = useState('');
    const [newSpecialDesc, setNewSpecialDesc] = useState('');
    const [isRecurring, setIsRecurring] = useState(false);

    // Drag & Drop State
    const [draggedItem, setDraggedItem] = useState(null);
    const [dragOverIndex, setDragOverIndex] = useState(null);

    const printRef1 = useRef();
    const printRef2 = useRef();
    const logsPrintRef = useRef();

    // Persist currentMonth and balanceRange to localStorage
    useEffect(() => { localStorage.setItem('services_currentMonth', currentMonth.toISOString()); }, [currentMonth]);
    useEffect(() => { localStorage.setItem('services_balanceRange', JSON.stringify(balanceRange)); }, [balanceRange]);

    // Use useCallback to memoize function so it can be a dependency
    const loadMyUnavailability = useCallback(async () => {
        const res = await api.get(`${API_URL}/services/unavailability?employee_id=${user.id}`);
        setMyUnavail(res.data);
    }, [user.id]);

    // --- ADMIN DECLARATION HELPERS ---
    // Use useCallback here as well
    const loadAdminUnavailability = useCallback(async (empId) => {
        if (!empId) return;
        try {
            const res = await api.get(`${API_URL}/services/unavailability?employee_id=${empId}`);
            setAdminUnavail(res.data);

            const mStr = currentMonth.toISOString().slice(0, 7);
            const prefRes = await api.get(`${API_URL}/services/preferences?user_id=${empId}&month=${mStr}`);
            setAdminDoubleDutyPref(prefRes.data.prefer_double_sk);
        } catch (e) { console.error(e); }
    }, [currentMonth]); // Depends on currentMonth for preference fetching

    const toggleAdminUnavailability = async (dateStr) => {
        if (!selectedEmployeeId) return;
        const exists = adminUnavail.find(u => u.date === dateStr);
        setAdminUnavail(prev => exists ? prev.filter(u => u.date !== dateStr) : [...prev, { date: dateStr, employee_id: selectedEmployeeId }]);

        if (exists) await api.delete(`${API_URL}/services/unavailability?employee_id=${selectedEmployeeId}&date=${dateStr}`);
        else await api.post(`${API_URL}/services/unavailability`, { employee_id: selectedEmployeeId, date: dateStr });

        loadAdminUnavailability(selectedEmployeeId);
    };

    const toggleAdminDoubleDutyPref = async () => {
        if (!selectedEmployeeId) return;
        const newVal = !adminDoubleDutyPref;
        setAdminDoubleDutyPref(newVal);
        const mStr = currentMonth.toISOString().slice(0, 7);
        try {
            await api.post(`${API_URL}/services/preferences`, {
                user_id: selectedEmployeeId,
                month: mStr,
                value: newVal
            });
        } catch (e) {
            alert("Σφάλμα αποθήκευσης.");
            setAdminDoubleDutyPref(!newVal);
        }
    };

    useEffect(() => {
        const fetchAll = async () => {
            try {
                const c = await api.get(`${API_URL}/admin/services/config`); setConfig(c.data);
                const s = await api.get(`${API_URL}/services/schedule`); setSchedule(s.data);
                const e = await api.get(`${API_URL}/admin/employees`); setEmployees(e.data);
                if (e.data.length > 0) setSelectedEmployeeId(e.data[0].id); // Default select first

                if (isAdmin) {
                    const setRes = await api.get(`${API_URL}/admin/settings`);
                    if (setRes.data) setGeneralSettings(prev => ({ ...prev, declaration_deadline: setRes.data.declaration_deadline || 25, signee_name: setRes.data.signee_name || '' }));
                } else {
                    try {
                        const setRes = await api.get(`${API_URL}/admin/settings`);
                        if (setRes.data) setGeneralSettings(prev => ({ ...prev, declaration_deadline: setRes.data.declaration_deadline || 25 }));
                    } catch (e) { }
                    loadMyUnavailability();
                }
            } catch (err) { console.error(err); }
        };
        fetchAll();
    }, [user.id, isAdmin, loadMyUnavailability]); // Added loadMyUnavailability to deps

    useEffect(() => {
        if (tab === 'balance' && isAdmin) {
            api.get(`${API_URL}/services/balance`, {
                params: {
                    start: balanceRange.start,
                    end: balanceRange.end
                }
            })
                .then(res => setBalanceStats(res.data))
                .catch(e => console.error(e));
        }
    }, [tab, schedule, isAdmin, balanceRange]);

    // Fetch Protocol Info when Month Changes
    useEffect(() => {
        if (isAdmin) {
            const mStr = currentMonth.toISOString().slice(0, 7);
            api.get(`${API_URL}/admin/schedule_metadata?month=${mStr}`)
                .then(res => setProtocolData({ protocol_num: res.data.protocol_num || '', protocol_date: res.data.protocol_date || '' }))
                .catch(() => setProtocolData({ protocol_num: '', protocol_date: '' }));
        }
    }, [currentMonth, isAdmin]);

    // Fetch Preferences when month changes or tab changes
    useEffect(() => {
        if ((tab === 'declare' || tab === 'myschedule') && !isAdmin) {
            const mStr = currentMonth.toISOString().slice(0, 7);
            api.get(`${API_URL}/services/preferences?user_id=${user.id}&month=${mStr}`)
                .then(res => setDoubleDutyPref(res.data.prefer_double_sk))
                .catch(e => console.error(e));
        }
        // Admin Tab Logic
        if (tab === 'admin_declare' && isAdmin && selectedEmployeeId) {
            loadAdminUnavailability(selectedEmployeeId);
        }
    }, [currentMonth, tab, user.id, isAdmin, selectedEmployeeId, loadAdminUnavailability]); // Added loadAdminUnavailability

    const toggleDoubleDutyPref = async () => {
        const newVal = !doubleDutyPref;
        setDoubleDutyPref(newVal);
        const mStr = currentMonth.toISOString().slice(0, 7);
        try {
            await api.post(`${API_URL}/services/preferences`, {
                user_id: user.id,
                month: mStr,
                value: newVal
            });
        } catch (e) {
            alert("Σφάλμα αποθήκευσης προτίμησης.");
            setDoubleDutyPref(!newVal); // Revert
        }
    };

    const saveGeneralSettings = async () => {
        try {
            const curr = await api.get(`${API_URL}/admin/settings`);
            const payload = curr.data;

            const fullPayload = {
                lock_rules: { days_before: payload.lock_days || 3, time: payload.lock_time || "10:00" },
                weekly_schedule: payload.weekly_schedule || {},
                declaration_deadline: parseInt(generalSettings.declaration_deadline),
                signee_name: generalSettings.signee_name
            };
            await api.post(`${API_URL}/admin/settings`, fullPayload);

            const mStr = currentMonth.toISOString().slice(0, 7);
            await api.post(`${API_URL}/admin/schedule_metadata`, {
                month: mStr,
                protocol_num: protocolData.protocol_num,
                protocol_date: protocolData.protocol_date
            });

            alert("Οι ρυθμίσεις αποθηκεύτηκαν!");
        } catch (e) { alert("Σφάλμα αποθήκευσης."); }
    };

    const toggleUnavailability = async (dateStr) => {
        if (!isAdmin) {
            const today = new Date();
            const targetDate = new Date(dateStr);
            const monthDiff = (targetDate.getFullYear() - today.getFullYear()) * 12 + (targetDate.getMonth() - today.getMonth());

            if (monthDiff > 0) {
                if (today.getDate() > (generalSettings.declaration_deadline || 25)) {
                    return alert(`Η προθεσμία υποβολής δηλώσεων για τον επόμενο μήνα έληξε στις ${generalSettings.declaration_deadline}.`);
                }
            }
        }

        const exists = myUnavail.find(u => u.date === dateStr);
        setMyUnavail(prev => exists ? prev.filter(u => u.date !== dateStr) : [...prev, { date: dateStr, employee_id: user.id }]);
        if (exists) await api.delete(`${API_URL}/services/unavailability?employee_id=${user.id}&date=${dateStr}`);
        else await api.post(`${API_URL}/services/unavailability`, { employee_id: user.id, date: dateStr });
        loadMyUnavailability();
    };

    const assignEmployee = async (date, dutyId, shiftIdx, empId) => {
        if (!empId) return;
        try {
            await api.post(`${API_URL}/services/schedule`, { date, duty_id: dutyId, shift_index: shiftIdx, employee_id: empId });
            const s = await api.get(`${API_URL}/services/schedule`); setSchedule(s.data);
        } catch (e) { alert(e.response?.data?.error || "Η ανάθεση απέτυχε"); }
    };

    const saveDuty = async () => {
        if (!dutyForm.name) return alert("Παρακαλώ εισάγετε όνομα υπηρεσίας.");

        const shifts = parseInt(dutyForm.shifts_per_day) || 1;

        const newDuty = {
            id: dutyEditMode ? dutyForm.id : null,
            name: dutyForm.name,
            shifts_per_day: shifts,
            default_hours: dutyForm.default_hours || [],
            shift_config: dutyForm.shift_config || [],
            is_special: dutyForm.is_special || false,
            is_weekly: dutyForm.is_weekly || false,
            is_off_balance: dutyForm.is_off_balance || false,
            sunday_active_range: dutyForm.sunday_active_range || { start: '', end: '' }
        };

        if (!newDuty.shift_config || newDuty.shift_config.length < shifts) {
            const currentConf = newDuty.shift_config || [];
            while (currentConf.length < shifts) {
                currentConf.push({
                    is_night: false,
                    is_within_hours: false,
                    active_range: { start: '', end: '' },
                    excluded_ids: [],
                    handicaps: {},
                    default_employee_id: null
                });
            }
            newDuty.shift_config = currentConf;
        }

        if (!newDuty.default_hours || newDuty.default_hours.length < shifts) {
            const currentHours = newDuty.default_hours || [];
            while (currentHours.length < shifts) {
                currentHours.push("08:00-16:00");
            }
            newDuty.default_hours = currentHours;
        }

        let newDuties = [...config.duties];
        if (dutyEditMode) {
            const idx = newDuties.findIndex(d => d.id === dutyForm.id);
            newDuties[idx] = newDuty;
        } else {
            newDuties.push(newDuty);
        }

        try {
            await api.post(`${API_URL}/admin/services/config`, { ...config, duties: newDuties });
            setDutyForm({});
            setDutyEditMode(null);
            const c = await api.get(`${API_URL}/admin/services/config`);
            setConfig(c.data);
        } catch (e) {
            alert("Σφάλμα αποθήκευσης: " + (e.response?.data?.error || e.message));
        }
    };

    const toggleExclusion = async (dutyId, shiftIdx, empId) => {
        const newDuties = [...config.duties];
        const dIdx = newDuties.findIndex(d => d.id === dutyId);
        if (dIdx === -1) return;
        const duty = { ...newDuties[dIdx] };
        const sConf = duty.shift_config.map(s => ({ ...s }));
        const target = { ...sConf[shiftIdx] };
        let excl = target.excluded_ids ? [...target.excluded_ids] : [];
        if (excl.includes(empId)) excl = excl.filter(x => x !== empId);
        else excl.push(empId);
        target.excluded_ids = excl;
        sConf[shiftIdx] = target;
        duty.shift_config = sConf;
        newDuties[dIdx] = duty;
        setConfig({ ...config, duties: newDuties });
        await api.post(`${API_URL}/admin/services/config`, { ...config, duties: newDuties });
    };

    const updateHandicap = async (dutyId, shiftIdx, empId, val) => {
        const newDuties = [...config.duties];
        const dIdx = newDuties.findIndex(d => d.id === dutyId);
        if (dIdx === -1) return;
        const duty = { ...newDuties[dIdx] };
        const sConf = duty.shift_config.map(s => ({ ...s }));
        const target = { ...sConf[shiftIdx] };
        const handicaps = { ...(target.handicaps || {}) };

        // --- FIX: FORCE KEY TO STRING TO MATCH DATABASE FORMAT ---
        handicaps[String(empId)] = parseInt(val);

        target.handicaps = handicaps;
        sConf[shiftIdx] = target;
        duty.shift_config = sConf;
        newDuties[dIdx] = duty;
        setConfig({ ...config, duties: newDuties });
        await api.post(`${API_URL}/admin/services/config`, { ...config, duties: newDuties });
    };

    const deleteDuty = async (id) => {
        if (!window.confirm("Είστε σίγουροι για τη διαγραφή;")) return;
        const newDuties = config.duties.filter(d => d.id !== id);
        setConfig({ ...config, duties: newDuties });
    };

    const handleShiftCountChange = (val) => {
        const count = parseInt(val);
        const hours = dutyForm.default_hours || [];
        const conf = dutyForm.shift_config || [];
        if (hours.length < count) {
            for (let i = hours.length; i < count; i++) {
                hours.push("08:00-16:00");
                conf.push({
                    is_night: false,
                    is_within_hours: false,
                    active_range: { start: '', end: '' },
                    excluded_ids: [],
                    handicaps: {},
                    default_employee_id: null
                });
            }
        } else if (hours.length > count) { hours.splice(count); conf.splice(count); }
        setDutyForm({ ...dutyForm, shifts_per_day: count, default_hours: hours, shift_config: conf });
    };

    const handleHourChange = (idx, val) => { const hours = [...(dutyForm.default_hours || [])]; hours[idx] = val; setDutyForm({ ...dutyForm, default_hours: hours }); };

    const handleFlagChange = (idx, flag) => {
        const conf = [...(dutyForm.shift_config || [])];
        if (!conf[idx]) conf[idx] = { is_night: false, is_within_hours: false, active_range: { start: '', end: '' }, excluded_ids: [], handicaps: {}, default_employee_id: null };
        conf[idx][flag] = !conf[idx][flag];

        // Reset default if unchecked
        if (flag === 'is_within_hours' && !conf[idx][flag]) {
            conf[idx].default_employee_id = null;
        }

        setDutyForm({ ...dutyForm, shift_config: conf });
    };

    const handleDefaultEmpChange = (idx, val) => {
        const conf = [...(dutyForm.shift_config || [])];
        if (!conf[idx]) conf[idx] = { is_night: false, is_within_hours: false, active_range: { start: '', end: '' }, excluded_ids: [], handicaps: {}, default_employee_id: null };
        conf[idx].default_employee_id = val ? parseInt(val) : null;
        setDutyForm({ ...dutyForm, shift_config: conf });
    };

    const handleShiftRangeChange = (idx, field, val) => {
        const conf = [...(dutyForm.shift_config || [])];
        if (!conf[idx]) conf[idx] = { is_night: false, is_within_hours: false, active_range: { start: '', end: '' }, excluded_ids: [], handicaps: {} };
        if (!conf[idx].active_range) conf[idx].active_range = { start: '', end: '' };
        conf[idx].active_range[field] = val;
        setDutyForm({ ...dutyForm, shift_config: conf });
    };

    const handleSundayRangeChange = (field, val) => {
        setDutyForm({ ...dutyForm, sunday_active_range: { ...(dutyForm.sunday_active_range || {}), [field]: val } });
    };

    // Add Special Date with Description & Recurring
    const addSpecial = async () => {
        if (!newSpecialDate) return alert("Επιλέξτε ημερομηνία");

        let dateToSend = newSpecialDate;
        if (isRecurring) {
            const [, m, d] = newSpecialDate.split('-');
            dateToSend = `2000-${m}-${d}`;
        }

        try {
            await api.post(`${API_URL}/admin/special_dates`, {
                date: dateToSend,
                description: newSpecialDesc || 'Αργία'
            });
            const c = await api.get(`${API_URL}/admin/services/config`);
            setConfig(c.data);
            setNewSpecialDate('');
            setNewSpecialDesc('');
            setIsRecurring(false);
        } catch (e) {
            alert("Σφάλμα προσθήκης");
        }
    };

    const loadSpecialReport = async () => {
        try {
            const res = await api.get(`${API_URL}/services/special_duties_report`);
            setSpecialReportData(res.data);
            setShowSpecialReport(true);
        } catch (e) { alert("Error loading report"); }
    };

    // --- BULK ADD GREEK HOLIDAYS (20 years) ---
    const addGreekHolidays = async () => {
        if (!window.confirm('Θα προστεθούν όλες οι ελληνικές αργίες για τα επόμενα 20 χρόνια. Συνέχεια;')) return;

        // Orthodox Easter (Meeus algorithm)
        const orthodoxEaster = (year) => {
            const a = year % 4, b = year % 7, c = year % 19;
            const d = (19 * c + 15) % 30;
            const e = (2 * a + 4 * b - d + 34) % 7;
            const month = Math.floor((d + e + 114) / 31); // 3=March, 4=April
            const day = ((d + e + 114) % 31) + 1;
            // Julian date -> Gregorian: add 13 days for 20th-21st century
            const julian = new Date(year, month - 1, day);
            julian.setDate(julian.getDate() + 13);
            return julian;
        };

        const pad = (n) => String(n).padStart(2, '0');
        const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

        const holidays = [];

        // Fixed holidays (recurring, year 2000)
        const fixed = [
            ['01', '01', 'Πρωτοχρονιά'],
            ['01', '06', 'Θεοφάνια'],
            ['03', '25', 'Εθνική Εορτή (25η Μαρτίου)'],
            ['05', '01', 'Εργατική Πρωτομαγιά'],
            ['08', '15', 'Κοίμηση της Θεοτόκου'],
            ['10', '28', 'Επέτειος του Όχι'],
            ['12', '25', 'Χριστούγεννα'],
            ['12', '26', '2η Χριστουγέννων'],
        ];
        for (const [m, d, desc] of fixed) {
            holidays.push({ date: `2000-${m}-${d}`, description: desc });
        }

        // Moveable holidays for each year
        const currentYear = new Date().getFullYear();
        for (let y = currentYear; y < currentYear + 20; y++) {
            const easter = orthodoxEaster(y);
            const moveable = [
                [addDays(easter, -48), 'Καθαρά Δευτέρα'],
                [addDays(easter, -2), 'Μεγάλη Παρασκευή'],
                [easter, 'Κυριακή του Πάσχα'],
                [addDays(easter, 1), 'Δευτέρα του Πάσχα'],
                [addDays(easter, 50), 'Αγίου Πνεύματος'],
            ];
            for (const [dt, desc] of moveable) {
                holidays.push({ date: fmt(dt), description: desc });
            }
        }

        // Bulk insert, skip duplicates
        let added = 0, skipped = 0;
        const existing = new Set((config.special_dates || []).map(d => d.date));
        for (const h of holidays) {
            if (existing.has(h.date)) { skipped++; continue; }
            try {
                await api.post(`${API_URL}/admin/special_dates`, h);
                added++;
            } catch (e) { skipped++; }
        }

        const c = await api.get(`${API_URL}/admin/services/config`);
        setConfig(c.data);
        alert(`Ολοκληρώθηκε! Προστέθηκαν ${added} αργίες` + (skipped ? `, ${skipped} παραλείφθηκαν (ήδη υπάρχουν).` : '.'));
    };

    const removeSpecial = async (dStr) => {
        if (!window.confirm("Διαγραφή ειδικής ημερομηνίας;")) return;
        try {
            await api.delete(`${API_URL}/admin/special_dates?date=${dStr}`);
            const c = await api.get(`${API_URL}/admin/services/config`);
            setConfig(c.data);
        } catch (e) { alert("Error"); }
    };

    const runManualScheduler = async () => {
        const y = currentMonth.getFullYear();
        const m = String(currentMonth.getMonth() + 1).padStart(2, '0');
        const monthStr = `${y}-${m}`;

        if (!window.confirm(`Προσοχή! Αυτή η ενέργεια θα διαγράψει και θα ξαναδημιουργήσει το πρόγραμμα για τον μήνα ${monthStr}. Συνέχεια;`)) return;

        try {
            const res = await api.post(`${API_URL}/services/run_scheduler`, {
                start: monthStr,
                end: monthStr
            });
            const s = await api.get(`${API_URL}/services/schedule`);
            setSchedule(s.data);
            setSchedulerLogs(res.data.logs || []);
            alert("Ο Χρονοπρογραμματιστής ολοκληρώθηκε!");
        } catch (e) { console.error(e); alert("Σφάλμα: " + (e.response?.data?.error || e.message)); }
    };

    // --- FIX: ROBUST LAST DAY CALCULATION ---
    const runClearSchedule = async () => {
        const y = currentMonth.getFullYear();
        const m = String(currentMonth.getMonth() + 1).padStart(2, '0');
        const monthStr = `${y}-${m}`;

        if (!window.confirm(`Είστε σίγουροι; Αυτή η ενέργεια θα διαγράψει το πρόγραμμα για τον μήνα ${monthStr}. (Τα κλειδωμένα διατηρούνται)`)) return;

        const start = monthStr + "-01";
        // Calculate last day
        const lastDay = new Date(y, currentMonth.getMonth() + 1, 0).getDate();
        const endStr = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;

        try {
            await api.post(`${API_URL}/services/clear_schedule`, { start_date: start, end_date: endStr });
            const s = await api.get(`${API_URL}/services/schedule`);
            setSchedule(s.data);
            alert("Το πρόγραμμα καθαρίστηκε!");
        } catch (e) { alert("Σφάλμα"); }
    };

    const onDragStart = (e, index) => { setDraggedItem(employees[index]); e.dataTransfer.effectAllowed = "move"; };
    const onDragOver = (e, index) => { e.preventDefault(); setDragOverIndex(index); const draggedOverItem = employees[index]; if (draggedItem === draggedOverItem) return; let items = employees.filter(item => item !== draggedItem); items.splice(index, 0, draggedItem); setEmployees(items); };
    const onDrop = () => { setDraggedItem(null); setDragOverIndex(null); };

    const saveSeniorityOrder = async () => { try { await api.put(`${API_URL}/admin/employees`, { reorder: employees.map(e => e.id) }); alert("Η σειρά αρχαιότητας αποθηκεύτηκε!"); } catch (e) { alert("Αποτυχία αποθήκευσης."); } };

    const downloadLogsPDF = async () => {
        if (!logsPrintRef.current) return;
        try {
            const canvas = await html2canvas(logsPrintRef.current, { scale: 1.5 });
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();
            const imgProps = pdf.getImageProperties(imgData);
            const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;

            let y = 0;
            while (y < imgHeight) {
                if (y > 0) pdf.addPage();
                pdf.addImage(imgData, 'PNG', 0, -y, pdfWidth, imgHeight);
                y += pdfHeight;
            }
            pdf.save(`Scheduler_Logs_${new Date().toISOString().slice(0, 10)}.pdf`);
        } catch (e) { console.error(e); alert("Σφάλμα log PDF"); }
    };

    const generateServicePDF = async () => {
        if (!printRef1.current || !printRef2.current) return;
        const protocolDiv = document.createElement('div');
        protocolDiv.style.position = 'absolute'; protocolDiv.style.top = '10px'; protocolDiv.style.right = '20px'; protocolDiv.style.textAlign = 'right'; protocolDiv.style.fontSize = '0.8rem';
        protocolDiv.innerHTML = `<div>Χανιά, ${protocolData.protocol_date || '...'}</div><div>Αρ. Πρωτ.: ${protocolData.protocol_num || '...'}</div>`;
        const signatureDiv = document.createElement('div');
        signatureDiv.style.marginTop = '40px'; signatureDiv.style.textAlign = 'center'; signatureDiv.style.width = '100%'; signatureDiv.style.color = '#002F6C';
        signatureDiv.innerHTML = `<div style="font-weight:bold; margin-bottom:60px;">Ο ΠΡΟΙΣΤΑΜΕΝΟΣ ΤΗΣ ΔΙΕΥΘΥΝΣΗΣ ΤΟΥ ΤΕΛΩΝΕΙΟΥ</div><div style="font-weight:bold;">${generalSettings.signee_name || '(Ονοματεπώνυμο)'}</div>`;
        printRef1.current.style.display = 'block'; printRef1.current.appendChild(protocolDiv);
        printRef2.current.style.display = 'block'; printRef2.current.appendChild(signatureDiv);
        const pdf = new jsPDF('l', 'mm', 'a4'); const pdfWidth = pdf.internal.pageSize.getWidth();
        try { const c1 = await html2canvas(printRef1.current, { scale: 2 }); pdf.addImage(c1.toDataURL('image/png'), 'PNG', 0, 0, pdfWidth, (c1.height * pdfWidth) / c1.width); pdf.addPage(); const c2 = await html2canvas(printRef2.current, { scale: 2 }); pdf.addImage(c2.toDataURL('image/png'), 'PNG', 0, 0, pdfWidth, (c2.height * pdfWidth) / c2.width); pdf.save(`Schedule_${currentMonth.getMonth() + 1}.pdf`); } finally { printRef1.current.removeChild(protocolDiv); printRef2.current.removeChild(signatureDiv); printRef1.current.style.display = 'none'; printRef2.current.style.display = 'none'; }
    };

    const renderPrintRow = (d) => {
        const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isSpecial = (config.special_dates || []).some(sd => {
            if (typeof sd === 'string') return sd === dateStr;
            if (sd.date === dateStr) return true;
            if (sd.date.startsWith('2000-') && sd.date.slice(5) === dateStr.slice(5)) return true;
            return false;
        });
        const isWeekend = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), d).getDay() % 6 === 0;
        const dayOfWeek = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), d).getDay();
        return (
            <tr key={d} style={{ background: isSpecial ? '#fff9c4' : (isWeekend ? '#e3f2fd' : 'white') }}>
                <td style={{ border: '1px solid #002F6C', padding: 4, fontWeight: 'bold', width: '30px', textAlign: 'center', background: isSpecial ? '#fff9c4' : 'inherit' }}>{d}</td>
                <td style={{ border: '1px solid #002F6C', padding: 4, width: '40px', textAlign: 'center', background: isSpecial ? '#fff9c4' : 'inherit' }}>{getDayName(currentMonth.getFullYear(), currentMonth.getMonth(), d)}</td>
                {config.duties.filter(d => !d.is_special).map(duty => Array.from({ length: duty.shifts_per_day }).map((_, shIdx) => {
                    const s = schedule.find(x => x.date === dateStr && x.duty_id === duty.id && x.shift_index === shIdx);
                    let displayText = '';
                    if (s && s.employee_id) { const emp = employees.find(e => e.id === s.employee_id); displayText = emp ? formatName(emp.name) : ''; } else { if (duty.is_weekly && dayOfWeek === 0) { const prevDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), d - 1); const prevDateStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`; const prevS = schedule.find(x => x.date === prevDateStr && x.duty_id === duty.id && x.shift_index === shIdx); if (prevS) { const prevEmp = employees.find(e => e.id === prevS.employee_id); if (prevEmp) displayText = `(${formatName(prevEmp.name)})`; } } else if (!duty.is_weekly) { const range = duty.shift_config[shIdx]?.active_range; if (!isDateInActiveRange(dateStr, range) && shIdx > 0) { const prevS = schedule.find(x => x.date === dateStr && x.duty_id === duty.id && x.shift_index === shIdx - 1); if (prevS) { const prevEmp = employees.find(e => e.id === prevS.employee_id); displayText = prevEmp ? `(${formatName(prevEmp.name)})` : ''; } } } }
                    return <td key={`${duty.id}-${shIdx}`} style={{ border: '1px solid #002F6C', padding: 4, fontSize: '8pt', textAlign: 'center' }}>{displayText}</td>;
                }))}
            </tr>
        );
    };

    const renderCalendar = (mode) => {
        const year = currentMonth.getFullYear(); const month = currentMonth.getMonth(); const days = []; const specialDates = config.special_dates || [];

        // Determine unavailabilities to use based on mode
        const relevantUnavail = (mode === 'admin_declare') ? adminUnavail : myUnavail;
        const targetUserId = (mode === 'admin_declare') ? selectedEmployeeId : user.id;

        for (let d = 1; d <= getDaysInMonth(year, month); d++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isSpecial = specialDates.some(sd => {
                if (typeof sd === 'string') return sd === dateStr;
                if (sd.date === dateStr) return true;
                if (sd.date.startsWith('2000-') && sd.date.slice(5) === dateStr.slice(5)) return true;
                return false;
            });
            const dayShifts = schedule.filter(s => s.date === dateStr);
            const dayOfWeek = new Date(year, month, d).getDay();
            const isWeekend = dayOfWeek % 6 === 0;
            const isUnavail = relevantUnavail.some(u => u.date === dateStr);
            const isMyShift = dayShifts.some(s => s.employee_id === targetUserId);

            let hasProblem = false;
            if (mode === 'admin_view' && !isSpecial) {
                config.duties.forEach(duty => {
                    if (duty.is_special) return;
                    if (duty.is_weekly && dayOfWeek !== 0) return;
                    if (!isDateInActiveRange(dateStr, duty.active_range)) return;
                    for (let i = 0; i < duty.shifts_per_day; i++) {
                        if (!isDateInActiveRange(dateStr, duty.shift_config[i].active_range)) continue;
                        if (duty.is_weekly && !isDateInActiveRange(dateStr, duty.sunday_active_range)) continue;
                        const s = dayShifts.find(x => x.duty_id === duty.id && x.shift_index === i);
                        if (!s || !s.employee_id) hasProblem = true;
                    }
                });
            }

            let bg = isSpecial ? '#fff9c4' : (isWeekend ? '#e3f2fd' : 'white');
            let borderColor = isSpecial ? '#fbc02d' : (isWeekend ? '#90caf9' : '#e0e0e0');

            if (hasProblem) { bg = '#ffcdd2'; borderColor = '#e53935'; }

            if (mode === 'staff_view') { if (isMyShift) { bg = '#e8f5e9'; borderColor = '#a5d6a7'; } else if (isUnavail) { bg = '#eceff1'; borderColor = '#b0bec5'; } }

            // Logic for Declarations (Both Staff and Admin)
            if ((mode === 'declare_unavail' || mode === 'admin_declare') && isUnavail) { bg = '#eceff1'; borderColor = '#b0bec5'; }

            const handleDayClick = () => {
                if (mode === 'admin_view') setModal({ date: dateStr });
                if (mode === 'declare_unavail') toggleUnavailability(dateStr);
                if (mode === 'admin_declare') toggleAdminUnavailability(dateStr);
            };

            days.push(
                <div key={d} className="cal-day" style={{ background: bg, border: `1px solid ${borderColor}`, borderRadius: '8px', minHeight: 110, padding: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', transition: 'transform 0.1s ease', cursor: (mode === 'staff_view') ? 'default' : 'pointer' }} onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)'; }} onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)'; }} onClick={handleDayClick}>
                    <div style={{ fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', marginBottom: 5, color: isWeekend ? '#0277bd' : '#333' }}><span style={{ fontSize: '1.1em' }}>{d}</span>{isSpecial && <span style={{ color: 'purple', fontSize: '1.2em' }}>★</span>}</div>

                    {/* Only show shifts if NOT in declare mode */}
                    {mode !== 'declare_unavail' && mode !== 'admin_declare' && config.duties.filter(d => !d.is_special).map(duty => { return Array.from({ length: duty.shifts_per_day }).map((_, shiftIdx) => { const s = dayShifts.find(x => x.duty_id === duty.id && x.shift_index === shiftIdx); const emp = employees.find(e => e.id === s?.employee_id); let dispName = '-'; let isMe = false; if (emp) { dispName = formatName(emp.name); isMe = (emp.id === targetUserId); } else { if (duty.is_weekly && dayOfWeek === 0) { const prevDate = new Date(year, month, d - 1); const prevDateStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`; const prevS = schedule.find(x => x.date === prevDateStr && x.duty_id === duty.id && x.shift_index === shiftIdx); if (prevS) { const prevEmp = employees.find(e => e.id === prevS.employee_id); if (prevEmp) { dispName = `(${formatName(prevEmp.name)})`; if (prevEmp.id === targetUserId) isMe = true; } } } else if (!duty.is_weekly) { const range = duty.shift_config[shiftIdx]?.active_range; if (!isDateInActiveRange(dateStr, range) && shiftIdx > 0) { const prevS = dayShifts.find(x => x.duty_id === duty.id && x.shift_index === shiftIdx - 1); if (prevS) { const prevEmp = employees.find(e => e.id === prevS.employee_id); if (prevEmp) { dispName = `(${formatName(prevEmp.name)})`; if (prevEmp.id === targetUserId) isMe = true; } } } } } return (<div key={`${duty.id}-${shiftIdx}`} style={{ fontSize: '0.8rem', marginTop: 2, display: 'flex', justifyContent: 'space-between' }}> <span style={{ fontWeight: 600, color: '#555' }}>{duty.name.substring(0, 4)}:</span> <span style={{ color: dispName.startsWith('(') ? '#888' : (isMe ? '#d32f2f' : '#000'), fontWeight: isMe ? '900' : 'normal', textDecoration: isMe ? 'underline' : 'none' }}>{dispName}</span> </div>) }) })}

                    {/* Show Unavailability status in declare modes */}
                    {(mode === 'declare_unavail' || mode === 'admin_declare' || mode === 'staff_view') && isUnavail && <div style={{ fontSize: '0.8rem', color: '#d32f2f', fontWeight: 'bold', marginTop: 10, textAlign: 'center' }}>⛔ Μη διαθέσιμος</div>}
                </div>
            );
        }
        return <div className="calendar-grid">{days}</div>;
    };

    // Common Tab Button Style for Vertical Layout
    const tabBtnStyle = {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        padding: '10px 15px',
        height: 'auto',
        fontSize: '0.85rem'
    };

    return (
        <div className="app-shell">
            {/* GLOBAL LOADING RIBBON */}
            {loading && (
                <div style={{
                    position: 'fixed',
                    bottom: '20px',
                    left: '20px',
                    background: 'white',
                    padding: '15px 25px',
                    borderRadius: '8px',
                    boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '15px',
                    pointerEvents: 'none'
                }}>
                    <div className="spinner" style={{
                        width: '24px',
                        height: '24px',
                        border: '3px solid #f3f3f3',
                        borderTop: '3px solid #002F6C',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                    }} />
                    <span style={{ fontWeight: 600, color: '#333' }}>Φόρτωση...</span>
                    <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                </div>
            )}
            <AppHeader title="Υπηρεσίες" user={user} onExit={onExit} icon={<Calendar size={24} />} />

            {isAdmin ? (
                <div className="tabs" style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 20 }}>
                    <button className={tab === 'schedule' ? 'active' : ''} onClick={() => setTab('schedule')} style={tabBtnStyle}>
                        <Calendar size={20} />
                        <span>Πρόγραμμα</span>
                    </button>
                    <button className={tab === 'admin_declare' ? 'active' : ''} onClick={() => setTab('admin_declare')} style={tabBtnStyle}>
                        <UserCheck size={20} />
                        <span>Διαχ. Δηλώσεων</span>
                    </button>
                    <button className={tab === 'seniority' ? 'active' : ''} onClick={() => setTab('seniority')} style={tabBtnStyle}>
                        <Users size={20} />
                        <span>Αρχαιότητα</span>
                    </button>
                    <button className={tab === 'duties' ? 'active' : ''} onClick={() => setTab('duties')} style={tabBtnStyle}>
                        <Settings size={20} />
                        <span>Τύποι Υπηρεσίας</span>
                    </button>
                    <button className={tab === 'assign' ? 'active' : ''} onClick={() => setTab('assign')} style={tabBtnStyle}>
                        <Lock size={20} />
                        <span>Αναθέσεις</span>
                    </button>
                    <button className={tab === 'special' ? 'active' : ''} onClick={() => setTab('special')} style={tabBtnStyle}>
                        <AlertTriangle size={20} />
                        <span>Ειδικές Ημερ.</span>
                    </button>
                    <button className={tab === 'balance' ? 'active' : ''} onClick={() => setTab('balance')} style={tabBtnStyle}>
                        <BarChart size={20} />
                        <span>Ισοζύγιο</span>
                    </button>
                    <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')} style={tabBtnStyle}>
                        <FileText size={20} />
                        <span>Γενικές Ρυθμίσεις</span>
                    </button>
                    {isRoot && (
                        <button className={tab === 'queues' ? 'active' : ''} onClick={() => setTab('queues')} style={tabBtnStyle}>
                            <RefreshCw size={20} />
                            <span>Σειρές</span>
                        </button>
                    )}
                </div>
            ) : (
                <div className="tabs" style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 20 }}>
                    <button className={tab === 'myschedule' ? 'active' : ''} onClick={() => setTab('myschedule')} style={tabBtnStyle}>
                        <Calendar size={20} />
                        <span>Πρόγραμμα</span>
                    </button>
                    <button className={tab === 'declare' ? 'active' : ''} onClick={() => setTab('declare')} style={tabBtnStyle}>
                        <FileText size={20} />
                        <span>Δηλώσεις</span>
                    </button>
                </div>
            )}

            {/* Show Navigation for ALL tabs except Seniority, Duties, Settings, Queues */}
            {['schedule', 'admin_declare', 'myschedule', 'declare', 'settings'].includes(tab) &&
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 20,
                    paddingBottom: 20,
                    borderBottom: '1px solid #ddd'
                }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button className="nav-btn" onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() - 1)))}>←</button>
                        <span style={{ fontSize: '1.2rem', fontWeight: 'bold', alignSelf: 'center', minWidth: '250px', textAlign: 'center' }}>
                            {currentMonth.toLocaleString('el-GR', { month: 'long', year: 'numeric' })}
                        </span>
                        <button className="nav-btn" onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() + 1)))}>→</button>
                    </div>
                    {isAdmin && tab === 'schedule' && (
                        <div style={{ display: 'flex', gap: 10 }}>
                            <ActionButton onClick={runClearSchedule} icon={Trash2} label="Καθαρισμός" color="#F44336" hoverColor="#d32f2f" />
                            <ActionButton onClick={runManualScheduler} icon={Play} label="Αυτόματη Ανάθεση" color="#FF9800" hoverColor="#f57c00" />
                            <ActionButton onClick={generateServicePDF} icon={Printer} label="Πρόγραμμα PDF" color="#2196F3" hoverColor="#1976D2" />
                            <ActionButton onClick={downloadLogsPDF} icon={FileText} label="Logs PDF" color="#607d8b" hoverColor="#455a64" />
                        </div>
                    )}
                </div>}

            {/* Hidden Logs for PDF Generation */}
            <div style={{ position: 'absolute', left: '-9999px', top: 0, width: '210mm', minHeight: '297mm', padding: '20px', background: 'white', color: 'black' }} ref={logsPrintRef}>
                <h3 style={{ borderBottom: '2px solid #333', paddingBottom: '10px', marginBottom: '15px' }}>Scheduler Execution Logs</h3>
                <div style={{ marginBottom: '10px', fontSize: '0.9rem', color: '#666' }}>Generated: {new Date().toLocaleString('el-GR')}</div>
                <div style={{ fontFamily: 'monospace', fontSize: '10px', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                    {schedulerLogs.map((l, i) => <div key={i} style={{ borderBottom: '1px solid #eee', padding: '2px 0' }}>{l}</div>)}
                </div>
            </div>

            {tab === 'queues' && isRoot && <QueueManager user={user} />}

            {tab === 'schedule' && (
                <>
                    {renderCalendar('admin_view')}
                </>
            )}

            {tab === 'admin_declare' && isAdmin && (
                <>
                    <div style={{ background: 'white', padding: 15, borderRadius: 8, marginBottom: 20, boxShadow: '0 2px 4px rgba(0,0,0,0.05)', border: '1px solid #ddd' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
                            <label style={{ fontWeight: 'bold' }}>Επιλογή Υπαλλήλου:</label>
                            <select
                                value={selectedEmployeeId || ''}
                                onChange={(e) => setSelectedEmployeeId(parseInt(e.target.value))}
                                style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc', minWidth: 200 }}
                            >
                                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                            </select>
                        </div>
                    </div>

                    <div style={{ background: '#e3f2fd', padding: 15, borderRadius: 8, marginBottom: 20, borderLeft: '4px solid #2196F3' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h4 style={{ margin: '0 0 5px 0', color: '#0d47a1' }}>Προτίμηση Διπλοβάρδιας ΣΚ (Διαχειριστής)</h4>
                                <p style={{ margin: 0, fontSize: '0.9rem', color: '#555' }}> Ορίζετε αν ο επιλεγμένος υπάλληλος επιθυμεί διπλοβάρδια. </p>
                            </div>
                            <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                                <input type="checkbox" checked={adminDoubleDutyPref} onChange={toggleAdminDoubleDutyPref} style={{ width: 20, height: 20 }} />
                                <span style={{ fontWeight: 'bold' }}>Ενεργοποίηση</span>
                            </label>
                        </div>
                    </div>
                    {renderCalendar('admin_declare')}
                </>
            )}

            {tab === 'myschedule' && renderCalendar('staff_view')}
            {tab === 'declare' && (
                <>
                    <div style={{ background: '#e3f2fd', padding: 15, borderRadius: 8, marginBottom: 20, borderLeft: '4px solid #2196F3' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h4 style={{ margin: '0 0 5px 0', color: '#0d47a1' }}>Προτίμηση Διπλοβάρδιας ΣΚ</h4>
                                <p style={{ margin: 0, fontSize: '0.9rem', color: '#555' }}> Επιθυμώ να εκτελώ βάρδιες δύο μέρες συνεχόμενα (Σάββατο & Κυριακή) όταν μου ανατίθενται 2 βάρδιες Σαββατοκύριακου εντός του μήνα. <br /><small style={{ color: '#d32f2f' }}>*Η προτίμηση ενδέχεται να μην ικανοποιηθεί.</small> </p>
                            </div>
                            <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}> <input type="checkbox" checked={doubleDutyPref} onChange={toggleDoubleDutyPref} style={{ width: 20, height: 20 }} /> <span style={{ fontWeight: 'bold' }}>Ενεργοποίηση</span> </label>
                        </div>
                    </div>
                    {renderCalendar('declare_unavail')}
                </>
            )}

            {/* SENIORITY TAB */}
            {tab === 'seniority' && isAdmin && (
                <div className="admin-section">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, position: 'sticky', top: 0, background: '#f9f9f9', padding: '10px 0', borderBottom: '1px solid #ddd', zIndex: 10 }}>
                        <div> <h3>Κατάταξη Αρχαιότητας</h3> <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}> Σύρετε τα ονόματα για να αλλάξετε τη σειρά. </p> </div>
                        <button onClick={saveSeniorityOrder} style={{ background: '#4CAF50', padding: '10px 20px', fontSize: '1rem', display: 'flex', gap: 5, alignItems: 'center' }}> <Save size={16} /> Αποθήκευση Σειράς </button>
                    </div>
                    <ul style={{ listStyle: 'none', padding: '0 0 100px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {employees.map((emp, index) => (<li key={emp.id} draggable onDragStart={(e) => onDragStart(e, index)} onDragOver={(e) => onDragOver(e, index)} onDrop={onDrop} style={{ background: 'white', padding: '12px 16px', borderRadius: '8px', cursor: 'grab', display: 'flex', alignItems: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', border: '1px solid #eee', borderLeft: `4px solid ${index === dragOverIndex ? '#2196F3' : '#002F6C'}`, transition: 'all 0.2s ease', opacity: draggedItem === emp ? 0.5 : 1, transform: draggedItem === emp ? 'scale(0.98)' : 'scale(1)' }}> <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flex: 1 }}> <span style={{ fontSize: '1.2rem', color: '#ccc', cursor: 'grab', userSelect: 'none', padding: '0 5px' }}>☰</span> <div style={{ background: '#e3f2fd', color: '#002F6C', fontWeight: 'bold', width: '30px', height: '30px', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}> {index + 1} </div> <span style={{ fontSize: '1.1rem', fontWeight: 500 }}>{emp.name}</span> </div> </li>))}
                    </ul>
                </div>
            )}

            {/* GENERAL SETTINGS TAB */}
            {tab === 'settings' && isAdmin && (
                <div className="admin-section">
                    <h3>Γενικές Ρυθμίσεις</h3>
                    <div style={{ maxWidth: 500 }}>
                        <div style={{ marginBottom: 20 }}> <label style={{ display: 'block', fontWeight: 600, marginBottom: 5 }}>Προθεσμία Δηλώσεων (Ημέρα του μήνα)</label> <input type="number" min="1" max="31" value={generalSettings.declaration_deadline} onChange={e => setGeneralSettings({ ...generalSettings, declaration_deadline: e.target.value })} style={{ padding: 8, width: '100%', borderRadius: 4, border: '1px solid #ccc' }} /> <small style={{ color: '#666' }}>Μετά από αυτή τη μέρα, οι υπάλληλοι δεν μπορούν να δηλώσουν μη διαθεσιμότητα για τον επόμενο μήνα.</small> </div>
                        <div style={{ marginBottom: 20 }}> <label style={{ display: 'block', fontWeight: 600, marginBottom: 5 }}>Ονοματεπώνυμο Υπογράφοντος (Προϊστάμενος)</label> <input type="text" value={generalSettings.signee_name} onChange={e => setGeneralSettings({ ...generalSettings, signee_name: e.target.value })} style={{ padding: 8, width: '100%', borderRadius: 4, border: '1px solid #ccc' }} placeholder="π.χ. Ιωάννης Παπαδόπουλος" /> </div>
                        <h4 style={{ marginTop: 30, borderBottom: '1px solid #eee', paddingBottom: 5 }}>Στοιχεία Πρωτοκόλλου (Για τον τρέχοντα μήνα: {currentMonth.toLocaleString('el-GR', { month: 'long', year: 'numeric' })})</h4>
                        <div style={{ marginBottom: 20 }}> <label style={{ display: 'block', fontWeight: 600, marginBottom: 5 }}>Αριθμός Πρωτοκόλλου</label> <input type="text" value={protocolData.protocol_num} onChange={e => setProtocolData({ ...protocolData, protocol_num: e.target.value })} style={{ padding: 8, width: '100%', borderRadius: 4, border: '1px solid #ccc' }} /> </div>
                        <div style={{ marginBottom: 20 }}> <label style={{ display: 'block', fontWeight: 600, marginBottom: 5 }}>Ημερομηνία Πρωτοκόλλου</label> <input type="text" value={protocolData.protocol_date} onChange={e => setProtocolData({ ...protocolData, protocol_date: e.target.value })} style={{ padding: 8, width: '100%', borderRadius: 4, border: '1px solid #ccc' }} placeholder="π.χ. 31/01/2026" /> </div>
                        <button onClick={saveGeneralSettings} style={{ background: '#002F6C', color: 'white', padding: '10px 20px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 5 }}><Save size={16} /> Αποθήκευση Ρυθμίσεων</button>
                    </div>
                </div>
            )}

            {tab === 'balance' && isAdmin && (
                <div className="admin-section">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                        <div> <h3 style={{ margin: 0 }}>Ισοζύγιο Υπηρεσιών</h3> <p className="text-gray-500 text-sm">Επιλέξτε εύρος για υπολογισμό ισοζυγίου.</p> </div>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <button onClick={loadSpecialReport} style={{ background: '#7b1fa2', color: 'white', border: 'none', borderRadius: 4, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                                <FileText size={16} /> Αργίες
                            </button>
                            <label>Από:</label> <input type="month" value={balanceRange.start} onChange={(e) => setBalanceRange({ ...balanceRange, start: e.target.value })} style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} />
                            <label>Έως:</label> <input type="month" value={balanceRange.end} onChange={(e) => setBalanceRange({ ...balanceRange, end: e.target.value })} style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} />
                        </div>
                    </div>
                    {(() => {
                        const minNormalSpecial = balanceStats.length > 0 ? Math.min(...balanceStats.map(s => s.special_normal || 0)) : 0;
                        const minOffBalSpecial = balanceStats.length > 0 ? Math.min(...balanceStats.map(s => s.special_offbalance || 0)) : 0;
                        const hasOffBalance = config.duties.some(d => d.is_off_balance && !d.is_weekly);

                        return (
                            <table className="center-table" style={{ textAlign: 'center' }}>
                                <thead>
                                    <tr style={{ textAlign: 'center' }}>
                                        <th style={{ textAlign: 'center' }}>Υπάλληλος</th>
                                        <th style={{ textAlign: 'center' }}>Πραγματικό Σύνολο (Με Πλεονέκτημα)</th>
                                        <th style={{ background: '#e3f2fd', color: '#002F6C', textAlign: 'center' }}>ΣΚ (Εύρος 5 μηνών)</th>
                                        <th style={{ background: '#fff3e0', color: '#e65100', textAlign: 'center' }}>Αργίες (Κανον.)</th>
                                        {config.duties.filter(d => d.is_weekly).map(d => <th key={d.id} style={{ textAlign: 'center' }}>{d.name}</th>)}
                                        {hasOffBalance && <th style={{ background: '#eceff1', color: '#455a64', textAlign: 'center' }}>Αργίες (Εκτός)</th>}
                                        {config.duties.filter(d => d.is_off_balance && !d.is_weekly).map(d => <th key={d.id} style={{ textAlign: 'center' }}>{d.name}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {balanceStats.map(s => (
                                        <tr key={s.name} style={{ textAlign: 'center' }}>
                                            <td style={{ textAlign: 'center' }}>{s.name}</td>
                                            <td style={{ textAlign: 'center' }}>
                                                <span style={{ fontWeight: 'bold' }}>{s.total}</span>
                                                {s.total !== s.effective_total && (<span style={{ color: 'gray', marginLeft: 5, fontSize: '0.9em' }}> ({s.effective_total}) </span>)}
                                            </td>
                                            <td style={{ background: '#e3f2fd', textAlign: 'center', fontWeight: 'bold' }}>
                                                {s.sk_score || 0}
                                            </td>
                                            <td style={{ background: '#fff3e0', textAlign: 'center', fontWeight: 'bold' }}>
                                                {s.special_normal || 0}
                                                {(s.special_normal || 0) > minNormalSpecial && (
                                                    <span style={{ color: '#f59e0b', marginLeft: 5 }}>
                                                        {'★'.repeat((s.special_normal || 0) - minNormalSpecial)}
                                                    </span>
                                                )}
                                            </td>
                                            {config.duties.filter(d => d.is_weekly).map(d => {
                                                const actual = s.duty_counts?.[d.id] || 0;
                                                return <td key={d.id} style={{ textAlign: 'center' }}>{actual}</td>
                                            })}
                                            {hasOffBalance && (
                                                <td style={{ background: '#eceff1', textAlign: 'center', fontWeight: 'bold' }}>
                                                    {s.special_offbalance || 0}
                                                    {(s.special_offbalance || 0) > minOffBalSpecial && (
                                                        <span style={{ color: '#f59e0b', marginLeft: 5 }}>
                                                            {'★'.repeat((s.special_offbalance || 0) - minOffBalSpecial)}
                                                        </span>
                                                    )}
                                                </td>
                                            )}
                                            {config.duties.filter(d => d.is_off_balance && !d.is_weekly).map(d => {
                                                const actual = s.duty_counts?.[d.id] || 0;
                                                return <td key={d.id} style={{ textAlign: 'center' }}>{actual}</td>
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        );
                    })()}
                </div>
            )}

            {/* --- BEAUTIFIED DUTY TYPES TAB --- */}
            {tab === 'duties' && isAdmin && (
                <div className="admin-section" style={{ background: '#f8f9fa', padding: 20 }}>
                    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                        {/* LEFT: EDITOR PANEL */}
                        <div style={{ flex: '0 0 350px', background: 'white', padding: 20, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', position: 'sticky', top: 20 }}>
                            <h3 style={{ margin: '0 0 15px 0', color: '#002F6C', display: 'flex', alignItems: 'center', gap: 10 }}> <Settings size={20} /> {dutyEditMode ? 'Επεξεργασία' : 'Νέα'} Υπηρεσία </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                                <div> <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#555', marginBottom: 5 }}>Όνομα Υπηρεσίας</label> <input value={dutyForm.name || ''} onChange={e => setDutyForm({ ...dutyForm, name: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: '1px solid #ccc', fontSize: '1rem' }} placeholder="π.χ. Γραφείο Κίνησης" /> </div>
                                <div> <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#555', marginBottom: 5 }}>Βάρδιες ανά ημέρα</label> <input type="number" min="1" max="10" value={dutyForm.shifts_per_day || 1} onChange={e => handleShiftCountChange(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: '1px solid #ccc', fontSize: '1rem' }} /> </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, background: '#f5f5f5', padding: 10, borderRadius: 6 }}> <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.85rem', cursor: 'pointer' }}> <input type="checkbox" checked={dutyForm.is_special || false} onChange={e => setDutyForm({ ...dutyForm, is_special: e.target.checked })} /> <span style={{ color: '#7b1fa2', fontWeight: 600 }}>ΕΙΔΙΚΗ</span> </label> <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.85rem', cursor: 'pointer' }}> <input type="checkbox" checked={dutyForm.is_weekly || false} onChange={e => setDutyForm({ ...dutyForm, is_weekly: e.target.checked })} /> <span style={{ color: '#e65100', fontWeight: 600 }}>ΕΒΔΟΜΑΔΙΑΙΑ</span> </label> <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.85rem', cursor: 'pointer' }}> <input type="checkbox" checked={dutyForm.is_off_balance || false} onChange={e => setDutyForm({ ...dutyForm, is_off_balance: e.target.checked })} /> <span style={{ color: '#455a64', fontWeight: 600 }}>ΕΚΤΟΣ ΙΣΟΖ.</span> </label> </div>
                                {dutyForm.is_weekly && (<div style={{ background: '#fff3e0', padding: 10, borderRadius: 6, border: '1px solid #ffe0b2' }}> <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, color: '#e65100', fontSize: '0.85rem', fontWeight: 600 }}> <CalIcon size={14} /> Εύρος Κυριακής (ΗΗ-ΜΜ) </div> <div style={{ display: 'flex', gap: 5 }}> <input placeholder="Από" value={dutyForm.sunday_active_range?.start || ''} onChange={e => handleSundayRangeChange('start', e.target.value)} style={{ flex: 1, padding: 5, borderRadius: 4, border: '1px solid #ffcc80' }} /> <input placeholder="Έως" value={dutyForm.sunday_active_range?.end || ''} onChange={e => handleSundayRangeChange('end', e.target.value)} style={{ flex: 1, padding: 5, borderRadius: 4, border: '1px solid #ffcc80' }} /> </div> </div>)}
                                <div style={{ borderTop: '1px solid #eee', paddingTop: 10 }}> <h5 style={{ margin: '0 0 10px 0', fontSize: '0.9rem', color: '#333' }}>Ρυθμίσεις Βαρδιών</h5> <div style={{ maxHeight: 300, overflowY: 'auto', paddingRight: 5 }}> {(dutyForm.default_hours || ["08:00-16:00"]).map((h, i) => (<div key={i} style={{ background: '#f9fafb', border: '1px solid #e0e0e0', borderRadius: 6, padding: 10, marginBottom: 10 }}> <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}> <strong style={{ fontSize: '0.8rem', color: '#002F6C' }}>Βάρδια {i + 1}</strong> <div style={{ display: 'flex', gap: 10 }}> <label title="Νυχτερινή" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}> <input type="checkbox" checked={dutyForm.shift_config?.[i]?.is_night} onChange={() => handleFlagChange(i, 'is_night')} /> <Moon size={14} /> </label> <label title="Ωράριο Γραφείου" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}> <input type="checkbox" checked={dutyForm.shift_config?.[i]?.is_within_hours} onChange={() => handleFlagChange(i, 'is_within_hours')} /> <Briefcase size={14} /> </label> </div> </div> <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}> <Clock size={14} color="#666" /> <input value={h} onChange={e => handleHourChange(i, e.target.value)} style={{ flex: 1, padding: 5, borderRadius: 4, border: '1px solid #ccc', fontSize: '0.85rem' }} placeholder="08:00-16:00" /> </div> {dutyForm.shift_config?.[i]?.is_within_hours && (<div style={{ marginBottom: 8 }}> <select style={{ width: '100%', padding: 5, borderRadius: 4, border: '1px solid #b0bec5', fontSize: '0.8rem', background: 'white' }} value={dutyForm.shift_config[i].default_employee_id || ""} onChange={(e) => handleDefaultEmpChange(i, e.target.value)} > <option value="">-- Χωρίς Προεπιλογή --</option> {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)} </select> </div>)} <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}> <span style={{ fontSize: '0.75rem', color: '#666' }}>Ενεργό:</span> <input placeholder="Από" value={dutyForm.shift_config?.[i]?.active_range?.start || ''} onChange={e => handleShiftRangeChange(i, 'start', e.target.value)} style={{ width: 50, padding: 3, borderRadius: 4, border: '1px solid #ddd', fontSize: '0.75rem' }} /> <span style={{ fontSize: '0.75rem' }}>-</span> <input placeholder="Έως" value={dutyForm.shift_config?.[i]?.active_range?.end || ''} onChange={e => handleShiftRangeChange(i, 'end', e.target.value)} style={{ width: 50, padding: 3, borderRadius: 4, border: '1px solid #ddd', fontSize: '0.75rem' }} /> </div> </div>))} </div> </div>
                                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}> <button onClick={saveDuty} style={{ flex: 1, background: '#002F6C', color: 'white', padding: 10, borderRadius: 6, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5 }}> <Save size={16} /> Αποθήκευση </button> {dutyEditMode && (<button onClick={() => { setDutyForm({}); setDutyEditMode(null) }} style={{ background: '#e0e0e0', color: '#333', padding: 10, borderRadius: 6 }}> <X size={16} /> </button>)} </div>
                            </div>
                        </div>
                        {/* RIGHT: LIST OF DUTIES */}
                        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 15, alignContent: 'start' }}>
                            {config.duties.map(d => (<div key={d.id} className="duty-card" style={{ background: 'white', padding: 15, borderRadius: 8, boxShadow: '0 2px 4px rgba(0,0,0,0.05)', border: '1px solid #eee', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', transition: 'transform 0.1s ease', cursor: 'default' }}> <div> <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 10 }}> <h4 style={{ margin: 0, fontSize: '1.1rem', color: '#333' }}>{d.name}</h4> <div style={{ display: 'flex', gap: 5 }}> <button onClick={() => { setDutyForm(d); setDutyEditMode(true) }} style={{ background: '#e3f2fd', color: '#1565c0', padding: 5, borderRadius: 4, border: 'none', cursor: 'pointer' }}><Edit2 size={14} /></button> <button onClick={() => deleteDuty(d.id)} style={{ background: '#ffebee', color: '#c62828', padding: 5, borderRadius: 4, border: 'none', cursor: 'pointer' }}><Trash2 size={14} /></button> </div> </div> <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 15 }}> {d.is_special && <span style={{ fontSize: '0.7rem', background: '#f3e5f5', color: '#7b1fa2', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>ΕΙΔΙΚΗ</span>} {d.is_weekly && <span style={{ fontSize: '0.7rem', background: '#fff3e0', color: '#e65100', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>ΕΒΔΟΜΑΔΙΑΙΑ</span>} {d.is_off_balance && <span style={{ fontSize: '0.7rem', background: '#eceff1', color: '#455a64', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>ΕΚΤΟΣ ΙΣΟΖ.</span>} <span style={{ fontSize: '0.7rem', background: '#e0f7fa', color: '#006064', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>{d.shifts_per_day} ΒΑΡΔΙΕΣ</span> </div> <div style={{ fontSize: '0.85rem', color: '#666' }}> {d.default_hours.map((h, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}> <Clock size={12} /> {h} {d.shift_config[i]?.is_night && <Moon size={12} />} {d.shift_config[i]?.is_within_hours && <Briefcase size={12} />} </div>))} </div> </div> </div>))}
                        </div>
                    </div>
                </div>
            )}

            {tab === 'assign' && isAdmin && (<div className="admin-section"><h3>Εξαιρέσεις & Πλεονεκτήματα (Ανά Βάρδια)</h3><p>Ορίστε εξαιρέσεις και πλεονεκτήματα για κάθε βάρδια. <strong>(Το Πλεονέκτημα μετράει στο 3-μηνο ισοζύγιο)</strong></p>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ fontSize: '0.9rem', width: 'auto' }}>
                        <thead>
                            <tr>
                                <th>Υπάλληλος</th>
                                {config.duties.map(d => (d.shift_config.map((s, idx) => (<th key={`${d.id}-${idx}`} style={{ minWidth: 100, textAlign: 'center' }}> {d.name} <br /> <small>{d.default_hours[idx]}</small> </th>))))}
                            </tr>
                        </thead>
                        <tbody>
                            {employees.map(e => (<tr key={e.id}> <td>{e.name}</td> {config.duties.map(d => (d.shift_config.map((s, idx) => {
                                const isExcluded = s.excluded_ids?.includes(e.id);
                                const handicap = s.handicaps?.[String(e.id)] || 0;
                                return (<td key={`${d.id}-${idx}`} style={{ textAlign: 'center', background: isExcluded ? '#ffebee' : 'transparent' }}> <div style={{ display: 'flex', gap: 5, justifyContent: 'center', alignItems: 'center' }}> <input type="checkbox" title="Exclude" checked={!isExcluded} onChange={() => toggleExclusion(d.id, idx, e.id)} /> <select style={{ width: 45, padding: 0, fontWeight: handicap > 0 ? 'bold' : 'normal', color: handicap > 0 ? 'red' : 'inherit' }} value={handicap} onChange={(ev) => updateHandicap(d.id, idx, e.id, ev.target.value)} > <option value="0">-</option> {Array.from({ length: 30 }, (_, i) => i + 1).map(val => (<option key={val} value={val}>+{val}</option>))} </select> </div> </td>);
                            })))} </tr>))}
                        </tbody>
                    </table>
                </div>
            </div>)}

            {tab === 'special' && isAdmin && (
                <div className="admin-section">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                        <div>
                            <h3>Διαχείριση Ειδικών Ημερομηνιών</h3>
                            <p style={{ color: '#666', margin: 0 }}>Ορίστε αργίες και ειδικές ημέρες.</p>
                        </div>
                    </div>

                    {/* Add New Bar */}
                    <div style={{ display: 'flex', gap: 10, background: 'white', padding: 15, borderRadius: 8, boxShadow: '0 2px 4px rgba(0,0,0,0.05)', marginBottom: 20, alignItems: 'center' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 5, color: '#555' }}>Επιλογή Ημερομηνίας</label>
                            <input
                                type="date"
                                value={newSpecialDate}
                                onChange={(e) => setNewSpecialDate(e.target.value)}
                                style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #ddd' }}
                            />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 5, color: '#555' }}>Περιγραφή</label>
                            <input
                                type="text"
                                value={newSpecialDesc}
                                onChange={(e) => setNewSpecialDesc(e.target.value)}
                                placeholder="π.χ. Πάσχα"
                                style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #ddd' }}
                            />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 22 }}>
                            <input
                                type="checkbox"
                                id="chkRecurring"
                                checked={isRecurring}
                                onChange={(e) => setIsRecurring(e.target.checked)}
                            />
                            <label htmlFor="chkRecurring" style={{ cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500 }}>Κάθε έτος</label>
                        </div>
                        <button
                            onClick={addSpecial}
                            disabled={!newSpecialDate}
                            style={{ height: 42, marginTop: 22, display: 'flex', alignItems: 'center', gap: 5, background: newSpecialDate ? '#7b1fa2' : '#ccc', color: 'white', border: 'none', borderRadius: 4, padding: '0 15px', cursor: newSpecialDate ? 'pointer' : 'not-allowed' }}
                        >
                            <Plus size={18} /> Προσθήκη
                        </button>
                        <button
                            onClick={addGreekHolidays}
                            style={{ height: 42, marginTop: 22, display: 'flex', alignItems: 'center', gap: 5, background: '#1565C0', color: 'white', border: 'none', borderRadius: 4, padding: '0 15px', cursor: 'pointer' }}
                        >
                            <CalIcon size={18} /> Αργίες 20 ετών
                        </button>
                    </div>

                    {/* Cards Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 15 }}>
                        {(config.special_dates || []).sort((a, b) => a.date.localeCompare(b.date)).map(d => {
                            const isRec = d.date.startsWith('2000-');
                            const dateObj = new Date(d.date);
                            return (
                                <div key={d.date} className="date-card" style={{ background: 'white', borderRadius: 8, border: '1px solid #eee', borderTop: isRec ? '4px solid #e65100' : '4px solid #7b1fa2', padding: 15, boxShadow: '0 2px 5px rgba(0,0,0,0.05)', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                                    <button onClick={() => removeSpecial(d.date)} style={{ position: 'absolute', top: 5, right: 5, background: 'transparent', border: 'none', color: '#999', cursor: 'pointer', padding: 5 }} title="Διαγραφή" > <Trash2 size={16} color="#d32f2f" /> </button>
                                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: isRec ? '#e65100' : '#7b1fa2', textTransform: 'uppercase', marginBottom: 5 }}> {isRec ? 'ΚΑΘΕ ΕΤΟΣ' : dateObj.getFullYear()} </div>
                                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#555', textTransform: 'uppercase', marginBottom: 2 }}> {toGreekUpper(dateObj.toLocaleString('el-GR', { month: 'long' }))} </div>
                                    <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#333', lineHeight: 1 }}> {dateObj.getDate()} </div>
                                    {d.description && (<div style={{ marginTop: 8, fontSize: '0.85rem', color: '#333', fontWeight: 500, borderTop: '1px solid #eee', paddingTop: 5, width: '100%' }}> {d.description} </div>)}
                                </div>
                            );
                        })}
                        {(config.special_dates || []).length === 0 && (<div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40, color: '#999', border: '2px dashed #eee', borderRadius: 8 }}> Δεν έχουν οριστεί ειδικές ημερομηνίες. </div>)}
                    </div>
                </div>
            )}

            {modal && (
                <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }} onClick={() => setModal(null)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '30px', maxHeight: '95vh', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee', paddingBottom: 10, marginBottom: 20, flexShrink: 0 }}> <h3 style={{ margin: 0 }}>Βάρδιες: {formatDate(modal.date)}</h3> <button onClick={() => setModal(null)} style={{ background: 'transparent', color: '#666', fontSize: '1.5rem', padding: 0 }}>×</button> </div>
                        <div style={{ overflowY: 'auto', flex: 1, paddingRight: 5 }}>
                            {config.duties.filter(d => !d.is_special).map(d => (<div key={d.id} style={{ marginBottom: 15, borderBottom: '1px solid #eee', paddingBottom: 10 }}> <h4 style={{ margin: '0 0 10px 0', color: '#002F6C' }}>{d.name}</h4> {Array.from({ length: d.shifts_per_day }).map((_, idx) => { const assign = schedule.find(s => s.date === modal.date && s.duty_id === d.id && s.shift_index === idx); return (<div key={idx} style={{ display: 'flex', gap: 10, marginBottom: 5, alignItems: 'center' }}> <span style={{ minWidth: 120, fontSize: '0.9rem' }}>Βάρδια {idx + 1} <small style={{ color: '#666' }}>({d.default_hours[idx]})</small>:</span> <select value={assign?.employee_id || ''} onChange={(e) => assignEmployee(modal.date, d.id, idx, parseInt(e.target.value))} style={{ flex: 1, padding: 5, borderRadius: 4, border: '1px solid #ccc' }} > <option value="">-- Ανάθεση --</option> {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)} </select> </div>); })} </div>))}
                            <div style={{ background: '#f9f9f9', padding: 10, borderRadius: 8, marginTop: 20 }}> <h4 style={{ margin: '0 0 10px 0', color: '#d32f2f', display: 'flex', gap: 5, alignItems: 'center' }}><AlertTriangle size={16} /> Έκτακτες / Ειδικές Υπηρεσίες</h4> <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}> <select id="sp_duty" style={{ padding: 5, borderRadius: 4 }}><option value="">Επιλογή Ειδικής Υπηρεσίας...</option>{config.duties.filter(d => d.is_special).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select> <select id="sp_emp" style={{ padding: 5, borderRadius: 4 }}><option value="">Επιλογή Υπαλλήλου...</option>{employees.map(e => { return <option key={e.id} value={e.id}>{e.name}</option> })}</select> <button onClick={() => { const dId = document.getElementById('sp_duty').value; const eId = document.getElementById('sp_emp').value; if (dId && eId) assignEmployee(modal.date, parseInt(dId), 0, parseInt(eId)); }} style={{ background: '#d32f2f', padding: '5px 10px' }}><Plus size={16} /></button> </div> {schedule.filter(s => s.date === modal.date && config.duties.find(d => d.id === s.duty_id)?.is_special).map(s => (<div key={s.duty_id} style={{ marginTop: 10, padding: 5, background: 'white', borderRadius: 4, border: '1px solid #ddd', display: 'flex', justifyContent: 'space-between' }}><span><strong>{config.duties.find(d => d.id === s.duty_id).name}</strong>: {employees.find(e => e.id === s.employee_id)?.name}</span></div>))} </div>
                        </div>
                    </div>
                </div>
            )}


            <div id="print-area-1" ref={printRef1} style={{ display: 'none', padding: 20, background: 'white', width: '297mm', height: '210mm' }}> <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, borderBottom: '2px solid #002F6C', paddingBottom: 10, alignItems: 'flex-start' }}> <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}> <img src="/aade-logo.png" style={{ height: 40, objectFit: 'contain', alignSelf: 'flex-start' }} alt="AADE" /> <div style={{ color: '#002F6C', fontWeight: 'bold', fontSize: '1.1rem' }}>Τελωνείο Χανίων</div> </div> <div style={{ textAlign: 'right', fontSize: '0.9rem', color: '#333' }}> <div>Χανιά, {protocolData.protocol_date || '...'}</div> <div>Αρ. Πρωτ.: {protocolData.protocol_num || '...'}</div> </div> </div> <h2 style={{ textAlign: 'center', color: '#002F6C', textTransform: 'uppercase', margin: '10px 0' }}> {toGreekUpper("Πρόγραμμα Υπηρεσιών " + currentMonth.toLocaleString('el-GR', { month: 'long', year: 'numeric' }))} </h2> <table className="print-table" style={{ width: '100%', fontSize: '8pt', textAlign: 'center', borderCollapse: 'collapse' }}><thead><tr style={{ background: '#002F6C', color: 'white' }}><th style={{ border: '1px solid #000', padding: 5, textAlign: 'center' }}>Ημ/νία</th><th style={{ border: '1px solid #000', padding: 5, textAlign: 'center' }}>Ημέρα</th>{config.duties.filter(d => !d.is_special).map(d => Array.from({ length: d.shifts_per_day }).map((_, i) => <th key={`${d.id}-${i}`} style={{ border: '1px solid #000', padding: 5, textAlign: 'center' }}>{d.name} <br /> <small>({d.default_hours[i]})</small></th>))}</tr></thead><tbody>{Array.from({ length: 15 }).map((_, i) => renderPrintRow(i + 1))}</tbody></table> </div>
            <div id="print-area-2" ref={printRef2} style={{ display: 'none', padding: 20, background: 'white', width: '297mm', height: '210mm' }}> <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, borderBottom: '2px solid #002F6C', paddingBottom: 10, alignItems: 'flex-start' }}> <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}> <img src="/aade-logo.png" style={{ height: 40, objectFit: 'contain', alignSelf: 'flex-start' }} alt="AADE" /> <div style={{ color: '#002F6C', fontWeight: 'bold', fontSize: '1.1rem' }}>Τελωνείο Χανίων</div> </div> <div style={{ textAlign: 'right', fontSize: '0.9rem', color: '#333' }}> <div>Χανιά, {protocolData.protocol_date || '...'}</div> <div>Αρ. Πρωτ.: {protocolData.protocol_num || '...'}</div> </div> </div> <h2 style={{ textAlign: 'center', color: '#002F6C', textTransform: 'uppercase', margin: '10px 0' }}> {toGreekUpper("Πρόγραμμα Υπηρεσιών " + currentMonth.toLocaleString('el-GR', { month: 'long', year: 'numeric' }))} </h2> <table className="print-table" style={{ width: '100%', fontSize: '8pt', textAlign: 'center', borderCollapse: 'collapse' }}><thead><tr style={{ background: '#002F6C', color: 'white' }}><th style={{ border: '1px solid #000', padding: 5, textAlign: 'center' }}>Ημ/νία</th><th style={{ border: '1px solid #000', padding: 5, textAlign: 'center' }}>Ημέρα</th>{config.duties.filter(d => !d.is_special).map(d => Array.from({ length: d.shifts_per_day }).map((_, i) => <th key={`${d.id}-${i}`} style={{ border: '1px solid #000', padding: 5, textAlign: 'center' }}>{d.name} <br /> <small>({d.default_hours[i]})</small></th>))}</tr></thead><tbody>{Array.from({ length: getDaysInMonth(currentMonth.getFullYear(), currentMonth.getMonth()) - 15 }).map((_, i) => renderPrintRow(i + 16))}</tbody></table> </div>
            {/* SPECIAL REPORT MODAL */}
            {showSpecialReport && (
                <div className="modal-overlay" onClick={() => setShowSpecialReport(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: 900, maxHeight: '85vh' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <h3>Αναφορά Αργιών & Εορτών (Ιστορικό)</h3>
                            <button onClick={() => setShowSpecialReport(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={24} /></button>
                        </div>
                        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                            <table className="center-table">
                                <thead>
                                    <tr>
                                        <th>Υπάλληλος</th>
                                        <th>Σύνολο Αργιών</th>
                                        <th style={{ width: '60%' }}>Λεπτομέρειες</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {specialReportData.map((row, idx) => (
                                        <tr key={idx}>
                                            <td style={{ fontWeight: 500 }}>{row.name}</td>
                                            <td style={{ fontWeight: 'bold', fontSize: '1.1rem', color: '#002F6C' }}>{row.count}</td>
                                            <td style={{ fontSize: '0.9rem', color: '#555' }}>
                                                {row.details.join(', ')}
                                            </td>
                                        </tr>
                                    ))}
                                    {specialReportData.length === 0 && (
                                        <tr><td colSpan={3} style={{ textAlign: 'center', padding: 20, color: '#999' }}>Δεν βρέθηκαν εγγραφές.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ marginTop: 20, textAlign: 'right' }}>
                            <button onClick={() => setShowSpecialReport(false)} style={{ background: '#666' }}>Κλείσιμο</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};