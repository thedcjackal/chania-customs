import React from 'react';
import { AppHeader } from '../components/Layout';
import { AnnouncementManager } from '../components/AdminTools';

export const AnnouncementsApp = ({ user, onExit }) => {
    return (
        <div className="app-shell">
            <AppHeader title="Διαχείριση Ανακοινώσεων" user={user} onExit={onExit} icon={<span>📢</span>} />
            <AnnouncementManager />
        </div>
    );
};