import { useState, useEffect } from 'react';
import { FolderOpen, RefreshCw, CheckCircle, AlertTriangle, UserX, ExternalLink, Sun, Moon, Monitor, FlaskConical, Loader } from 'lucide-react';
import { useStore, type Theme } from '../store';
import { api } from '../api/bridge';

const THEME_OPTIONS: { value: Theme; label: string; icon: any }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'dark',   label: 'Dark',   icon: Moon },
  { value: 'light',  label: 'Light',  icon: Sun },
];

export default function SettingsPage() {
  const { users, activeUserId, removeUser, setActiveUser, setShowOnboarding,
          systemInfo, instances, theme, setTheme } = useStore();

  const [javas, setJavas] = useState<any[]>([]);
  const [scanningJava, setScanningJava] = useState(false);
  const [confirmRemoveUser, setConfirmRemoveUser] = useState<string | null>(null);
  const [selectedJava, setSelectedJava] = useState<any>(null);

  // Custom java path test
  const [customJavaPath, setCustomJavaPath] = useState('');
  const [javaTestResult, setJavaTestResult] = useState<any>(null);
  const [testingJava, setTestingJava] = useState(false);

  const dataDir = systemInfo?.os === 'darwin'
    ? '~/Library/Application Support/CraftLaunch'
    : systemInfo?.os === 'windows'
    ? '%APPDATA%\\CraftLaunch'
    : '~/.craftlaunch';

  const scanJava = async () => {
    setScanningJava(true);
    try { 
      const result = await api.findJava(); 
      console.log('[Frontend] scanJava result:', result);
      setJavas(result || []); 
    } catch (e: any) {
      console.error('[Frontend] scanJava error:', e);
    } finally {
      setScanningJava(false);
    }
  };

  useEffect(() => { scanJava(); }, []);

  const testJava = async () => {
    if (!customJavaPath.trim()) return;
    setTestingJava(true);
    setJavaTestResult(null);
    try {
      const result = await api.testJava(customJavaPath.trim());
      setJavaTestResult(result);
    } catch (e: any) {
      setJavaTestResult({ valid: false, raw: e.message });
    }
    setTestingJava(false);
  };

  const handleRemoveUser = (id: string) => {
    removeUser(id);
    setConfirmRemoveUser(null);
  };

  const openDataDir = () => {
    // Build actual path for backend
    const expandedPath = systemInfo?.os === 'darwin'
      ? `${(window as any).__craftlaunch_home || '~'}/Library/Application Support/CraftLaunch`
      : dataDir;
    api.openFolder(expandedPath).catch(() => {});
  };

  const setJavaAsDefault = async (javaInfo: any) => {
    try {
      await api.setDefaultJava(javaInfo.path);
      console.log('Set Java as default:', javaInfo.path);
      alert(`Set Java as default: ${javaInfo.path}`);
      // Refresh the Java list to show the new default
      await scanJava();
    } catch (e: any) {
      console.error('Failed to set default Java:', e);
      alert(`Failed to set default Java: ${e.message || e}`);
    }
  };

  const saveCustomJava = async (javaInfo: any) => {
    try {
      await api.setDefaultJava(javaInfo.path);
      console.log('Saved custom Java:', javaInfo.path);
      alert(`Saved custom Java path: ${javaInfo.path}`);
      setCustomJavaPath(''); // Clear the input
      setJavaTestResult(null); // Clear test result
      // Refresh the Java list to show the new default
      await scanJava();
    } catch (e: any) {
      console.error('Failed to save custom Java:', e);
      alert(`Failed to save custom Java: ${e.message || e}`);
    }
  };

  const sharedSets = new Map<string, number>();
  for (const inst of instances) {
    const key = `${inst.minecraftVersion}/${inst.modLoader}/${inst.modLoaderVersion || 'none'}`;
    sharedSets.set(key, (sharedSets.get(key) || 0) + 1);
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <div style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
        Settings
      </div>

      {/* ── Theme ── */}
      <section className="glass-card p-5">
        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-2)', marginBottom: 12 }}>Appearance</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              style={{
                flex: 1, padding: '0.65rem 0', borderRadius: 10,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                background: theme === value ? 'rgba(139,92,246,0.15)' : 'var(--surface)',
                border: `1px solid ${theme === value ? 'rgba(139,92,246,0.35)' : 'var(--border)'}`,
                color: theme === value ? '#c4b5fd' : 'var(--text-3)',
                cursor: 'pointer', transition: 'all 0.2s',
              }}
            >
              <Icon size={15} strokeWidth={1.75} />
              <span style={{ fontSize: '0.74rem', fontWeight: theme === value ? 500 : 400 }}>{label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Accounts ── */}
      <section className="glass-card p-5">
        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-2)', marginBottom: 12 }}>Microsoft Accounts</div>
        {users.length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: '0.84rem', marginBottom: 12 }}>No accounts signed in.</div>
        ) : (
          <div className="space-y-2 mb-3">
            {users.map(u => (
              <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', fontSize: '0.7rem', fontWeight: 700, color: 'white' }}>
                  {u.username[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: '0.86rem', fontWeight: 500 }}>{u.username}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', fontFamily: 'DM Mono' }}>{u.uuid}</div>
                </div>
                {u.id === activeUserId
                  ? <span className="badge badge-success" style={{ fontSize: '0.62rem' }}>Active</span>
                  : <button onClick={() => setActiveUser(u.id)} className="btn btn-ghost btn-sm">Switch</button>}
                <button onClick={() => setConfirmRemoveUser(u.id)} className="btn btn-ghost btn-sm" style={{ padding: '0.3rem', color: '#f87171' }}>
                  <UserX size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => setShowOnboarding(true)} className="btn btn-primary btn-sm">
          <ExternalLink size={13} /> Add Account
        </button>
      </section>

      {/* ── Java ── */}
      <section className="glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-2)' }}>Java Installations</div>
          <button onClick={scanJava} disabled={scanningJava} className="btn btn-primary btn-sm">
            <RefreshCw size={12} className={scanningJava ? 'animate-spin' : ''} /> Scan
          </button>
        </div>

        {javas.length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: '0.84rem', marginBottom: 12 }}>
            {scanningJava ? 'Scanning…' : 'No Java installations found.'}
          </div>
        ) : (
          <div className="space-y-2 mb-4">
            {javas.map((j, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl cursor-pointer hover:bg-opacity-80" 
                   style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
                   onClick={() => setSelectedJava(j)}>
                {j.valid
                  ? <CheckCircle size={14} style={{ color: '#4ade80', flexShrink: 0 }} />
                  : <AlertTriangle size={14} style={{ color: '#f87171', flexShrink: 0 }} />}
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: '0.78rem', fontFamily: 'DM Mono, monospace', color: 'var(--text-2)' }} className="truncate">{j.path}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-3)' }}>Java {j.version} · {j.arch}</div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setJavaAsDefault(j); }} 
                        className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}>
                  Set Default
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Custom Java path tester */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>
            Test Custom Java Path
          </div>
          <div className="flex gap-2">
            <input
              className="input"
              style={{ flex: 1, fontFamily: 'DM Mono, monospace', fontSize: '0.78rem' }}
              value={customJavaPath}
              onChange={e => setCustomJavaPath(e.target.value)}
              placeholder="/path/to/java or java"
              onKeyDown={e => e.key === 'Enter' && testJava()}
            />
            <button onClick={testJava} disabled={testingJava || !customJavaPath.trim()} className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }}>
              {testingJava ? <Loader size={12} className="animate-spin" /> : <FlaskConical size={12} />}
              Test
            </button>
            {javaTestResult?.valid && (
              <button onClick={() => saveCustomJava(javaTestResult)} 
                      className="btn btn-primary btn-sm" style={{ flexShrink: 0 }}>
                Save & Use
              </button>
            )}
          </div>
          {javaTestResult && (
            <div className="mt-2 p-3 rounded-xl" style={{
              background: javaTestResult.valid ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.07)',
              border: `1px solid ${javaTestResult.valid ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
            }}>
              <div className="flex items-center gap-2 mb-1">
                {javaTestResult.valid
                  ? <CheckCircle size={12} style={{ color: '#4ade80' }} />
                  : <AlertTriangle size={12} style={{ color: '#f87171' }} />}
                <span style={{ fontSize: '0.78rem', fontWeight: 500, color: javaTestResult.valid ? '#4ade80' : '#f87171' }}>
                  {javaTestResult.valid ? `Java ${javaTestResult.version} (${javaTestResult.arch})` : 'Invalid Java path'}
                </span>
              </div>
              {javaTestResult.raw && (
                <pre style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.67rem', color: 'var(--text-3)', whiteSpace: 'pre-wrap', margin: 0 }}>
                  {javaTestResult.raw}
                </pre>
              )}
            </div>
          )}
        </div>

        <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginTop: 12, lineHeight: 1.65 }}>
          <strong style={{ color: 'var(--text-2)' }}>Apple Silicon recommendation:</strong> Install Azul Zulu JDK — they provide native arm64 builds.
          Zulu 8 for ≤1.16, Zulu 17 for 1.17–1.20.4, Zulu 21 for 1.20.5+.
        </div>
      </section>

      {/* ── Shared Library Sets ── */}
      <section className="glass-card p-5">
        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}>Shared Library Sets</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.6 }}>
          Instances sharing the same Minecraft version + modloader + loader version share one copy of library jars on disk.
        </div>
        {sharedSets.size === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>No instances yet.</div>
        ) : (
          <div className="space-y-1.5">
            {[...sharedSets.entries()].map(([key, count]) => (
              <div key={key} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.74rem', color: 'var(--code-color)', flex: 1 }}>{key}</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-3)', flexShrink: 0 }}>{count} instance{count !== 1 ? 's' : ''} sharing</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Data Location ── */}
      <section className="glass-card p-5">
        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>Data Location</div>
        <div className="flex items-center gap-3">
          <code style={{
            flex: 1, fontFamily: 'DM Mono, monospace', fontSize: '0.76rem',
            color: 'var(--code-color)', background: 'rgba(139,92,246,0.08)',
            padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(139,92,246,0.15)',
          }}>
            {dataDir}
          </code>
          <button onClick={openDataDir} className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}>
            <FolderOpen size={13} /> Open
          </button>
        </div>
      </section>

      {/* ── System ── */}
      {systemInfo && (
        <section className="glass-card p-5">
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>System</div>
          <div className="space-y-1">
            {[
              ['Platform', systemInfo.platform],
              ['Architecture', `${systemInfo.arch}${systemInfo.arch === 'arm64' ? ' (Apple Silicon)' : ''}`],
              ['Launcher', 'NebulusLaunch 1.0.0'],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-3" style={{ fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--text-3)', minWidth: 90 }}>{label}</span>
                <span style={{ color: 'var(--text-2)' }}>{value}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Remove user confirm */}
      {confirmRemoveUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="glass-card p-6 w-80 animate-fadeUp" style={{ borderRadius: '1.25rem' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Remove Account?</div>
            <div style={{ fontSize: '0.84rem', color: 'var(--text-2)', marginBottom: 20 }}>
              This removes the account from the launcher. You can re-add it any time.
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmRemoveUser(null)} className="btn btn-ghost flex-1 justify-center">Cancel</button>
              <button onClick={() => handleRemoveUser(confirmRemoveUser)} className="btn btn-danger flex-1 justify-center">Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
