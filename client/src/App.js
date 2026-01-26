import React, { useState } from 'react';
import './App.css';

// Import Shared Layout Components
import { 
    WelcomePage, 
    AnnouncementsPage, 
    Login, 
    ServicePortal 
} from './components/Layout';

// Import Sub-Applications
import { FuelApp } from './apps/FuelApp';
import { ServicesApp } from './apps/ServicesApp';
import { AnnouncementsApp } from './apps/AnnouncementsApp';
import { AccountManager } from './apps/AccountManager';

const App = () => {
    // State for routing and user session
    const [page, setPage] = useState('welcome'); 
    const [user, setUser] = useState(null);
    const [activeApp, setActiveApp] = useState(null);

    // --- Handlers ---
    const handleLogin = (u) => { 
        setUser(u); 
        setPage('portal'); 
    };

    const handleAppLaunch = (appName) => { 
        setActiveApp(appName); 
        setPage('app_view'); 
    };

    const handleExitApp = () => {
        setPage('portal');
        setActiveApp(null);
    };

    const handleLogout = () => {
        setUser(null);
        setPage('welcome');
        setActiveApp(null);
    };

    // --- Render Logic ---
    
    // 1. Public Pages
    if (page === 'welcome') return <WelcomePage onNavigate={setPage} />;
    if (page === 'login') return <Login onLogin={handleLogin} onBack={() => setPage('welcome')} />;
    if (page === 'announcements') return <AnnouncementsPage onNavigate={setPage} />;
    
    // 2. Main Portal (App Selection)
    if (page === 'portal') return <ServicePortal user={user} onNavigate={handleAppLaunch} onLogout={handleLogout} />;
    
    // 3. Active Sub-App View
    if (page === 'app_view') {
        switch (activeApp) {
            case 'fuel_app':
                return <FuelApp user={user} onExit={handleExitApp} />;
            case 'services_app':
                return <ServicesApp user={user} onExit={handleExitApp} />;
            case 'announcements_app':
                return <AnnouncementsApp user={user} onExit={handleExitApp} />;
            case 'accounts_app':
                return <AccountManager user={user} onExit={handleExitApp} />;
            default:
                // Fallback if app not found
                return <ServicePortal user={user} onNavigate={handleAppLaunch} onLogout={handleLogout} />;
        }
    }

    return null;
};

export default App;