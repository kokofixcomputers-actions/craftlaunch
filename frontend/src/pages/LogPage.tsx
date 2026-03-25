import { useEffect, useState, useRef } from 'react';
import { api } from '../api/bridge';
import { X, Terminal, Copy, Trash2, ArrowDown } from 'lucide-react';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export default function LogPage() {
  // For hash-based routing, we need to parse the instance ID from the URL
  const getInstanceId = () => {
    const hash = window.location.hash;
    const match = hash.match(/#log\/(.+)/);
    return match ? match[1] : '';
  };

  const instanceId = getInstanceId();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [instanceName, setInstanceName] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const prevLogsLength = useRef(0);

  useEffect(() => {
    if (!instanceId) return;

    // Get instance name for the window title
    const getInstanceName = async () => {
      try {
        const instances = await api.getInstances();
        const instance = instances.find((i: any) => i.id === instanceId);
        if (instance) {
          setInstanceName(instance.name);
          // Update window title
          document.title = `Logs – ${instance.name}`;
        }
      } catch (e) {
        console.error('Failed to get instance name:', e);
      }
    };

    // Load initial logs
    const loadLogs = async () => {
      try {
        const result = await api.getLogs(instanceId);
        setLogs(result || []);
      } catch (e) {
        console.error('Failed to load logs:', e);
      }
    };

    // Set up log polling for real-time updates
    const pollLogs = setInterval(async () => {
      try {
        const result = await api.getLogs(instanceId);
        const newLogs = result || [];
        setLogs(newLogs);
        
        // Auto-scroll if new logs were added and auto-scroll is enabled
        if (autoScroll && newLogs.length > prevLogsLength.current) {
          setTimeout(() => {
            if (logContainerRef.current) {
              logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
            }
          }, 100); // Small delay to ensure DOM has updated
        }
        prevLogsLength.current = newLogs.length;
      } catch (e) {
        console.error('Failed to poll logs:', e);
      }
    }, 1000); // Poll every second

    getInstanceName();
    loadLogs();

    return () => {
      clearInterval(pollLogs);
    };
  }, [instanceId]);

  const getLevelColor = (level: string) => {
    switch (level.toUpperCase()) {
      case 'ERROR': return '#ef4444';
      case 'WARN': return '#f59e0b';
      case 'INFO': return '#3b82f6';
      case 'DEBUG': return '#8b5cf6';
      default: return '#94a3b8';
    }
  };

  const copyLogs = () => {
    const logText = logs.map(log => `[${log.timestamp}] ${log.level}: ${log.message}`).join('\n');
    navigator.clipboard.writeText(logText).then(() => {
      // Could add a toast notification here
      console.log('Logs copied to clipboard');
    });
  };

  const clearLogs = () => {
    setLogs([]);
    prevLogsLength.current = 0;
  };

  const scrollToBottom = () => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  };

  const toggleAutoScroll = () => {
    setAutoScroll(!autoScroll);
    if (!autoScroll) {
      scrollToBottom();
    }
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString();
    } catch {
      return timestamp;
    }
  };

  if (!instanceId) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100vh',
        background: 'var(--bg)',
        color: 'var(--text-2)',
        flexDirection: 'column',
        gap: 16
      }}>
        <Terminal size={48} />
        <div>No instance specified</div>
      </div>
    );
  }

  return (
    <div style={{ 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'column',
      background: 'var(--bg)',
      color: 'var(--text-1)'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Terminal size={18} style={{ color: 'var(--text-2)' }} />
          <span style={{ fontSize: '0.92rem', fontWeight: 500 }}>
            {instanceName || `Instance ${instanceId.slice(0, 8)}`}
          </span>
          <span style={{ 
            fontSize: '0.76rem', 
            color: 'var(--text-3)',
            background: 'var(--surface-strong)',
            padding: '2px 8px',
            borderRadius: 4
          }}>
            {logs.length} entries
          </span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={toggleAutoScroll}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              background: autoScroll ? 'var(--primary)' : 'var(--surface-strong)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: autoScroll ? 'white' : 'var(--text-2)',
              fontSize: '0.76rem',
              cursor: 'pointer'
            }}
            title={autoScroll ? 'Auto-scroll enabled' : 'Auto-scroll disabled'}
          >
            <ArrowDown size={14} />
            {autoScroll ? 'Auto' : 'Manual'}
          </button>
          
          <button
            onClick={scrollToBottom}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              background: 'var(--surface-strong)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-2)',
              fontSize: '0.76rem',
              cursor: 'pointer'
            }}
            title="Scroll to bottom"
          >
            <ArrowDown size={14} />
            Bottom
          </button>
          
          <button
            onClick={copyLogs}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              background: 'var(--surface-strong)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-2)',
              fontSize: '0.76rem',
              cursor: 'pointer'
            }}
            title="Copy logs to clipboard"
          >
            <Copy size={14} />
            Copy
          </button>
          
          <button
            onClick={clearLogs}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              background: 'var(--surface-strong)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-2)',
              fontSize: '0.76rem',
              cursor: 'pointer'
            }}
            title="Clear logs"
          >
            <Trash2 size={14} />
            Clear
          </button>
          
          <button
            onClick={() => window.close()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              background: 'var(--error)',
              border: 'none',
              borderRadius: 6,
              color: 'white',
              fontSize: '0.76rem',
              cursor: 'pointer'
            }}
            title="Close window"
          >
            <X size={14} />
            Close
          </button>
        </div>
      </div>

      {/* Log content */}
      <div 
        ref={logContainerRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px 16px',
          fontFamily: 'DM Mono, monospace',
          fontSize: '0.78rem',
          lineHeight: 1.6,
          background: 'var(--bg)'
        }}
      >
        {logs.length === 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-3)',
            flexDirection: 'column',
            gap: 12
          }}>
            <Terminal size={32} />
            <div>Waiting for logs...</div>
            <div style={{ fontSize: '0.76rem' }}>
              Launch the instance to see logs here
            </div>
          </div>
        ) : (
          logs.map((log, index) => (
            <div 
              key={index}
              style={{
                display: 'flex',
                gap: 12,
                marginBottom: 2,
                opacity: 0.9,
                transition: 'opacity 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '0.9'}
            >
              <span style={{ 
                color: 'var(--text-3)', 
                fontSize: '0.72rem',
                minWidth: 80,
                userSelect: 'none'
              }}>
                {formatTimestamp(log.timestamp)}
              </span>
              <span style={{ 
                color: getLevelColor(log.level),
                minWidth: 60,
                fontWeight: 500,
                userSelect: 'none'
              }}>
                {log.level}
              </span>
              <span style={{ 
                color: 'var(--text-2)',
                flex: 1,
                wordBreak: 'break-word'
              }}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
