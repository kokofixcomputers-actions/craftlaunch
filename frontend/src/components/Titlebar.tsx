import { useStore } from '../store';
import { api } from '../api/bridge';
import { Home, Layers, Puzzle, Settings } from 'lucide-react';

export default function Titlebar() {
  const { windowFocused, page, navigate } = useStore();

  const quickNav = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'instances', label: 'Instances', icon: Layers },
    { id: 'mods', label: 'Mods', icon: Puzzle },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    // The ENTIRE bar is a drag region — buttons are no-drag inside it.
    // On macOS, -webkit-app-region:drag makes pywebview honour window dragging.
    <div
      className="drag-region pywebview-drag-region"
      style={{
        height: 44,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 14px',
        background: 'var(--titlebar-bg)',
        borderBottom: '1px solid var(--titlebar-border)',
        position: 'relative',
        zIndex: 9999,
        transition: 'background 0.25s ease',
      }}
    >
      {/* Traffic lights — must be no-drag so clicks register */}
      <div className="no-drag" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <TrafficLight
          focused={windowFocused}
          activeColor="#ff5f57"
          activeGlow="rgba(255,95,87,0.4)"
          symbol="✕"
          title="Close"
          onClick={() => api.quit()}
        />
        <TrafficLight
          focused={windowFocused}
          activeColor="#febc2e"
          activeGlow="rgba(254,188,46,0.4)"
          symbol="–"
          title="Minimize"
          onClick={() => api.minimize()}
        />
        <TrafficLight
          focused={windowFocused}
          activeColor="#28c840"
          activeGlow="rgba(40,200,64,0.4)"
          symbol="⤢"
          title="Zoom"
          onClick={() => api.maximize()}
        />
      </div>

      {/* Centered app label — pointer-events:none so it doesn't block drag */}
      <div style={{
        position: 'absolute', left: 0, right: 0, textAlign: 'center',
        fontSize: '0.72rem', fontWeight: 500,
        color: windowFocused ? 'var(--text-3)' : 'rgba(128,128,128,0.35)',
        letterSpacing: '0.04em', userSelect: 'none', pointerEvents: 'none',
        transition: 'color 0.3s ease',
      }}>
        NebulusLaunch
      </div>

      {/* Quick navigation buttons — must be no-drag so clicks register */}
      <div className="no-drag" style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
        {quickNav.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => navigate(id as any)}
            title={label}
            style={{
              width: 28,
              height: 28,
              borderRadius: '6px',
              border: 'none',
              background: page === id ? 'var(--surface-strong)' : 'transparent',
              color: page === id ? 'var(--text)' : 'var(--text-3)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
              padding: 0,
            }}
            onMouseEnter={(e) => {
              if (page !== id) {
                e.currentTarget.style.background = 'var(--surface)';
                e.currentTarget.style.color = 'var(--text-2)';
              }
            }}
            onMouseLeave={(e) => {
              if (page !== id) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-3)';
              }
            }}
          >
            <Icon size={14} strokeWidth={1.5} />
          </button>
        ))}
      </div>
    </div>
  );
}

interface Props {
  focused: boolean;
  activeColor: string;
  activeGlow: string;
  symbol: string;
  title: string;
  onClick: () => void;
}

function TrafficLight({ focused, activeColor, activeGlow, symbol, title, onClick }: Props) {
  const unfocusedColor = 'rgba(128,128,128,0.25)';

  const handleEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    el.style.background = focused ? activeColor : 'rgba(128,128,128,0.4)';
    if (focused) el.style.boxShadow = `0 0 6px ${activeGlow}`;
    const sym = el.querySelector('.tl-sym') as HTMLElement;
    if (sym) sym.style.opacity = '1';
  };
  const handleLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    el.style.background = focused ? activeColor : unfocusedColor;
    el.style.boxShadow = 'none';
    const sym = el.querySelector('.tl-sym') as HTMLElement;
    if (sym) sym.style.opacity = '0';
  };
  const handleDown = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.transform = 'scale(0.85)';
  };
  const handleUp = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.transform = 'scale(1)';
  };

  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onMouseDown={handleDown}
      onMouseUp={handleUp}
      style={{
        width: 12, height: 12, borderRadius: '50%', border: 'none',
        background: focused ? activeColor : unfocusedColor,
        boxShadow: 'none',
        cursor: 'pointer', flexShrink: 0, padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.15s ease, transform 0.1s ease',
        // Inside a drag region, buttons need no-drag but this is handled
        // by the parent .no-drag container
      }}
    >
      <span className="tl-sym" style={{
        opacity: 0, fontSize: 7, fontWeight: 900, lineHeight: 1,
        color: 'rgba(0,0,0,0.6)', userSelect: 'none', pointerEvents: 'none',
        fontFamily: 'system-ui', transition: 'opacity 0.1s',
      }}>
        {symbol}
      </span>
    </button>
  );
}
