import { useEffect, useState } from 'react';
import { useStore } from './store';
import Titlebar from './components/Titlebar';
import Sidebar from './components/Sidebar';
import HomePage from './pages/HomePage';
import InstancesPage from './pages/InstancesPage';
import InstanceDetailPage from './pages/InstanceDetailPage';
import ModsPage from './pages/ModsPage';
import ModpacksPage from './pages/ModpacksPage';
import ResourcePacksPage from './pages/ResourcePacksPage';
import ShaderPacksPage from './pages/ShaderPacksPage';
import SettingsPage from './pages/SettingsPage';
import LogPage from './pages/LogPage';
import OnboardingModal from './components/OnboardingModal';

function LoadingScreen({ error }: { error?: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-4" style={{ background: 'var(--bg)' }}>
      <div
        className="app-icon w-16 h-16 rounded-2xl"
        style={{ animation: 'pulse 2s ease infinite', borderRadius: 20 }}
      >
        <svg width="28" height="28" fill="none" stroke="white" strokeWidth="1.75" viewBox="0 0 24 24">
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <path d="M8 21h8M12 17v4"/>
        </svg>
      </div>
      {error ? (
        <>
          <span style={{ color: 'var(--error)', fontSize: '0.84rem', textAlign: 'center', maxWidth: 300 }}>
            Initialization failed: {error}
          </span>
          <button 
            onClick={() => window.location.reload()}
            style={{ 
              padding: '8px 16px', 
              background: 'var(--primary)', 
              color: 'white', 
              border: 'none', 
              borderRadius: '6px',
              fontSize: '0.84rem',
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
        </>
      ) : (
        <>
          <span style={{ color: 'var(--text-3)', fontSize: '0.84rem' }}>Loading CraftLaunch…</span>
          <div style={{ width: 160, height: 4, background: 'var(--surface-strong)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: '60%',
              background: 'linear-gradient(90deg,#8b5cf6,#6366f1)',
              borderRadius: 999,
            }} />
          </div>
          <span style={{ color: 'var(--text-3)', fontSize: '0.75rem' }}>Waiting for backend to initialize…</span>
        </>
      )}
    </div>
  );
}

export default function App() {
  const { page, isInitialized, showOnboarding, initError, initialize } = useStore();
  const [isLogWindow, setIsLogWindow] = useState(false);

  useEffect(() => {
    initialize();
  }, []);

  // Check if we're in a log window (hash-based routing)
  useEffect(() => {
    const checkHash = () => {
      const hash = window.location.hash;
      setIsLogWindow(hash.startsWith('#log/'));
    };

    checkHash();
    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  }, []);

  // If we're in a log window, show only the LogPage
  if (isLogWindow) {
    return <LogPage />;
  }

  return (
    // Root: full height column, no overflow
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/*
        Titlebar is ALWAYS the first child — it sits at z-index 9999
        and appears above every modal including onboarding.
        It renders even during loading and onboarding.
      */}
      <Titlebar />

      {/* Everything below the titlebar */}
      {!isInitialized ? (
        <LoadingScreen error={initError} />
      ) : (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
          <Sidebar />
          <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            {page === 'home'            && <HomePage />}
            {page === 'instances'       && <InstancesPage />}
            {page === 'instance-detail' && <InstanceDetailPage />}
            {page === 'mods'            && <ModsPage />}
            {page === 'modpacks'        && <ModpacksPage />}
            {page === 'resourcepacks'  && <ResourcePacksPage />}
            {page === 'shaderpacks'    && <ShaderPacksPage />}
            {page === 'settings'        && <SettingsPage />}
          </main>

          {/* Onboarding overlays the sidebar+main area but NOT the titlebar */}
          {showOnboarding && <OnboardingModal />}
        </div>
      )}
    </div>
  );
}
