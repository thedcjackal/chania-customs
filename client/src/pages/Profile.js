import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { MFASetup } from '../components/MFASetup';

export const Profile = ({ user, onBack }) => {
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });
    
    // Password State
    const [oldPassword, setOldPassword] = useState(''); // <--- NEW FIELD
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    // 2FA State
    const [mfaStatus, setMfaStatus] = useState('loading'); 
    const [showMfaModal, setShowMfaModal] = useState(false); 

    useEffect(() => {
        checkMfaStatus();
    }, []);

    const checkMfaStatus = async () => {
        try {
            const { data, error } = await supabase.auth.mfa.listFactors();
            if (error) throw error;
            const hasVerified = data.totp.some(factor => factor.status === 'verified');
            setMfaStatus(hasVerified ? 'enabled' : 'disabled');
        } catch (e) {
            console.error("MFA Check Error", e);
            setMfaStatus('disabled');
        }
    };

    const handlePasswordChange = async (e) => {
        e.preventDefault();
        setMessage({ type: '', text: '' });

        // 1. BASIC VALIDATION
        if (!oldPassword) {
            setMessage({ type: 'error', text: 'Παρακαλώ εισάγετε τον τρέχοντα κωδικό σας.' });
            return;
        }
        if (newPassword.length < 6) {
            setMessage({ type: 'error', text: 'Ο νέος κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.' });
            return;
        }
        if (newPassword !== confirmPassword) {
            setMessage({ type: 'error', text: 'Οι νέοι κωδικοί δεν ταιριάζουν.' });
            return;
        }

        setLoading(true);
        try {
            // 2. SECURITY CHECK: Verify Old Password first
            // We verify by attempting a background sign-in
            const { error: verifyError } = await supabase.auth.signInWithPassword({
                email: user.email,
                password: oldPassword
            });

            if (verifyError) {
                throw new Error("Ο τρέχων κωδικός είναι λάθος.");
            }

            // 3. IF VERIFIED, UPDATE PASSWORD
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            
            if (error) throw error;

            setMessage({ type: 'success', text: 'Ο κωδικός άλλαξε επιτυχώς!' });
            setOldPassword('');
            setNewPassword('');
            setConfirmPassword('');
            
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
            <button onClick={onBack} style={{ marginBottom: '20px', padding: '8px 12px', cursor: 'pointer', border: 'none', background: '#e0e0e0', borderRadius: '4px', color: '#333' }}>
                ← Πίσω
            </button>

            <h1 style={{ color: '#002F6C', borderBottom: '2px solid #002F6C', paddingBottom: '10px', marginTop: 0 }}>
                Προφίλ Χρήστη
            </h1>

            {/* --- 1. USER INFO --- */}
            <div style={{ marginTop: '20px', background: 'white', padding: '20px', borderRadius: '8px', border: '1px solid #eee', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
                <h3 style={{marginTop: 0, color: '#333'}}>Στοιχεία</h3>
                <div style={{ display: 'grid', gap: '15px', gridTemplateColumns: '1fr 1fr' }}>
                    <div style={{gridColumn: '1 / -1'}}>
                        <label style={{fontSize: '0.85rem', color: '#888', display: 'block'}}>Email</label>
                        <div style={{fontSize: '1.1rem', fontWeight: 500, color: '#444'}}>{user?.email}</div>
                    </div>
                    <div>
                        <label style={{fontSize: '0.85rem', color: '#888', display: 'block'}}>Όνομα</label>
                        <div style={{fontSize: '1.1rem', fontWeight: 500, color: '#444'}}>{user?.name || '-'}</div>
                    </div>
                    <div>
                        <label style={{fontSize: '0.85rem', color: '#888', display: 'block'}}>Επίθετο</label>
                        <div style={{fontSize: '1.1rem', fontWeight: 500, color: '#444'}}>{user?.surname || '-'}</div>
                    </div>
                    <div>
                        <label style={{fontSize: '0.85rem', color: '#888', display: 'block'}}>Ρόλος</label>
                        <div style={{fontSize: '1rem', fontWeight: 600, color: '#002F6C', background: '#e3f2fd', padding: '2px 8px', borderRadius: '4px', display: 'inline-block'}}>
                            {user?.role || 'user'}
                        </div>
                    </div>
                </div>
            </div>

            {/* --- 2. PASSWORD CHANGE (SECURED) --- */}
            <div style={{ marginTop: '30px', background: 'white', padding: '20px', borderRadius: '8px', border: '1px solid #eee', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
                <h3 style={{marginTop: 0, color: '#333'}}>Αλλαγή Κωδικού</h3>
                <form onSubmit={handlePasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    
                    {/* NEW: Old Password Field */}
                    <div style={{position: 'relative'}}>
                        <input 
                            type="password" 
                            placeholder="Τρέχων Κωδικός" 
                            value={oldPassword}
                            onChange={(e) => setOldPassword(e.target.value)}
                            required
                            style={{ width: '100%', boxSizing: 'border-box', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', background: '#fafafa' }}
                        />
                    </div>

                    <div style={{borderTop: '1px dashed #ddd', margin: '5px 0'}}></div>

                    <input 
                        type="password" 
                        placeholder="Νέος Κωδικός" 
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
                    />
                    <input 
                        type="password" 
                        placeholder="Επιβεβαίωση Νέου Κωδικού" 
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
                    />
                    
                    {message.text && (
                        <div style={{ 
                            color: message.type === 'error' ? '#d32f2f' : '#388e3c', 
                            background: message.type === 'error' ? '#ffebee' : '#e8f5e9',
                            padding: '10px', borderRadius: '4px', fontSize: '0.9em' 
                        }}>
                            {message.text}
                        </div>
                    )}

                    <button 
                        type="submit" 
                        disabled={loading}
                        style={{ 
                            padding: '12px', 
                            background: '#002F6C', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: '4px',
                            cursor: loading ? 'default' : 'pointer',
                            fontWeight: 'bold',
                            opacity: loading ? 0.7 : 1
                        }}
                    >
                        {loading ? 'Επαλήθευση & Αλλαγή...' : 'Αλλαγή Κωδικού'}
                    </button>
                </form>
            </div>

            {/* --- 3. 2FA SETTINGS --- */}
            <div style={{ marginTop: '30px', background: 'white', padding: '20px', borderRadius: '8px', border: '1px solid #eee', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
                <h3 style={{marginTop: 0, color: '#333'}}>Ασφάλεια (2FA)</h3>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                    <span>
                        Κατάσταση: <strong style={{color: mfaStatus === 'enabled' ? '#388e3c' : '#d32f2f'}}>
                            {mfaStatus === 'enabled' ? 'Ενεργοποιημένο ✅' : 'Απενεργοποιημένο ❌'}
                        </strong>
                    </span>
                    
                    {mfaStatus !== 'enabled' && (
                        <button 
                            onClick={() => setShowMfaModal(true)}
                            style={{ 
                                padding: '8px 16px', 
                                background: '#e65100', 
                                color: 'white', 
                                border: 'none', 
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: '600'
                            }}
                        >
                            Ενεργοποίηση 2FA
                        </button>
                    )}
                </div>
                {mfaStatus === 'enabled' && (
                    <p style={{ fontSize: '0.9rem', color: '#666', marginTop: '10px' }}>
                        Το 2FA είναι ενεργό. Ο λογαριασμός σας προστατεύεται με κωδικό μιας χρήσης.
                    </p>
                )}
            </div>

            {/* --- 4. MFA MODAL --- */}
            {showMfaModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    background: 'rgba(0,0,0,0.6)', zIndex: 9999, 
                    display: 'flex', justifyContent: 'center', alignItems: 'center',
                    backdropFilter: 'blur(3px)'
                }}>
                    <MFASetup 
                        onCancel={() => setShowMfaModal(false)} 
                        onSuccess={() => {
                            setTimeout(() => {
                                setShowMfaModal(false);
                                checkMfaStatus(); 
                            }, 2000);
                        }}
                    />
                </div>
            )}
        </div>
    );
};