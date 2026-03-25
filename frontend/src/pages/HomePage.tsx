import { useState } from 'react';
import { Play, Plus, Clock, Layers, Puzzle, Cpu } from 'lucide-react';
import { useStore } from '../store';
import { api } from '../api/bridge';
import CreateInstanceModal from '../components/CreateInstanceModal';
import LogViewer from '../components/LogViewer';

const LOADER_DOT: Record<string, string> = {
  fabric: '#b6844b', forge: '#346aa9', neoforge: '#e07c2e', quilt: '#9b59b6', vanilla: '#4ade80',
};

export default function HomePage() {
  const { instances, navigate, users, activeUserId, setShowOnboarding, setInstanceRunning, systemInfo } = useStore();
  const [showCreate, setShowCreate] = useState(false);
  const [launching, setLaunching] = useState<string | null>(null);
  const [logInstance, setLogInstance] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<Record<string, string>>({});

  const activeUser = users.find(u => u.id === activeUserId);
  const recent = [...instances].sort((a, b) => (b.lastPlayed || b.createdAt).localeCompare(a.lastPlayed || a.createdAt)).slice(0, 6);
  const running = instances.filter(i => i.isRunning);

  const launch = async (inst: typeof instances[0]) => {
    if (!activeUser) { setShowOnboarding(true); return; }
    setLaunching(inst.id);
    setLaunchError(prev => ({ ...prev, [inst.id]: '' }));
    try {
      const result = await api.launchInstance(inst.id, activeUser.id);
      if (result.success) {
        setInstanceRunning(inst.id, true, result.pid);
        api.openLogWindow(inst.id, inst.name).catch(() => setLogInstance(inst.id));
      } else {
        setLaunchError(prev => ({ ...prev, [inst.id]: result.error || 'Failed to launch' }));
      }
    } catch (e: any) {
      setLaunchError(prev => ({ ...prev, [inst.id]: e.message }));
    } finally {
      setLaunching(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Hero */}
      <div className="mb-8 animate-fadeUp">
        <div className="flex items-center gap-3 mb-1">
          <div className="app-icon w-10 h-10 rounded-xl" style={{ borderRadius: 12 }}>
            <svg width="18" height="18" fill="none" stroke="white" strokeWidth="1.75" viewBox="0 0 24 24">
              <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
            </svg>
          </div>
          <div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.2 }}>
              {activeUser ? `Welcome back, ${activeUser.username}` : 'CraftLaunch'}
            </h1>
            {systemInfo && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                {systemInfo.platform} · {systemInfo.arch}
                {systemInfo.arch === 'arm64' && ' · Apple Silicon'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Running instances */}
      {running.length > 0 && (
        <div className="mb-6 animate-fadeUp">
          <div className="flex items-center gap-2 mb-3">
            <span className="animate-pulse w-2 h-2 rounded-full" style={{ background: '#4ade80' }} />
            <span style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              Running ({running.length})
            </span>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {running.map(inst => (
              <div key={inst.id} className="glass-card p-3 flex items-center gap-3">
                <span className="animate-pulse w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#4ade80' }} />
                <div className="flex-1 min-w-0">
                  <div style={{ fontWeight: 500, fontSize: '0.88rem' }} className="truncate">{inst.name}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>{inst.minecraftVersion} · {inst.modLoader}</div>
                </div>
                <button onClick={() => setLogInstance(inst.id)} className="btn btn-ghost btn-sm">Logs</button>
                <button onClick={() => api.killInstance(inst.id).then(() => setInstanceRunning(inst.id, false))}
                  className="btn btn-danger btn-sm">Kill</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-6 animate-fadeUp delay-1">
        {[
          { icon: Layers, label: 'Instances', value: instances.length, color: '#a78bfa' },
          { icon: Puzzle, label: 'Mods Installed', value: instances.reduce((acc, i) => acc + i.mods.length, 0), color: '#60a5fa' },
          { icon: Cpu, label: 'Running', value: running.length, color: '#4ade80' },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="glass-card p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}18`, border: `1px solid ${color}25` }}>
              <Icon size={16} style={{ color }} strokeWidth={1.75} />
            </div>
            <div>
              <div style={{ fontSize: '1.2rem', fontWeight: 600, lineHeight: 1.1 }}>{value}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent instances */}
      <div className="animate-fadeUp delay-2">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Clock size={13} style={{ color: 'var(--text-3)' }} />
            <span style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              {recent.length > 0 ? 'Recent Instances' : 'Get Started'}
            </span>
          </div>
          {instances.length > 0 && (
            <button onClick={() => navigate('instances')} style={{ fontSize: '0.75rem', color: '#a78bfa' }}>View all →</button>
          )}
        </div>

        {recent.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <div className="app-icon w-14 h-14 rounded-2xl mx-auto mb-4" style={{ borderRadius: 16 }}>
              <Layers size={24} strokeWidth={1.75} color="white" />
            </div>
            <div style={{ fontWeight: 500, marginBottom: 6 }}>No instances yet</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginBottom: 16 }}>
              Create your first instance to start playing Minecraft
            </div>
            <button onClick={() => !activeUser ? setShowOnboarding(true) : setShowCreate(true)} className="btn btn-primary">
              <Plus size={14} /> Create Instance
            </button>
          </div>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {recent.map((inst, i) => (
              <div key={inst.id} className="glass-card p-4 group cursor-pointer animate-fadeUp" style={{ animationDelay: `${i * 60}ms` }}
                onClick={() => navigate('instance-detail', inst.id)}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{
                    background: `linear-gradient(135deg, ${LOADER_DOT[inst.modLoader] || '#888'}22, ${LOADER_DOT[inst.modLoader] || '#888'}44)`,
                    border: `1px solid ${LOADER_DOT[inst.modLoader] || '#888'}33`,
                  }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: LOADER_DOT[inst.modLoader] || '#888', fontFamily: 'DM Mono' }}>
                      {inst.minecraftVersion.split('.').slice(0, 2).join('.')}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontWeight: 500, fontSize: '0.9rem' }} className="truncate">{inst.name}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                      {inst.minecraftVersion} · {inst.modLoader}
                      {inst.mods.length > 0 && ` · ${inst.mods.length} mods`}
                    </div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); launch(inst); }}
                    disabled={!!launching || inst.isRunning}
                    className="btn btn-success btn-sm opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ flexShrink: 0 }}>
                    <Play size={11} fill="currentColor" />
                    {inst.isRunning ? 'Running' : launching === inst.id ? '…' : 'Play'}
                  </button>
                </div>
                {launchError[inst.id] && (
                  <div style={{ fontSize: '0.72rem', color: '#f87171', marginTop: 6 }}>{launchError[inst.id]}</div>
                )}
              </div>
            ))}
            {/* New instance card */}
            <button onClick={() => !activeUser ? setShowOnboarding(true) : setShowCreate(true)}
              className="glass-card p-4 flex items-center gap-3 w-full transition-all hover:scale-[1.01]"
              style={{ border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-3)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ border: '1px dashed var(--border)' }}>
                <Plus size={16} />
              </div>
              <span style={{ fontSize: '0.88rem' }}>New Instance</span>
            </button>
          </div>
        )}
      </div>

      {showCreate && <CreateInstanceModal onClose={() => setShowCreate(false)} />}
      {logInstance && <LogViewer instanceId={logInstance} onClose={() => setLogInstance(null)} />}
    </div>
  );
}
