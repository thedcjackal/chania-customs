import React from 'react';
import { AppHeader } from '../components/Layout';
import { UserManager } from '../components/AdminTools';

export const AccountManager = ({ user, onExit }) => {
    return (
        <div className="app-shell"><AppHeader title="Διαχείριση Λογαριασμών" user={user} onExit={onExit} icon={<span>🔐</span>} />
        <UserManager />
        </div>
    );
};