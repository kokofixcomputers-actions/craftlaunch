import { useState, useEffect, useRef } from 'react';
import { X, Loader, ChevronDown, Upload, FileText } from 'lucide-react';
import { useStore } from '../store';
import { api } from '../api/bridge';

interface Props { onClose: () => void; }

const LOADERS = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'] as const;
const LWJGL_OPTIONS = [
  { value: '',               label: 'Auto-detect (recommended)' },
  { value: 'lwjgl2-arm64',   label: 'LWJGL2 arm64 (pre-1.13, Apple Silicon)' },
  { value: 'lwjgl3-arm64',   label: 'LWJGL3 arm64 (1.13–1.19, Apple Silicon)' },
];
const VERSION_FILTERS = [
  { value: 'release',   label: 'Release' },
  { value: 'snapshot',  label: 'Snapshot' },
  { value: 'old_beta',  label: 'Beta' },
  { value: 'old_alpha', label: 'Alpha' },
  { value: 'all',       label: 'All' },
];

export default function CreateInstanceModal({ onClose }: Props) {
  const { addInstance, systemInfo } = useStore();
  const isArm64Mac = systemInfo?.os === 'darwin' && systemInfo?.arch === 'arm64';

  const [name, setName]               = useState('');
  const [versionFilter, setVersionFilter] = useState('release');
  const [filteredVersions, setFilteredVersions] = useState<any[]>([]);
  const [mcVersion, setMcVersion]     = useState('');
  const [loader, setLoader]           = useState<string>('vanilla');
  const [loaderVersions, setLoaderVersions] = useState<any[]>([]);
  const [loaderVersion, setLoaderVersion] = useState('');
  const [ram, setRam]                 = useState(2048);
  const [jvmArgs, setJvmArgs]         = useState('');
  const [lwjgl, setLwjgl]             = useState('');
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [loadingLoaders, setLoadingLoaders]   = useState(false);
  const [creating, setCreating]       = useState(false);
  const [error, setError]             = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeTab, setActiveTab]       = useState<'create' | 'import'>('create');
  const [isDragging, setIsDragging]     = useState(false);
  const [importing, setImporting]       = useState(false);
  const [importedFile, setImportedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Version dropdown (searchable) state & refs
  const versionMenuRef = useRef<HTMLDivElement>(null);
  const versionSearchInputRef = useRef<HTMLInputElement>(null);
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  const [versionSearch, setVersionSearch] = useState('');
  const [versionMenuType, setVersionMenuType] = useState<'all'|'release'|'snapshot'|'beta'|'alpha'>('all');
  const [highlightedVersionIndex, setHighlightedVersionIndex] = useState(0);
  const [menuVersions, setMenuVersions] = useState<any[] | null>(null);

  // fetch all versions once on mount so in-menu filters work immediately
  useEffect(() => {
    if (menuVersions === null) {
      api.getVersionsFiltered('all').then(vs => setMenuVersions(vs)).catch(() => setMenuVersions([]));
    }
  }, []);

  // also ensure when opening menu, menuVersions exists (fallback fetch)
  useEffect(() => {
    if (versionMenuOpen && menuVersions === null) {
      api.getVersionsFiltered('all').then(vs => setMenuVersions(vs)).catch(() => setMenuVersions([]));
    }
  }, [versionMenuOpen, menuVersions]);

  // derived visible versions for the dropdown (search + in-menu type filter)
  const sourceVersions = menuVersions ?? filteredVersions;
  const visibleVersions = sourceVersions.filter((v: any) => {
    const q = versionSearch.trim().toLowerCase();
    // type mapping
    if (versionMenuType !== 'all') {
      if (versionMenuType === 'beta' && v.type !== 'old_beta') return false;
      if (versionMenuType === 'alpha' && v.type !== 'old_alpha') return false;
      if (versionMenuType === 'release' && v.type !== 'release') return false;
      if (versionMenuType === 'snapshot' && v.type !== 'snapshot') return false;
    }
    if (!q) return true;
    return v.id.toLowerCase().includes(q) || (v.type || '').toLowerCase().includes(q);
  });

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (versionMenuRef.current && !versionMenuRef.current.contains(e.target as Node)) {
        setVersionMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    // reset highlight when search/type/versions change
    setHighlightedVersionIndex(0);
  }, [versionSearch, versionMenuType, sourceVersions]);

  // Fetch versions by filter
  useEffect(() => {
    setLoadingVersions(true);
    api.getVersionsFiltered(versionFilter).then(vs => {
      setFilteredVersions(vs);
      if (vs.length > 0 && (!mcVersion || !vs.find((v: any) => v.id === mcVersion))) {
        setMcVersion(vs[0].id);
      }
      setLoadingVersions(false);
    }).catch(() => setLoadingVersions(false));
  }, [versionFilter]);

  // Auto-name
  useEffect(() => {
    if (!name || /^\d+\.\d+/.test(name) || name.includes(' ')) {
      const loaderLabel = loader === 'vanilla' ? '' : ` ${loader.charAt(0).toUpperCase() + loader.slice(1)}`;
      setName(mcVersion + loaderLabel);
    }
  }, [mcVersion, loader]);

  // Fetch loader versions
  useEffect(() => {
    if (loader === 'vanilla' || !mcVersion) { setLoaderVersions([]); setLoaderVersion(''); return; }
    setLoadingLoaders(true);
    const fetchers: Record<string, () => Promise<any[]>> = {
      fabric:   () => api.getFabricVersions(mcVersion),
      forge:    () => api.getForgeVersions(mcVersion),
      neoforge: () => api.getNeoForgeVersions(mcVersion),
      quilt:    () => api.getQuiltVersions(mcVersion),
    };
    fetchers[loader]?.().then(vs => {
      setLoaderVersions(vs);
      setLoaderVersion(vs[0]?.id || '');
      setLoadingLoaders(false);
    }).catch(() => { setLoadingLoaders(false); setLoaderVersions([]); });
  }, [loader, mcVersion]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    const mrpackFile = files.find(file => file.name.endsWith('.mrpack'));
    
    if (mrpackFile) {
      setImportedFile(mrpackFile);
      setError('');
    } else {
      setError('Please drop a valid .mrpack file');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.name.endsWith('.mrpack')) {
        setImportedFile(file);
        setError('');
      } else {
        setError('Please select a valid .mrpack file');
      }
    }
  };

  const importModpack = async () => {
    if (!importedFile) {
      setError('Please select a modpack file');
      return;
    }
    
    setImporting(true);
    setError('');
    
    try {
      // Convert file to base64 for backend
      const fileReader = new FileReader();
      fileReader.onload = async (event) => {
        const base64Content = (event.target as any).result.split(',')[1]; // Remove data URL prefix
        
        const fileInfo = {
          name: importedFile.name,
          content: base64Content
        };
        
        const instance = await api.importModpack(fileInfo);
        addInstance(instance);
        onClose();
      };
      
      fileReader.onerror = () => {
        setError('Failed to read file');
        setImporting(false);
      };
      
      fileReader.readAsDataURL(importedFile);
    } catch (e: any) {
      setError(e.message || 'Failed to import modpack');
      setImporting(false);
    }
  };

  const create = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!mcVersion)    { setError('Select a Minecraft version'); return; }
    setCreating(true); setError('');
    try {
      const instance = await api.createInstance({
        name: name.trim(), minecraftVersion: mcVersion, modLoader: loader,
        modLoaderVersion: loaderVersion || undefined,
        ram, jvmArgs, lwjglOverride: lwjgl || undefined, description: '',
      });
      addInstance(instance);
      onClose();
    } catch (e: any) {
      setError(e.message || 'Failed to create instance');
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
      <div className="glass-card w-full max-w-lg mx-4 animate-fadeUp" style={{ padding: '1.75rem', borderRadius: '1.25rem', maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="flex items-center justify-between mb-5">
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>
            {activeTab === 'create' ? 'Create Instance' : 'Import Modpack'}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
            <X size={13} style={{ color: 'var(--text-3)' }} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-5" style={{ background: 'var(--surface)', padding: '4px', borderRadius: '8px' }}>
          <button
            onClick={() => setActiveTab('create')}
            style={{
              flex: 1,
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: 500,
              background: activeTab === 'create' ? 'var(--surface-strong)' : 'transparent',
              color: activeTab === 'create' ? 'var(--text)' : 'var(--text-3)',
              cursor: 'pointer',
              transition: 'all 0.15s',
              border: 'none',
            }}
          >
            Create New
          </button>
          <button
            onClick={() => setActiveTab('import')}
            style={{
              flex: 1,
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: 500,
              background: activeTab === 'import' ? 'var(--surface-strong)' : 'transparent',
              color: activeTab === 'import' ? 'var(--text)' : 'var(--text-3)',
              cursor: 'pointer',
              transition: 'all 0.15s',
              border: 'none',
            }}
          >
            Import Modpack
          </button>
        </div>

        <div className="space-y-4">
          {activeTab === 'create' ? (
            <>
              {/* Name */}
              <div>
                <label className="block mb-1.5" style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>Instance Name</label>
                <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="My Instance" />
              </div>

              {/* Version filter tabs */}
              <div>
                <label className="block mb-1.5" style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>Minecraft Version</label>
                <div className="flex gap-1 mb-2 flex-wrap">
                  {VERSION_FILTERS.map(f => (
                    <button key={f.value} onClick={() => setVersionFilter(f.value)}
                      style={{
                        padding: '0.25rem 0.75rem', borderRadius: 999, fontSize: '0.72rem', fontWeight: 500,
                        background: versionFilter === f.value ? 'var(--surface-strong)' : 'var(--surface)',
                        border: `1px solid ${versionFilter === f.value ? 'var(--border-strong)' : 'var(--border)'}`,
                        color: versionFilter === f.value ? 'var(--text)' : 'var(--text-3)', cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}>
                      {f.label}
                    </button>
                  ))}
                </div>
                {loadingVersions ? (
                  <div className="flex items-center gap-2" style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>
                    <Loader size={12} className="animate-spin" /> Fetching versions…
                  </div>
                ) : (
                  <div style={{ position: 'relative' }} ref={versionMenuRef}>
                    <button
                      type="button"
                      className="input"
                      onClick={() => { setVersionMenuOpen(v => !v); setTimeout(() => versionSearchInputRef.current?.focus(), 10); setVersionSearch(''); setVersionMenuType('all'); }}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown') { e.preventDefault(); setVersionMenuOpen(true); setHighlightedVersionIndex(0); setTimeout(() => versionSearchInputRef.current?.focus(), 10); }
                      }}
                    >
                      <span>{mcVersion || 'Select version...'}</span>
                      <ChevronDown size={14} />
                    </button>

                    {versionMenuOpen && (
                      <div style={{ position: 'absolute', zIndex: 60, left: 0, right: 0, marginTop: 6 }}>
                        <div className="version-menu-dropdown">
                          <div className="menu-inner">
                            {/* in-menu filters */}
                            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                              {[
                                { key: 'all', label: 'All' },
                                { key: 'release', label: 'Release' },
                                { key: 'snapshot', label: 'Snapshot' },
                                { key: 'beta', label: 'Beta' },
                                { key: 'alpha', label: 'Alpha' },
                              ].map(f => (
                                <button
                                  key={f.key}
                                  onClick={() => { setVersionMenuType(f.key as any); setHighlightedVersionIndex(0); }}
                                  className={`version-filter-pill ${versionMenuType === f.key ? 'active' : ''}`}
                                  style={{ cursor: 'pointer' }}
                                >{f.label}</button>
                              ))}
                            </div>

                            <input
                              ref={versionSearchInputRef}
                              placeholder="Search versions..."
                              value={versionSearch}
                              onChange={e => { setVersionSearch(e.target.value); setHighlightedVersionIndex(0); }}
                              className="input"
                              style={{ width: '100%', marginBottom: 8 }}
                              onKeyDown={(e) => {
                                if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightedVersionIndex(i => Math.min(i + 1, visibleVersions.length - 1)); }
                                if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightedVersionIndex(i => Math.max(i - 1, 0)); }
                                if (e.key === 'Enter') { e.preventDefault(); const v = visibleVersions[highlightedVersionIndex]; if (v) { setMcVersion(v.id); setVersionMenuOpen(false); setVersionSearch(''); } }
                                if (e.key === 'Escape') { setVersionMenuOpen(false); }
                              }}
                            />
                            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                              {visibleVersions.map((v: any, idx: number) => (
                                <div
                                  key={v.id}
                                  onMouseEnter={() => setHighlightedVersionIndex(idx)}
                                  onMouseDown={(e) => { e.preventDefault(); setMcVersion(v.id); setVersionMenuOpen(false); setVersionSearch(''); }}
                                  className={`version-item ${idx === highlightedVersionIndex ? 'highlight' : ''}`}
                                >
                                  <div>{v.id}</div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>{v.type !== 'release' ? v.type.replace('old_', '') : ''}</div>
                                </div>
                              ))}
                              {visibleVersions.length === 0 && (
                                <div style={{ padding: '10px', color: 'var(--text-3)' }}>No results</div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Mod Loader */}
              <div>
                <label className="block mb-1.5" style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>Mod Loader</label>
                <div className="flex gap-1.5 flex-wrap">
                  {LOADERS.map(l => (
                    <button key={l} onClick={() => setLoader(l)}
                      style={{
                        padding: '0.4rem 0.9rem', borderRadius: 999, fontSize: '0.78rem', fontWeight: 500,
                        background: loader === l ? 'var(--surface-strong)' : 'var(--surface)',
                        border: `1px solid ${loader === l ? 'var(--border-strong)' : 'var(--border)'}`,
                        color: loader === l ? 'var(--text)' : 'var(--text-2)', cursor: 'pointer', transition: 'all 0.15s',
                      }}>
                      {l.charAt(0).toUpperCase() + l.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Loader version */}
              {loader !== 'vanilla' && (
                <div>
                  <label className="block mb-1.5" style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>
                    {loader.charAt(0).toUpperCase() + loader.slice(1)} Version
                  </label>
                  {loadingLoaders ? (
                    <div className="flex items-center gap-2" style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>
                      <Loader size={13} className="animate-spin" /> Fetching versions…
                    </div>
                  ) : loaderVersions.length === 0 ? (
                    <div style={{ color: '#f87171', fontSize: '0.8rem' }}>No {loader} versions for {mcVersion}</div>
                  ) : (
                    <select className="input" value={loaderVersion} onChange={e => setLoaderVersion(e.target.value)}>
                      {loaderVersions.map((v: any) => (
                        <option key={v.id} value={v.id}>{v.id}{!v.stable ? ' (beta)' : ''}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* RAM */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>Memory (RAM)</label>
                  <span style={{ fontSize: '0.78rem', color: 'var(--code-color)', fontFamily: 'DM Mono', fontWeight: 500 }}>
                    {(ram / 1024).toFixed(1)} GB
                  </span>
                </div>
                <input type="range" min={512} max={16384} step={512} value={ram}
                  onChange={e => setRam(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--code-color)' }} />
                <div className="flex justify-between" style={{ fontSize: '0.65rem', color: 'var(--text-3)', marginTop: 2 }}>
                  <span>512 MB</span><span>16 GB</span>
                </div>
              </div>

              {/* Advanced */}
              <button onClick={() => setShowAdvanced(v => !v)} className="flex items-center gap-1.5 w-full" style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>
                <ChevronDown size={13} style={{ transform: showAdvanced ? 'rotate(180deg)' : '', transition: '0.2s' }} />
                Advanced options
              </button>
              {showAdvanced && (
                <div className="space-y-3 animate-fadeIn">
                  <div>
                    <label className="block mb-1.5" style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>Extra JVM Arguments</label>
                    <input className="input" value={jvmArgs} onChange={e => setJvmArgs(e.target.value)} placeholder="-XX:+UseShenandoahGC …" />
                  </div>
                  {isArm64Mac && (
                    <div>
                      <label className="block mb-1.5" style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>
                        LWJGL Override <span style={{ fontSize: '0.65rem', color: '#fbbf24', marginLeft: 6 }}>Apple Silicon</span>
                      </label>
                      <select className="input" value={lwjgl} onChange={e => setLwjgl(e.target.value)}>
                        {LWJGL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginTop: 4 }}>
                        Pre-1.13 on Apple Silicon needs lwjgl2-arm64. Auto-detect handles this automatically.
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={onClose} className="btn btn-ghost flex-1 justify-center">Cancel</button>
                <button onClick={create} disabled={creating} className="btn btn-primary flex-1 justify-center">
                  {creating && <Loader size={13} className="animate-spin" />}
                  {creating ? 'Creating…' : 'Create Instance'}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Import Modpack Content */}
              <div>
                <label className="block mb-1.5" style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>
                  Modpack File (.mrpack)
                </label>
                
                {/* Drag and Drop Area */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${isDragging ? 'var(--border-strong)' : 'var(--border)'}`,
                    borderRadius: '12px',
                    padding: '2rem',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: isDragging ? 'var(--surface-strong)' : 'var(--surface)',
                    transition: 'all 0.2s',
                    minHeight: '120px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.75rem',
                  }}
                >
                  {importedFile ? (
                    <>
                      <FileText size={32} style={{ color: 'var(--code-color)' }} />
                      <div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-1)' }}>
                          {importedFile.name}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                          {(importedFile.size / 1024 / 1024).toFixed(2)} MB
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <Upload size={32} style={{ color: 'var(--text-3)' }} />
                      <div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-2)' }}>
                          {isDragging ? 'Drop your .mrpack file here' : 'Drag & drop your .mrpack file here'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                          or click to browse
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mrpack"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />

                {/* File info */}
                {importedFile && (
                  <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--surface)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-2)' }}>
                      <strong>Selected file:</strong> {importedFile.name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: '0.25rem' }}>
                      This modpack will be imported and configured automatically.
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={onClose} className="btn btn-ghost flex-1 justify-center">Cancel</button>
                <button 
                  onClick={importModpack} 
                  disabled={!importedFile || importing} 
                  className="btn btn-primary flex-1 justify-center"
                >
                  {importing && <Loader size={13} className="animate-spin" />}
                  {importing ? 'Importing…' : 'Import Modpack'}
                </button>
              </div>
            </>
          )}

          {error && (
            <div style={{ color: '#f87171', fontSize: '0.82rem', padding: '0.75rem', background: 'rgba(248, 113, 113, 0.1)', borderRadius: '8px', border: '1px solid rgba(248, 113, 113, 0.2)' }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
