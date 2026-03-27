import { useState } from 'react';
import { Plus, Search, Play, Settings, Trash2, Square, ExternalLink } from 'lucide-react';
import { useStore } from '../store';
import { api } from '../api/bridge';
import CreateInstanceModal from '../components/CreateInstanceModal';
import LogViewer from '../components/LogViewer';

const LOADER_COLORS: Record<string, string> = {
  fabric: 'var(--text-2)', forge: 'var(--text-2)', neoforge: 'var(--text-2)', quilt: 'var(--text-2)', vanilla: 'var(--green-text)',
};

export default function InstancesPage() {
  const { instances, navigate, users, activeUserId, setShowOnboarding, setInstanceRunning, removeInstance } = useStore();
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState('');
  const [launching, setLaunching] = useState<string | null>(null);
  const [logInstance, setLogInstance] = useState<string | null>(null);
  const [launchErrors, setLaunchErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const activeUser = users.find(u => u.id === activeUserId);
  const filtered = instances.filter(i =>
    i.name.toLowerCase().includes(query.toLowerCase()) ||
    i.minecraftVersion.includes(query) ||
    i.modLoader.includes(query)
  );

  const launch = async (inst: typeof instances[0]) => {
    if (!activeUser) { setShowOnboarding(true); return; }
    setLaunching(inst.id);
    setLaunchErrors(p => ({ ...p, [inst.id]: '' }));
    try {
      const result = await api.launchInstance(inst.id, activeUser.id);
      if (result.success) {
        setInstanceRunning(inst.id, true, result.pid);
        api.openLogWindow(inst.id, inst.name).catch(() => setLogInstance(inst.id));
      } else {
        setLaunchErrors(p => ({ ...p, [inst.id]: result.error || 'Failed to launch' }));
      }
    } catch (e: any) {
      setLaunchErrors(p => ({ ...p, [inst.id]: e.message }));
    } finally { setLaunching(null); }
  };

  const killInstance = async (inst: typeof instances[0]) => {
    await api.killInstance(inst.id).catch(() => {});
    setInstanceRunning(inst.id, false);
  };

  const deleteInstance = async (id: string) => {
    await api.deleteInstance(id).catch(() => {});
    removeInstance(id);
    setConfirmDelete(null);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--border)', flexShrink: 0 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
          Instances ({instances.length})
        </div>
        <div className="flex-1 relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
          <input className="input" style={{ paddingLeft: 32, height: 34 }} placeholder="Filter instances…"
            value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <button onClick={() => !activeUser ? setShowOnboarding(true) : setShowCreate(true)} className="btn btn-primary btn-sm">
          <Plus size={13} /> New Instance
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-5">
        {filtered.length === 0 ? (
          <div className="glass-card p-10 text-center">
            <div style={{ color: 'var(--text-3)', fontSize: '0.88rem', marginBottom: 12 }}>
              {query ? 'No instances match your search' : 'No instances yet'}
            </div>
            {!query && (
              <button onClick={() => !activeUser ? setShowOnboarding(true) : setShowCreate(true)} className="btn btn-primary">
                <Plus size={14} /> Create First Instance
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((inst, idx) => {
              const loaderColor = LOADER_COLORS[inst.modLoader] || '#888';
              return (
                <div key={inst.id} className="glass-card p-4 flex items-center gap-4 group animate-fadeUp cursor-pointer"
                  style={{ animationDelay: `${idx * 40}ms` }}
                  onClick={() => navigate('instance-detail', inst.id)}>
                  {/* Icon */}
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${loaderColor}18`, border: `1px solid ${loaderColor}30` }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: loaderColor, fontFamily: 'DM Mono' }}>
                      {inst.minecraftVersion.split('.').slice(0, 2).join('.')}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span style={{ fontWeight: 500, fontSize: '0.92rem' }} className="truncate">{inst.name}</span>
                      {inst.isRunning && (
                        <span className="badge badge-success animate-pulse" style={{ fontSize: '0.6rem' }}>Running</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>{inst.minecraftVersion}</span>
                      <span style={{ fontSize: '0.72rem', color: loaderColor, fontWeight: 500 }}>
                        {inst.modLoader}{inst.modLoaderVersion ? ` ${inst.modLoaderVersion}` : ''}
                      </span>
                      {inst.mods.length > 0 && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>{inst.mods.length} mods</span>
                      )}
                      {inst.lastPlayed && (
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-3)' }}>
                          Last played {new Date(inst.lastPlayed).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {launchErrors[inst.id] && (
                      <div style={{ fontSize: '0.72rem', color: '#f87171', marginTop: 3 }}>{launchErrors[inst.id]}</div>
                    )}
                  </div>

                  {/* RAM badge */}
                  <span className="badge badge-default" style={{ fontSize: '0.65rem', flexShrink: 0 }}>
                    {(inst.ram / 1024).toFixed(1)}G
                  </span>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    {inst.isRunning ? (
                      <>
                        <button onClick={() => setLogInstance(inst.id)} className="btn btn-ghost btn-sm">Logs</button>
                        <button onClick={() => killInstance(inst)} className="btn btn-danger btn-sm">
                          <Square size={11} fill="currentColor" /> Kill
                        </button>
                      </>
                    ) : (
                      <button onClick={() => launch(inst)} disabled={!!launching} className="btn btn-success btn-sm">
                        <Play size={11} fill="currentColor" />
                        {launching === inst.id ? '…' : 'Play'}
                      </button>
                    )}
                    <button onClick={() => navigate('instance-detail', inst.id)} className="btn btn-ghost btn-sm" style={{ padding: '0.4rem' }}>
                      <Settings size={13} />
                    </button>
                    <button onClick={() => setConfirmDelete(inst.id)} className="btn btn-ghost btn-sm" style={{ padding: '0.4rem', color: '#f87171' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="glass-card p-6 w-80 animate-fadeUp" style={{ borderRadius: '1.25rem' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Delete Instance?</div>
            <div style={{ fontSize: '0.84rem', color: 'var(--text-2)', marginBottom: 20 }}>
              This will permanently delete the instance and all its data including saves and mods. Libraries are shared and won't be removed.
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} className="btn btn-ghost flex-1 justify-center">Cancel</button>
              <button onClick={() => deleteInstance(confirmDelete)} className="btn btn-danger flex-1 justify-center">
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && <CreateInstanceModal onClose={() => setShowCreate(false)} />}
      {logInstance && <LogViewer instanceId={logInstance} onClose={() => setLogInstance(null)} />}
    </div>
  );
}
