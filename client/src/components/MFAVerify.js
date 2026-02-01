import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';

export const MFAVerify = () => {
    const [code, setCode] = useState('');
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [factorId, setFactorId] = useState(null);

    useEffect(() => {
        const getFactor = async () => {
            const { data: factors } = await supabase.auth.mfa.listFactors();
            const totp = factors?.totp?.find(f => f.status === 'verified');
            if (totp) setFactorId(totp.id);
        };
        getFactor();
    }, []);

    const handleVerify = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { data, error } = await supabase.auth.mfa.challengeAndVerify({
                factorId: factorId,
                code: code,
            });

            if (error) throw error;

            // SUCCESS: Force a session refresh so App.js detects the security level change immediately
            await supabase.auth.refreshSession();
            
        } catch (err) {
            setError('Λάθος κωδικός.');
            setLoading(false);
        }
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
    };

    return (
        <div style={{
            height: '100vh', display: 'flex', alignItems: 'center', 
            justifyContent: 'center', background: '#f0f2f5'
        }}>
            <div style={{
                background: 'white', padding: 40, borderRadius: 12, 
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)', width: '100%', maxWidth: 400, textAlign: 'center'
            }}>
                <h2 style={{color: '#002F6C', marginTop: 0}}>Έλεγχος 2FA</h2>
                <p style={{color: '#666', marginBottom: 20}}>
                    Εισάγετε τον κωδικό από την εφαρμογή Authenticator.
                </p>

                <form onSubmit={handleVerify}>
                    <input 
                        type="text" 
                        maxLength="6"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="000000"
                        autoFocus
                        style={{
                            width: '100%', padding: '15px', fontSize: '1.5rem', 
                            textAlign: 'center', letterSpacing: '8px', marginBottom: 20,
                            border: '2px solid #002F6C', borderRadius: 8, fontWeight: 'bold'
                        }}
                    />
                    
                    {error && <div style={{color: 'red', marginBottom: 15}}>{error}</div>}

                    <button 
                        type="submit" 
                        disabled={loading || !factorId}
                        style={{
                            width: '100%', padding: 12, background: '#002F6C', 
                            color: 'white', border: 'none', borderRadius: 6, 
                            cursor: 'pointer', fontSize: '1.1rem'
                        }}
                    >
                        {loading ? 'Επιβεβαίωση...' : 'Επιβεβαίωση'}
                    </button>
                </form>

                <button 
                    onClick={handleLogout}
                    style={{
                        background: 'none', border: 'none', color: '#666', 
                        marginTop: 20, cursor: 'pointer', textDecoration: 'underline'
                    }}
                >
                    Ακύρωση & Έξοδος
                </button>
            </div>
        </div>
    );
};