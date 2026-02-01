import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import QRCode from 'qrcode';

export const MFASetup = ({ onCancel, onSuccess }) => {
    const [mode, setMode] = useState('loading'); // loading, setup_initial, show_qr, success, manage
    const [qrCodeUrl, setQrCodeUrl] = useState('');
    const [factorId, setFactorId] = useState('');
    const [verifyCode, setVerifyCode] = useState('');
    const [error, setError] = useState('');

    // Check status on load
    useEffect(() => {
        checkStatus();
    }, []);

    const checkStatus = async () => {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const existingFactor = factors?.totp?.find(f => f.status === 'verified');
        
        if (existingFactor) {
            setFactorId(existingFactor.id);
            setMode('manage'); // Already has 2FA -> Show Deactivate option
        } else {
            setMode('setup_initial'); // No 2FA -> Show Setup option
        }
    };

    // --- SETUP FLOW ---
    const startEnrollment = async () => {
        setError('');
        try {
            const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
            if (error) throw error;

            setFactorId(data.id);
            const url = await QRCode.toDataURL(data.totp.uri);
            setQrCodeUrl(url);
            setMode('show_qr');
        } catch (err) {
            setError(err.message);
        }
    };

    const verifyEnrollment = async () => {
        setError('');
        try {
            const { error } = await supabase.auth.mfa.challengeAndVerify({
                factorId: factorId,
                code: verifyCode,
            });
            if (error) throw error;

            setMode('success');
            if(onSuccess) onSuccess();
        } catch (err) {
            setError("Λάθος κωδικός. Προσπαθήστε ξανά.");
        }
    };

    // --- DEACTIVATE FLOW ---
    const handleDeactivate = async () => {
        if(!window.confirm("Είστε σίγουρος; Ο λογαριασμός σας θα είναι λιγότερο ασφαλής.")) return;
        
        try {
            const { error } = await supabase.auth.mfa.unenroll({ factorId });
            if (error) throw error;
            
            alert("Το 2FA απενεργοποιήθηκε.");
            onCancel(); // Close modal
        } catch (err) {
            setError("Σφάλμα απενεργοποίησης: " + err.message);
        }
    };

    return (
        <div style={{ padding: 25, maxWidth: 400, width: '100%', background: 'white', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
            <h2 style={{ color: '#002F6C', marginTop: 0, borderBottom: '1px solid #eee', paddingBottom: 10 }}>Διαχείριση 2FA</h2>

            {mode === 'loading' && <p>Έλεγχος κατάστασης...</p>}

            {/* --- CASE 1: NO 2FA YET --- */}
            {mode === 'setup_initial' && (
                <div>
                    <p style={{color: '#555', lineHeight: 1.5}}>
                        Προστατέψτε το λογαριασμό σας ενεργοποιώντας τον έλεγχο ταυτότητας δύο παραγόντων (2FA).
                    </p>
                    <button onClick={startEnrollment} className="btn-primary" style={styles.primaryBtn}>
                        Ενεργοποίηση
                    </button>
                    <button onClick={onCancel} style={styles.textBtn}>Ακύρωση</button>
                </div>
            )}

            {/* --- CASE 2: SCAN QR --- */}
            {mode === 'show_qr' && (
                <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '0.9rem', color: '#666' }}>
                        1. Ανοίξτε το <strong>Google Authenticator</strong>.<br/>
                        2. Σκανάρετε το QR Code.<br/>
                        3. Εισάγετε τον κωδικό παρακάτω.
                    </p>
                    <img src={qrCodeUrl} alt="QR Code" style={{ border: '1px solid #eee', padding: 10, borderRadius: 8, marginBottom: 15 }} />
                    
                    <input 
                        type="text" 
                        maxLength="6"
                        value={verifyCode}
                        onChange={(e) => setVerifyCode(e.target.value)}
                        style={styles.inputCode}
                        placeholder="000000"
                        autoFocus
                    />

                    {error && <div style={{ color: 'red', marginTop: 10, fontSize: '0.9rem' }}>{error}</div>}

                    <button onClick={verifyEnrollment} style={styles.primaryBtn}>Επιβεβαίωση</button>
                    <button onClick={onCancel} style={styles.textBtn}>Ακύρωση</button>
                </div>
            )}

            {/* --- CASE 3: SUCCESS --- */}
            {mode === 'success' && (
                <div style={{ textAlign: 'center', color: 'green' }}>
                    <h3>✅ Επιτυχία!</h3>
                    <p>Το 2FA ενεργοποιήθηκε.</p>
                    <button onClick={onCancel} style={styles.secondaryBtn}>Κλείσιμο</button>
                </div>
            )}

            {/* --- CASE 4: ALREADY ACTIVE (MANAGE) --- */}
            {mode === 'manage' && (
                <div style={{textAlign: 'center'}}>
                    <div style={{background: '#e8f5e9', color: '#2e7d32', padding: 10, borderRadius: 6, marginBottom: 20}}>
                        <strong>✓ Το 2FA είναι ενεργό</strong>
                    </div>
                    <p style={{fontSize: '0.9rem', color: '#666'}}>
                        Ο λογαριασμός σας είναι ασφαλής. Αν θέλετε να το απενεργοποιήσετε, πατήστε το κουμπί παρακάτω.
                    </p>
                    
                    {error && <div style={{ color: 'red', marginBottom: 10 }}>{error}</div>}

                    <button onClick={handleDeactivate} style={{...styles.primaryBtn, background: '#c62828'}}>
                        Απενεργοποίηση 2FA
                    </button>
                    <button onClick={onCancel} style={styles.textBtn}>Κλείσιμο</button>
                </div>
            )}
        </div>
    );
};

const styles = {
    primaryBtn: { width: '100%', padding: 12, background: '#002F6C', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '1rem', marginTop: 10 },
    secondaryBtn: { padding: '8px 20px', background: '#eee', border: 'none', borderRadius: 4, cursor: 'pointer' },
    textBtn: { width: '100%', marginTop: 10, padding: 10, background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', textDecoration: 'underline' },
    inputCode: { width: '80%', padding: 10, fontSize: '1.4rem', textAlign: 'center', letterSpacing: 5, border: '2px solid #002F6C', borderRadius: 6 }
};