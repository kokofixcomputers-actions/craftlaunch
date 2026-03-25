import { useState, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Loader, ExternalLink, User, Wifi, WifiOff } from 'lucide-react';
import { useStore } from '../store';
import { api } from '../api/bridge';

type State = 'idle' | 'waiting' | 'done' | 'error';
type AccountType = 'online' | 'offline';

export default function OnboardingModal() {
  const { setShowOnboarding, addUser, users } = useStore();
  const isFirstTime = users.length === 0;
  const hasOnlineAccount = users.some(u => u.accountType === 'online');

  const [state, setState] = useState<State>('idle');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('online');
  const [offlineUsername, setOfflineUsername] = useState('');
  const [offlineUuid, setOfflineUuid] = useState('');

  // Register the progress callback so Python can push status strings
  useEffect(() => {
    (window as any).__craftlaunch_auth_progress = (msg: string) => {
      setProgress(msg);
    };
    return () => {
      (window as any).__craftlaunch_auth_progress = null;
    };
  }, []);

  const handleLogin = async () => {
    if (accountType === 'offline') {
      await handleOfflineLogin();
    } else {
      await handleOnlineLogin();
    }
  };

  const handleOnlineLogin = async () => {
    setState('waiting');
    setError('');
    setProgress('Starting Microsoft login…');
    try {
      const user = await api.startMicrosoftLogin() as any;
      addUser({ ...user, accountType: 'online' });
      setState('done');
      setTimeout(() => setShowOnboarding(false), 1500);
    } catch (e: any) {
      setError(e.message || 'Login failed');
      setState('error');
    }
  };

  const handleOfflineLogin = async () => {
    if (!offlineUsername.trim()) {
      setError('Please enter a username');
      setState('error');
      return;
    }

    if (!hasOnlineAccount) {
      setError('You must have at least one valid online account to add offline accounts');
      setState('error');
      return;
    }

    setState('waiting');
    setError('');
    setProgress('Creating offline account…');
    try {
      // Generate a UUID for the offline account (or use provided one)
      const uuid = offlineUuid.trim() || generateOfflineUuid();
      const offlineUser = {
        id: `offline_${Date.now()}`,
        username: offlineUsername.trim(),
        uuid: uuid,
        accessToken: 'offline_token',
        refreshToken: 'offline_refresh',
        isActive: true,
        accountType: 'offline' as const
      };
      addUser(offlineUser);
      setState('done');
      setTimeout(() => setShowOnboarding(false), 1500);
    } catch (e: any) {
      setError(e.message || 'Failed to create offline account');
      setState('error');
    }
  };

  const generateOfflineUuid = () => {
    // Generate a random UUID for offline accounts
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const handleRetry = () => {
    setState('idle');
    setError('');
    setProgress('');
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <div
        className="glass-card w-full max-w-sm mx-4 animate-fadeUp"
        style={{ padding: '2rem', borderRadius: '1.25rem' }}
      >
        {/* Close button — only if not first time */}
        {!isFirstTime && state !== 'waiting' && (
          <button
            onClick={() => setShowOnboarding(false)}
            className="absolute top-4 right-4 w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
          >
            <X size={13} style={{ color: 'var(--text-3)' }} />
          </button>
        )}

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="app-icon w-10 h-10 rounded-xl" style={{ borderRadius: 12, flexShrink: 0 }}>
            <svg width="18" height="18" fill="none" stroke="white" strokeWidth="1.75" viewBox="0 0 24 24">
              <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '1rem' }}>
              {isFirstTime ? 'Welcome to CraftLaunch' : 'Add Account'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
              Choose your account type
            </div>
          </div>
        </div>

        {/* Account Type Selection */}
        {state === 'idle' && (
          <div className="space-y-4">
            {/* Account Type Cards */}
            <div className="space-y-3 mb-4">
              <div
                onClick={() => setAccountType('online')}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  accountType === 'online' 
                    ? 'border-purple-500 bg-purple-500/10' 
                    : 'border-gray-600 bg-gray-600/5 hover:border-gray-500'
                }`}
                style={{
                  borderColor: accountType === 'online' ? 'rgba(139, 92, 246, 0.5)' : 'var(--border)',
                  background: accountType === 'online' ? 'rgba(139, 92, 246, 0.1)' : 'var(--surface-subtle)'
                }}
              >
                <div className="flex items-center gap-3">
                  <Wifi size={18} style={{ color: accountType === 'online' ? '#a78bfa' : 'var(--text-3)' }} />
                  <div className="flex-1">
                    <div style={{ fontWeight: 500, fontSize: '0.9rem', color: 'var(--text)' }}>
                      Online Account
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>
                      Sign in with Microsoft for full features
                    </div>
                  </div>
                  {accountType === 'online' && (
                    <CheckCircle size={16} style={{ color: '#4ade80' }} />
                  )}
                </div>
              </div>

              <div
                onClick={() => setAccountType('offline')}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  accountType === 'offline' 
                    ? 'border-purple-500 bg-purple-500/10' 
                    : 'border-gray-600 bg-gray-600/5 hover:border-gray-500'
                } ${!hasOnlineAccount && !isFirstTime ? 'opacity-50 cursor-not-allowed' : ''}`}
                style={{
                  borderColor: accountType === 'offline' ? 'rgba(139, 92, 246, 0.5)' : 'var(--border)',
                  background: accountType === 'offline' ? 'rgba(139, 92, 246, 0.1)' : 'var(--surface-subtle)'
                }}
              >
                <div className="flex items-center gap-3">
                  <WifiOff size={18} style={{ color: accountType === 'offline' ? '#a78bfa' : 'var(--text-3)' }} />
                  <div className="flex-1">
                    <div style={{ fontWeight: 500, fontSize: '0.9rem', color: 'var(--text)' }}>
                      Offline Account
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>
                      {!hasOnlineAccount && !isFirstTime 
                        ? 'Requires an online account first' 
                        : 'Play without authentication'
                      }
                    </div>
                  </div>
                  {accountType === 'offline' && (
                    <CheckCircle size={16} style={{ color: '#4ade80' }} />
                  )}
                </div>
              </div>
            </div>

            {/* Offline Form Fields */}
            {accountType === 'offline' && (
              <div className="space-y-3">
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-2)', marginBottom: '0.5rem', display: 'block' }}>
                    Username
                  </label>
                  <input
                    type="text"
                    value={offlineUsername}
                    onChange={(e) => setOfflineUsername(e.target.value)}
                    placeholder="Enter username"
                    className="input w-full"
                    style={{ fontSize: '0.9rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-2)', marginBottom: '0.5rem', display: 'block' }}>
                    UUID (optional)
                  </label>
                  <input
                    type="text"
                    value={offlineUuid}
                    onChange={(e) => setOfflineUuid(e.target.value)}
                    placeholder="Auto-generated if empty"
                    className="input w-full"
                    style={{ fontSize: '0.9rem' }}
                  />
                </div>
              </div>
            )}

            {/* Features List for First Time */}
            {isFirstTime && accountType === 'online' && (
              <div className="space-y-1.5 mb-4">
                {[
                  'Multi-instance with shared libraries',
                  'Fabric, Forge, NeoForge & Quilt',
                  'Modrinth mod browser built-in',
                  'Apple Silicon (arm64) support',
                ].map(f => (
                  <div key={f} className="flex items-center gap-2">
                    <CheckCircle size={12} style={{ color: '#4ade80', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-2)' }}>{f}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Info Section */}
            {accountType === 'online' ? (
              <div
                className="rounded-xl p-3 flex items-start gap-2"
                style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)' }}
              >
                <ExternalLink size={12} style={{ color: '#a5b4fc', flexShrink: 0, marginTop: 2 }} />
                <p style={{ fontSize: '0.76rem', color: '#a5b4fc', lineHeight: 1.6 }}>
                  Clicking below will open your browser to Microsoft's login page.
                  After signing in you'll be redirected back automatically — no copy-pasting needed.
                </p>
              </div>
            ) : (
              <div
                className="rounded-xl p-3 flex items-start gap-2"
                style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.18)' }}
              >
                <User size={12} style={{ color: '#a5b4fc', flexShrink: 0, marginTop: 2 }} />
                <p style={{ fontSize: '0.76rem', color: '#a5b4fc', lineHeight: 1.6 }}>
                  Offline accounts allow you to play without authentication.
                  You must have at least one online account to create offline accounts.
                </p>
              </div>
            )}

            <button 
              onClick={handleLogin} 
              className="btn btn-primary w-full justify-center"
              disabled={accountType === 'offline' && !hasOnlineAccount && !isFirstTime}
            >
              {accountType === 'online' ? (
                <>
                  <ExternalLink size={14} />
                  Sign in with Microsoft
                </>
              ) : (
                <>
                  <User size={14} />
                  Create Offline Account
                </>
              )}
            </button>
          </div>
        )}

        {/* WAITING — show animated progress */}
        {state === 'waiting' && (
          <div className="space-y-4">
            <div
              className="rounded-xl p-4 flex flex-col items-center gap-3"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <Loader size={28} className="animate-spin" style={{ color: '#a78bfa' }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 500, fontSize: '0.9rem', marginBottom: 4 }}>
                  {accountType === 'online' ? 'Waiting for Microsoft login…' : 'Creating offline account…'}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#a78bfa', fontFamily: 'DM Mono' }}>
                  {progress || (accountType === 'online' ? 'Opening browser…' : 'Generating account…')}
                </div>
              </div>
            </div>

            {/* Progress steps */}
            <div className="space-y-1.5">
              {accountType === 'online' ? [
                'Browser opened to Microsoft login',
                'Sign in with your Microsoft account',
                'You\'ll be redirected back automatically',
              ] : [
                'Validating offline account requirements',
                'Generating UUID for offline account',
                'Creating account in launcher',
              ].map((step, i) => {
                const stepMsgs = ['Opening', 'Waiting', 'Exchang'];
                const done = stepMsgs.slice(0, i).some(m =>
                  progress.toLowerCase().includes(m.toLowerCase())
                );
                const active = progress.toLowerCase().includes(stepMsgs[i]?.toLowerCase() || '@@');
                return (
                  <div key={i} className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{
                        background: done ? 'rgba(34,197,94,0.15)' : active ? 'rgba(139,92,246,0.2)' : 'var(--surface-strong)',
                        border: `1px solid ${done ? 'rgba(34,197,94,0.3)' : active ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`,
                      }}
                    >
                      {done
                        ? <CheckCircle size={9} style={{ color: '#4ade80' }} />
                        : active
                        ? <Loader size={8} className="animate-spin" style={{ color: '#a78bfa' }} />
                        : <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--text-3)' }} />
                      }
                    </div>
                    <span style={{ fontSize: '0.75rem', color: done || active ? 'var(--text-2)' : 'var(--text-3)' }}>
                      {step}
                    </span>
                  </div>
                );
              })}
            </div>

            <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', textAlign: 'center' }}>
              Listening on <code style={{ fontFamily: 'DM Mono', color: '#a78bfa' }}>localhost:8080/callback</code>
              {' '}· times out in 5 minutes
            </div>
          </div>
        )}

        {/* DONE */}
        {state === 'done' && (
          <div className="text-center py-4">
            <CheckCircle size={40} style={{ color: '#4ade80', margin: '0 auto 12px' }} />
            <div style={{ fontWeight: 500 }}>Signed in!</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-3)', marginTop: 4 }}>
              Closing in a moment…
            </div>
          </div>
        )}

        {/* ERROR */}
        {state === 'error' && (
          <div className="space-y-4">
            <div
              className="rounded-xl p-4 flex items-start gap-2"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              <AlertCircle size={14} style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontWeight: 500, fontSize: '0.84rem', color: '#f87171', marginBottom: 3 }}>
                  Login failed
                </div>
                <div style={{ fontSize: '0.76rem', color: '#fca5a5', lineHeight: 1.5 }}>{error}</div>
              </div>
            </div>

            {/* Common fixes */}
            {error.includes('CLIENT_ID') || error.includes('00000000') ? (
              <div style={{ fontSize: '0.74rem', color: 'var(--text-3)', lineHeight: 1.6 }}>
                <strong style={{ color: 'var(--text-2)' }}>Setup required:</strong> Open{' '}
                <code style={{ fontFamily: 'DM Mono', color: '#a78bfa' }}>backend/auth/microsoft.py</code>{' '}
                and replace <code style={{ fontFamily: 'DM Mono', color: '#a78bfa' }}>CLIENT_ID</code> with
                your Azure App Registration client ID. See README for steps.
              </div>
            ) : error.includes('8080') || error.includes('port') ? (
              <div style={{ fontSize: '0.74rem', color: 'var(--text-3)', lineHeight: 1.6 }}>
                Port 8080 may be in use. Close any other apps using it and try again.
              </div>
            ) : null}

            <div className="flex gap-2">
              {!isFirstTime && (
                <button onClick={() => setShowOnboarding(false)} className="btn btn-ghost flex-1 justify-center">
                  Cancel
                </button>
              )}
              <button onClick={handleRetry} className="btn btn-primary flex-1 justify-center">
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
