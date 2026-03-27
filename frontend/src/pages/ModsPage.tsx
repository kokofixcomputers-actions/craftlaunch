import { useState, useEffect, useCallback } from 'react';
import { Search, Download, ChevronDown, X, Loader, CheckCircle } from 'lucide-react';
import { useStore } from '../store';
import { api } from '../api/bridge';

export default function ModsPage() {
  const { instances, selectedInstanceId } = useStore();
  const [query, setQuery] = useState('');
  const [selectedInstance, setSelectedInstance] = useState(selectedInstanceId || instances[0]?.id || '');
  const [results, setResults] = useState<any[]>([]);
  const [totalHits, setTotalHits] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searching, setSearching] = useState(false);
  const [expandedMod, setExpandedMod] = useState<string | null>(null);
  const [modVersions, setModVersions] = useState<Record<string, any[]>>({});
  const [loadingVersions, setLoadingVersions] = useState<string | null>(null);
  const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState<string | null>(null);
  const [installedFilenames, setInstalledFilenames] = useState<Set<string>>(new Set());

  const inst = instances.find(i => i.id === selectedInstance);

  // Reload installed filenames from disk whenever the selected instance changes
  useEffect(() => {
    if (!inst) return;
    api.getMods(inst.id).then(mods => {
      setInstalledFilenames(new Set(mods.map((m: any) => m.filename)));
    }).catch(() => {});
  }, [inst?.id]);

  const search = useCallback(async (newOffset = 0) => {
    if (!inst) return;
    setSearching(true);
    try {
      const result = await api.searchMods(query, inst.minecraftVersion, inst.modLoader, newOffset);
      if (newOffset === 0) setResults(result.hits);
      else setResults(prev => [...prev, ...result.hits]);
      setTotalHits(result.total_hits);
      setOffset(newOffset);
    } catch {}
    setSearching(false);
  }, [query, inst?.id]);

  useEffect(() => {
    if (inst) search(0);
  }, [inst?.id, inst?.minecraftVersion, inst?.modLoader]);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); search(0); };

  const loadVersions = async (projectId: string) => {
    if (modVersions[projectId] || !inst) return;
    setLoadingVersions(projectId);
    try {
      const vs = await api.getModVersions(projectId, inst.minecraftVersion, inst.modLoader);
      setModVersions(prev => ({ ...prev, [projectId]: vs }));
      if (vs[0]) setSelectedVersions(prev => ({ ...prev, [projectId]: vs[0].id }));
    } catch {}
    setLoadingVersions(null);
  };

  const toggleExpand = (projectId: string) => {
    if (expandedMod === projectId) { setExpandedMod(null); return; }
    setExpandedMod(projectId);
    loadVersions(projectId);
  };

  const installMod = async (mod: any) => {
    if (!inst) return;
    const versionId = selectedVersions[mod.project_id];
    const versions = modVersions[mod.project_id] || [];
    const version = versions.find(v => v.id === versionId) || versions[0];
    if (!version) return;
    const file = version.files.find((f: any) => f.primary) || version.files[0];
    if (!file) return;

    setInstalling(mod.project_id);
    try {
      await api.installMod(inst.id, version.id, file.filename, file.url);
      setInstalledFilenames(prev => new Set([...prev, file.filename]));
      setInstalled(mod.project_id);
      setTimeout(() => setInstalled(null), 2500);
    } catch (e: any) { console.error(e); }
    setInstalling(null);
  };

  const isModInstalled = (projectId: string) => {
    const versions = modVersions[projectId] || [];
    const selectedVid = selectedVersions[projectId];
    const version = versions.find(v => v.id === selectedVid) || versions[0];
    if (!version) return false;
    const file = version.files.find((f: any) => f.primary) || version.files[0];
    return file ? installedFilenames.has(file.filename) : false;
  };

  const formatDownloads = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="px-5 py-4 border-b space-y-3" style={{ borderColor: 'var(--border)', flexShrink: 0 }}>
        <div className="flex items-center gap-3">
          <div style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', flexShrink: 0 }}>
            Modrinth
          </div>
          {/* Instance selector */}
          <select className="input" style={{ maxWidth: 200, height: 34 }} value={selectedInstance} onChange={e => setSelectedInstance(e.target.value)}>
            {instances.length === 0 && <option value="">No instances</option>}
            {instances.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          {inst && (
            <div className="flex items-center gap-1.5">
              <span className="badge badge-default" style={{ fontSize: '0.65rem' }}>{inst.minecraftVersion}</span>
              <span className="badge badge-info" style={{ fontSize: '0.65rem' }}>{inst.modLoader}</span>
            </div>
          )}
        </div>
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingLeft: 32 }} placeholder={inst ? `Search mods for ${inst.minecraftVersion} ${inst.modLoader}…` : 'Select an instance first…'}
              value={query} onChange={e => setQuery(e.target.value)} disabled={!inst} />
          </div>
          <button type="submit" disabled={searching || !inst} className="btn btn-primary btn-sm">
            {searching ? <Loader size={13} className="animate-spin" /> : <Search size={13} />} Search
          </button>
        </form>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-5">
        {!inst && (
          <div className="glass-card p-10 text-center">
            <div style={{ color: 'var(--text-3)', fontSize: '0.88rem' }}>Create an instance first, then browse mods for it</div>
          </div>
        )}

        {inst && results.length === 0 && !searching && (
          <div className="glass-card p-10 text-center">
            <div style={{ color: 'var(--text-3)', fontSize: '0.88rem' }}>
              {query ? 'No mods found. Try a different search.' : 'Search Modrinth for mods'}
            </div>
          </div>
        )}

        {searching && results.length === 0 && (
          <div className="flex items-center justify-center py-16 gap-3" style={{ color: 'var(--text-3)' }}>
            <Loader size={16} className="animate-spin" /> Searching Modrinth…
          </div>
        )}

        <div className="space-y-2">
          {results.map((mod, i) => {
            const expanded = expandedMod === mod.project_id;
            const versions = modVersions[mod.project_id] || [];
            const alreadyInstalled = isModInstalled(mod.project_id);

            return (
              <div key={mod.project_id} className="glass-card overflow-hidden animate-fadeUp" style={{ animationDelay: `${i * 30}ms` }}>
                <div className="p-4 flex items-center gap-3 cursor-pointer" onClick={() => toggleExpand(mod.project_id)}>
                  {/* Icon */}
                  <div className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
                    {mod.icon_url
                      ? <img src={mod.icon_url} alt="" className="w-10 h-10 rounded-lg object-cover" />
                      : <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-3)' }}>{mod.title.slice(0, 2).toUpperCase()}</span>}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{mod.title}</span>
                      {alreadyInstalled && <span className="badge badge-success" style={{ fontSize: '0.6rem' }}>Installed</span>}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', lineHeight: 1.4 }} className="truncate">{mod.description}</div>
                    <div className="flex items-center gap-3 mt-1">
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}>↓ {formatDownloads(mod.downloads)}</span>
                      {mod.categories.slice(0, 3).map((c: string) => (
                        <span key={c} className="badge badge-default" style={{ fontSize: '0.58rem' }}>{c}</span>
                      ))}
                    </div>
                  </div>

                  <ChevronDown size={14} style={{ color: 'var(--text-3)', flexShrink: 0, transform: expanded ? 'rotate(180deg)' : '', transition: '0.2s' }} />
                </div>

                {/* Expanded: version picker */}
                {expanded && (
                  <div className="border-t px-4 pb-4 pt-3 animate-fadeIn" style={{ borderColor: 'var(--border)' }}>
                    {loadingVersions === mod.project_id ? (
                      <div className="flex items-center gap-2" style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>
                        <Loader size={12} className="animate-spin" /> Loading versions…
                      </div>
                    ) : versions.length === 0 ? (
                      <div style={{ fontSize: '0.82rem', color: '#f87171' }}>No versions compatible with {inst.minecraftVersion} + {inst.modLoader}</div>
                    ) : (
                      <div className="flex items-center gap-3 flex-wrap">
                        <select className="input" style={{ maxWidth: 280, height: 34 }}
                          value={selectedVersions[mod.project_id] || ''}
                          onChange={e => setSelectedVersions(prev => ({ ...prev, [mod.project_id]: e.target.value }))}>
                          {versions.map((v: any) => (
                            <option key={v.id} value={v.id}>
                              {v.name} ({v.version_number}) — {formatDownloads(v.downloads)} downloads{v.featured ? ' ★' : ''}
                            </option>
                          ))}
                        </select>
                        {alreadyInstalled ? (
                          <div className="flex items-center gap-1.5 badge badge-success">
                            <CheckCircle size={11} /> Installed
                          </div>
                        ) : (
                          <button onClick={() => installMod(mod)} disabled={!!installing || !!installed}
                            className={`btn btn-sm ${installed === mod.project_id ? 'btn-success' : 'btn-primary'}`}>
                            {installing === mod.project_id ? <Loader size={12} className="animate-spin" /> : installed === mod.project_id ? <CheckCircle size={12} /> : <Download size={12} />}
                            {installing === mod.project_id ? 'Installing…' : installed === mod.project_id ? 'Installed!' : 'Install'}
                          </button>
                        )}
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
