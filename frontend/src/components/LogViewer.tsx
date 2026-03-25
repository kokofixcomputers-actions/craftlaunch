import { useEffect, useRef } from 'react';
import { X, Trash2, Copy } from 'lucide-react';
import { useStore, type LogLine } from '../store';
import { api } from '../api/bridge';

interface Props { instanceId: string; onClose: () => void; }

const LEVEL_COLORS: Record<string, string> = {
  INFO: 'var(--text-2)', WARN: '#fbbf24', ERROR: '#f87171', DEBUG: 'var(--text-3)',
};

export default function LogViewer({ instanceId, onClose }: Props) {
  const { logs, clearLogs } = useStore();
  const lines: LogLine[] = logs[instanceId] || [];
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines.length]);

  const handleClear = async () => {
    clearLogs(instanceId);
    await api.clearLogs(instanceId).catch(() => {});
  };

  const handleCopy = async () => {
    try {
      const logText = await api.getLogsAsText(instanceId);
      await navigator.clipboard.writeText(logText);
      // Optionally show a brief success indicator
      const originalText = 'Copy';
      const button = document.querySelector('[data-copy-button]') as HTMLButtonElement;
      if (button) {
        button.innerHTML = '✓ Copied';
        setTimeout(() => {
          button.innerHTML = originalText;
        }, 2000);
      }
    } catch (error) {
      console.error('Failed to copy logs:', error);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
      <div className="glass-card w-full max-w-4xl animate-fadeUp" style={{ height: '55vh', borderRadius: '1rem', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--border)', flexShrink: 0 }}>
          <div className="flex-1">
            <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Game Log</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginLeft: 8 }}>{lines.length} lines</span>
          </div>
          <button onClick={handleCopy} data-copy-button className="btn btn-ghost btn-sm">
            <Copy size={12} /> Copy
          </button>
          <button onClick={handleClear} className="btn btn-ghost btn-sm">
            <Trash2 size={12} /> Clear
          </button>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center transition-all hover:scale-110" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
            <X size={12} style={{ color: 'var(--text-3)' }} />
          </button>
        </div>
        {/* Log lines */}
        <div className="flex-1 overflow-y-auto p-3" style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.72rem', lineHeight: 1.7 }}>
          {lines.length === 0 ? (
            <div style={{ color: 'var(--text-3)', padding: '2rem', textAlign: 'center' }}>No log output yet…</div>
          ) : (
            lines.map((line, i) => (
              <div key={i} className="flex gap-3" style={{ color: LEVEL_COLORS[line.level] }}>
                <span style={{ color: 'var(--text-3)', flexShrink: 0, userSelect: 'none' }}>
                  {line.timestamp.slice(11, 19)}
                </span>
                <span style={{ color: LEVEL_COLORS[line.level], flexShrink: 0, minWidth: 40 }}>[{line.level}]</span>
                <span style={{ wordBreak: 'break-all' }}>{line.message}</span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
