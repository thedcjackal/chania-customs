import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import QRCode from 'qrcode';

export const MFASetup = ({ onCancel, onSuccess }) => {
    const [step, setStep] = useState('initial'); // initial, show_qr, success
    const [qrCodeUrl, setQrCodeUrl] = useState('');
    const [factorId, setFactorId] = useState('');
    const [verifyCode, setVerifyCode] = useState('');
    const [error, setError] = useState('');

    const startEnrollment = async () => {
        setError('');
        try {
            // 1. Ask Supabase to start enrollment
            const { data, error } = await supabase.auth.mfa.enroll({
                factorType: 'totp',
            });
            if (error) throw error;

            // 2. Convert the secret into a QR Code image
            setFactorId(data.id);
            const url = await QRCode.toDataURL(data.totp.uri);
            setQrCodeUrl(url);
            setStep('show_qr');
        } catch (err) {
            setError(err.message);
        }
    };

    const verifyEnrollment = async () => {
        setError('');
        try {
            // 3. Verify the code the user types to confirm it works
            const { data, error } = await supabase.auth.mfa.challengeAndVerify({
                factorId: factorId,
                code: verifyCode,
            });
            if (error) throw error;

            setStep('success');
            if(onSuccess) onSuccess();
        } catch (err) {
            setError("Λάθος κωδικός. Προσπαθήστε ξανά.");
        }
    };

    return (
        <div style={{ padding: 20, maxWidth: 400, margin: '0 auto', background: 'white', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
            <h2 style={{ color: '#002F6C', marginTop: 0 }}>Ρύθμιση 2FA</h2>

            {step === 'initial' && (
                <div>
                    <p>Προσθέστε ένα επιπλέον επίπεδο ασφαλείας στο λογαριασμό σας.</p>
                    <button onClick={startEnrollment} className="btn-primary" style={{ width: '100%', padding: 10, background: '#002F6C', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                        Ενεργοποίηση 2FA
                    </button>
                    <button onClick={onCancel} style={{ width: '100%', marginTop: 10, padding: 10, background: 'transparent', border: 'none', color: '#666', cursor: 'pointer' }}>
                        Ακύρωση
                    </button>
                </div>
            )}

            {step === 'show_qr' && (
                <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '0.9rem' }}>Σκανάρετε αυτόν τον κωδικό με το <strong>Google Authenticator</strong> ή το <strong>Authy</strong>.</p>
                    <img src={qrCodeUrl} alt="QR Code" style={{ border: '1px solid #eee', padding: 10, borderRadius: 4 }} />
                    
                    <div style={{ marginTop: 20 }}>
                        <label style={{ display: 'block', marginBottom: 5, fontWeight: 'bold' }}>Εισάγετε τον 6ψήφιο κωδικό:</label>
                        <input 
                            type="text" 
                            maxLength="6"
                            value={verifyCode}
                            onChange={(e) => setVerifyCode(e.target.value)}
                            style={{ width: '100%', padding: 10, fontSize: '1.2rem', textAlign: 'center', letterSpacing: 5 }}
                            placeholder="000000"
                        />
                    </div>

                    {error && <div style={{ color: 'red', marginTop: 10 }}>{error}</div>}

                    <button onClick={verifyEnrollment} className="btn-primary" style={{ width: '100%', marginTop: 20, padding: 10, background: '#002F6C', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                        Επιβεβαίωση & Ενεργοποίηση
                    </button>
                </div>
            )}

            {step === 'success' && (
                <div style={{ textAlign: 'center', color: 'green' }}>
                    <h3>✅ Επιτυχία!</h3>
                    <p>Ο λογαριασμός σας είναι πλέον προστατευμένος με 2FA.</p>
                    <button onClick={onCancel} style={{ padding: '8px 20px', background: '#eee', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                        Κλείσιμο
                    </button>
                </div>
            )}
        </div>
    );
};