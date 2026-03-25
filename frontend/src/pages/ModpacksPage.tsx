import { useState, useEffect, useCallback } from 'react';
import { Search, Download, ChevronDown, Loader, CheckCircle, Package, Star, Users, ArrowRight } from 'lucide-react';
import { useStore } from '../store';
import { api } from '../api/bridge';

export default function ModpacksPage() {
  const { instances, addInstance } = useStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [totalHits, setTotalHits] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searching, setSearching] = useState(false);
  const [expandedModpack, setExpandedModpack] = useState<string | null>(null);
  const [loadingVersions, setLoadingVersions] = useState<string | null>(null);
  const [modpackVersions, setModpackVersions] = useState<Record<string, any[]>>({});
  const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState<string | null>(null);

  const search = useCallback(async (newOffset = 0) => {
    setSearching(true);
    try {
      const result = await api.searchModpacks(query, newOffset);
      if (newOffset === 0) setResults(result.hits);
      else setResults(prev => [...prev, ...result.hits]);
      setTotalHits(result.total_hits);
      setOffset(newOffset);
    } catch {}
    setSearching(false);
  }, [query]);

  useEffect(() => {
    search(0);
  }, [search]);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); search(0); };

  const loadVersions = async (projectId: string) => {
    if (modpackVersions[projectId]) return;
    setLoadingVersions(projectId);
    try {
      const vs = await api.getModpackVersions(projectId);
      setModpackVersions(prev => ({ ...prev, [projectId]: vs }));
      if (vs && vs.length > 0) {
        setSelectedVersions(prev => ({ ...prev, [projectId]: vs[0].id }));
      }
    } catch (e) {
      console.error('Failed to load versions:', e);
    } finally {
      setLoadingVersions(null);
    }
  };

  const toggleExpand = (projectId: string) => {
    if (expandedModpack === projectId) { setExpandedModpack(null); return; }
    setExpandedModpack(projectId);
    loadVersions(projectId);
  };

  const installModpack = async (modpack: any) => {
    const versionId = selectedVersions[modpack.project_id];
    if (!versionId) return;

    setInstalling(modpack.project_id);
    try {
      // Get the version details to download the .mrpack file
      const version = await api.getModpackVersionDetails(versionId);
      const file = version.files.find((f: any) => f.primary) || version.files[0];
      if (!file) throw new Error('No download file found');

      // Download the .mrpack file
      const response = await fetch(file.url);
      const blob = await response.blob();
      
      // Convert to base64 for backend
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        
        const fileInfo = {
          name: file.filename,
          content: base64
        };

        // Import the modpack
        const instance = await api.importModpack(fileInfo);
        addInstance(instance);
        setInstalled(modpack.project_id);
        setTimeout(() => setInstalled(null), 3000);
      };
      reader.readAsDataURL(blob);
    } catch (e: any) {
      console.error('Failed to install modpack:', e);
    } finally {
      setInstalling(null);
    }
  };

  const formatDownloads = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="px-5 py-4 border-b space-y-3" style={{ borderColor: 'var(--border)', flexShrink: 0 }}>
        <div className="flex items-center gap-3">
          <div style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', flexShrink: 0 }}>
            Modrinth Modpacks
          </div>
          <Package size={16} style={{ color: '#8b5cf6' }} />
        </div>
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingLeft: 32 }} placeholder="Search modpacks…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <button type="submit" disabled={searching} className="btn btn-primary btn-sm">
            {searching ? <Loader size={13} className="animate-spin" /> : <Search size={13} />} Search
          </button>
        </form>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-5">
        {results.length === 0 && !searching && (
          <div className="glass-card p-10 text-center">
            <div style={{ color: 'var(--text-3)', fontSize: '0.88rem' }}>
              {query ? 'No modpacks found. Try a different search.' : 'Search Modrinth for modpacks'}
            </div>
          </div>
        )}

        {searching && results.length === 0 && (
          <div className="flex items-center justify-center py-16 gap-3" style={{ color: 'var(--text-3)' }}>
            <Loader size={16} className="animate-spin" /> Searching Modrinth…
          </div>
        )}

        <div className="space-y-2">
          {results.map((modpack, i) => {
            const expanded = expandedModpack === modpack.project_id;
            const isInstalling = installing === modpack.project_id;
            const isInstalled = installed === modpack.project_id;

            return (
              <div key={modpack.project_id} className="glass-card overflow-hidden animate-fadeUp" style={{ animationDelay: `${i * 30}ms` }}>
                <div className="p-4 flex items-center gap-3 cursor-pointer" onClick={() => toggleExpand(modpack.project_id)}>
                  {/* Icon */}
                  <div className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
                    {modpack.icon_url
                      ? <img src={modpack.icon_url} alt="" className="w-10 h-10 rounded-lg object-cover" />
                      : <Package size={16} style={{ color: 'var(--text-3)' }} />}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{modpack.title}</span>
                      {isInstalled && <span className="badge badge-success" style={{ fontSize: '0.6rem' }}>Installed</span>}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', lineHeight: 1.4 }} className="truncate">{modpack.description}</div>
                    <div className="flex items-center gap-3 mt-1">
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}>↓ {formatDownloads(modpack.downloads)}</span>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}><Star size={10} /> {modpack.follows}</span>
                      {modpack.categories.slice(0, 2).map((c: string) => (
                        <span key={c} className="badge badge-default" style={{ fontSize: '0.58rem' }}>{c}</span>
                      ))}
                    </div>
                  </div>

                  <ChevronDown size={14} style={{ color: 'var(--text-3)', flexShrink: 0, transform: expanded ? 'rotate(180deg)' : '', transition: '0.2s' }} />
                </div>

                {/* Expanded: version picker */}
                {expanded && (
                  <div className="border-t px-4 pb-4 pt-3 animate-fadeIn" style={{ borderColor: 'var(--border)' }}>
                    {loadingVersions === modpack.project_id ? (
                      <div className="flex items-center gap-2" style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>
                        <Loader size={12} className="animate-spin" /> Loading versions…
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 flex-wrap">
                          <select className="input" style={{ maxWidth: 280, height: 34 }}
                            value={selectedVersions[modpack.project_id] || ''}
                            onChange={e => setSelectedVersions(prev => ({ ...prev, [modpack.project_id]: e.target.value }))}>
                            {modpackVersions[modpack.project_id]?.map((version: any) => (
                              <option key={version.id} value={version.id}>
                                {version.name} ({version.version_number}) — {formatDownloads(version.downloads || 0)} downloads
                              </option>
                            )) || <option value="">No versions available</option>}
                          </select>
                          {isInstalled ? (
                            <div className="flex items-center gap-1.5 badge badge-success">
                              <CheckCircle size={11} /> Installed Successfully
                            </div>
                          ) : (
                            <button onClick={() => installModpack(modpack)} disabled={!!isInstalling || !!installed || !selectedVersions[modpack.project_id]}
                              className={`btn btn-sm ${isInstalled ? 'btn-success' : 'btn-primary'}`}>
                              {isInstalling ? <Loader size={12} className="animate-spin" /> : isInstalled ? <CheckCircle size={12} /> : <Download size={12} />}
                              {isInstalling ? 'Installing…' : isInstalled ? 'Installed!' : 'Install Modpack'}
                            </button>
                          )}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                          <ArrowRight size={10} /> This will create a new instance with all mods and configurations from the modpack
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Load more */}
        {results.length > 0 && results.length < totalHits && (
          <div className="flex justify-center mt-4">
            <button onClick={() => search(offset + 20)} disabled={searching} className="btn btn-ghost">
              {searching ? <Loader size={13} className="animate-spin" /> : null}
              Load More ({totalHits - results.length} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
