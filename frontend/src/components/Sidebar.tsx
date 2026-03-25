import { Home, Layers, Puzzle, Settings, Plus, ChevronRight, UserIcon, Check, Package, Wifi, WifiOff } from 'lucide-react';
import { useStore, type Page } from '../store';

const NAV: { id: Page; label: string; icon: any }[] = [
  { id: 'home',      label: 'Home',        icon: Home },
  { id: 'instances', label: 'Instances',   icon: Layers },
  { id: 'mods',      label: 'Browse Mods', icon: Puzzle },
  { id: 'modpacks',  label: 'Modpacks',    icon: Package },
  { id: 'settings',  label: 'Settings',    icon: Settings },
];

const LOADER_COLORS: Record<string, string> = {
  fabric: '#b6844b', forge: '#346aa9', neoforge: '#e07c2e', quilt: '#9b59b6', vanilla: '#4ade80',
};

export default function Sidebar() {
  const { page, navigate, users, activeUserId, setActiveUser, setShowOnboarding, instances } = useStore();
  const activeUser = users.find(u => u.id === activeUserId);
  const runningCount = instances.filter(i => i.isRunning).length;

  return (
    <div
      className="flex flex-col w-52 border-r overflow-hidden"
      style={{
        borderColor: 'var(--border)',
        // Use CSS variable so it adapts to light/dark theme
        background: 'var(--sidebar-bg)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = page === id;
          return (
            <button
              key={id}
              onClick={() => navigate(id)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all"
              style={{
                background: active ? 'rgba(139,92,246,0.15)' : 'transparent',
                border: `1px solid ${active ? 'rgba(139,92,246,0.22)' : 'transparent'}`,
              }}
            >
              <Icon size={15} strokeWidth={active ? 2 : 1.75}
                style={{ color: active ? '#a78bfa' : 'var(--text-3)', flexShrink: 0 }} />
              <span style={{
                fontSize: '0.83rem',
                fontWeight: active ? 500 : 400,
                color: active ? 'var(--text)' : 'var(--text-2)',
                flex: 1,
              }}>
                {label}
              </span>
              {id === 'instances' && runningCount > 0 && (
                <span style={{
                  background: 'rgba(34,197,94,0.15)', color: '#4ade80',
                  border: '1px solid rgba(34,197,94,0.25)', borderRadius: 999,
                  fontSize: '0.6rem', padding: '1px 6px', fontWeight: 600,
                }}>
                  {runningCount}
                </span>
              )}
              {active && <ChevronRight size={11} style={{ color: '#a78bfa' }} />}
            </button>
          );
        })}

        <div style={{ height: 1, background: 'var(--border)', margin: '8px 4px' }} />

        <button
          onClick={() => navigate('instances')}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all"
          style={{ color: 'var(--text-3)' }}
        >
          <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.18)' }}>
            <Plus size={9} style={{ color: '#a78bfa' }} />
          </div>
          <span style={{ fontSize: '0.82rem' }}>New Instance</span>
        </button>

        {/* Running instances */}
        {instances.filter(i => i.isRunning).map(inst => (
          <button key={inst.id} onClick={() => navigate('instance-detail', inst.id)}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all"
            style={{ color: 'var(--text-2)' }}>
            <span className="animate-pulse w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: '#4ade80' }} />
            <span className="truncate" style={{ fontSize: '0.75rem' }}>{inst.name}</span>
            <span style={{
              fontSize: '0.65rem',
              color: LOADER_COLORS[inst.modLoader] || 'var(--text-3)',
              marginLeft: 'auto', flexShrink: 0,
            }}>
              {inst.minecraftVersion}
            </span>
          </button>
        ))}
      </nav>

      {/* User section */}
      <div className="p-2 border-t" style={{ borderColor: 'var(--border)' }}>
        {activeUser ? (
          <div className="space-y-0.5">
            {users.map(u => (
              <button key={u.id}
                onClick={() => u.id !== activeUserId && setActiveUser(u.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all"
                style={{
                  background: u.id === activeUserId ? 'rgba(139,92,246,0.1)' : 'transparent',
                }}
              >
                <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    background: u.accountType === 'online' 
                      ? 'linear-gradient(135deg,#8b5cf6,#6366f1)' 
                      : 'linear-gradient(135deg,#6b7280,#4b5563)',
                    fontSize: '0.65rem', fontWeight: 700, color: 'white',
                  }}>
                  {u.username[0]?.toUpperCase()}
                </div>
                <span className="truncate flex-1 text-left" style={{
                  fontSize: '0.75rem', color: 'var(--text-2)',
                  fontWeight: u.id === activeUserId ? 500 : 400,
                }}>
                  {u.username}
                </span>
                <div className="flex items-center gap-1">
                  {u.accountType === 'online' ? (
                    <Wifi size={10} style={{ color: '#4ade80', flexShrink: 0 }} />
                  ) : (
                    <WifiOff size={10} style={{ color: '#f59e0b', flexShrink: 0 }} />
                  )}
                  {u.id === activeUserId && <Check size={10} style={{ color: '#4ade80', flexShrink: 0 }} />}
                </div>
              </button>
            ))}
            <button onClick={() => setShowOnboarding(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all"
              style={{ color: 'var(--text-3)', fontSize: '0.75rem' }}>
              <Plus size={11} /> Add account
            </button>
          </div>
        ) : (
          <button onClick={() => setShowOnboarding(true)}
            className="btn btn-secondary w-full justify-center btn-sm">
            <UserIcon size={13} /> Sign In
          </button>
        )}
      </div>
    </div>
  );
}
