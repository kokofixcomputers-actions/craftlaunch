import { useState, useEffect, useCallback } from 'react';
import { Search, Download, Star, Package, Loader, ChevronDown, CheckCircle } from 'lucide-react';
import { api } from '../api/bridge';
import { useStore } from '../store';

const formatDownloads = (count: number) => {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
};

export default function ResourcePacksPage() {
  const { currentInstanceId, navigate } = useStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [totalHits, setTotalHits] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searching, setSearching] = useState(false);
  const [expandedPack, setExpandedPack] = useState<string | null>(null);
  const [loadingVersions, setLoadingVersions] = useState<string | null>(null);
  const [packVersions, setPackVersions] = useState<Record<string, any[]>>({});
  const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState<string | null>(null);

  const search = useCallback(async (newOffset = 0) => {
    setSearching(true);
    try {
      // Use the dedicated searchResourcePacks API
      const result = await api.searchResourcePacks(query, newOffset);
      if (newOffset === 0) setResults(result.hits);
      else setResults(prev => [...prev, ...result.hits]);
      setTotalHits(result.total_hits);
      setOffset(newOffset);
    } catch (e) {
      console.error('Search failed:', e);
    } finally {
      setSearching(false);
    }
  }, [query]);

  useEffect(() => {
    search(0);
  }, [search]);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); search(0); };

  const loadVersions = async (projectId: string) => {
    if (packVersions[projectId]) return;
    setLoadingVersions(projectId);
    try {
      const vs = await api.getModVersions(projectId, '', '');
      setPackVersions(prev => ({ ...prev, [projectId]: vs }));
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
    if (expandedPack === projectId) { setExpandedPack(null); return; }
    setExpandedPack(projectId);
    loadVersions(projectId);
  };

  const installPack = async (pack: any) => {
    const versionId = selectedVersions[pack.project_id];
    if (!versionId || !currentInstanceId) return;

    setInstalling(pack.project_id);
    try {
      // Get the version details to download the pack file
      const version = await api.getModpackVersionDetails(versionId);
      const file = version.files.find((f: any) => f.primary) || version.files[0];
      if (!file) throw new Error('No download file found');

      // Download the pack file
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

        // Import the resource pack to the current instance
        await api.importResourcePack(currentInstanceId, fileInfo);
        setInstalled(pack.project_id);
        setTimeout(() => setInstalled(null), 3000);
      };
      reader.readAsDataURL(blob);
    } catch (e: any) {
      console.error('Failed to install resource pack:', e);
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border)', flexShrink: 0 }}>
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate('instance-detail', currentInstanceId || undefined)} className="btn btn-ghost btn-sm" style={{ padding: '0.35rem 0.7rem' }}>
            ← Back
          </button>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 600 }}>Browse Resource Packs</h1>
        </div>
        
        {/* Search */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
            <input
              type="text"
              placeholder="Search resource packs..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="input"
              style={{ paddingLeft: 40, height: 36 }}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={searching}>
            {searching ? <Loader size={14} className="animate-spin" /> : <Search size={14} />}
            Search
          </button>
        </form>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-5">
        {results.length === 0 && !searching && (
          <div className="text-center py-8" style={{ color: 'var(--text-3)' }}>
            <Package size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
            <div style={{ fontSize: '0.9rem', marginBottom: 8 }}>No resource packs found</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>Try searching for something else</div>
          </div>
        )}

        <div className="space-y-3">
          {results.map((pack: any) => {
            const expanded = expandedPack === pack.project_id;
            const isInstalling = installing === pack.project_id;
            const isInstalled = installed === pack.project_id;
            const isLoadingVersions = loadingVersions === pack.project_id;
            const versions = packVersions[pack.project_id] || [];

            return (
              <div key={pack.project_id} className="glass-card p-4">
                {/* Header */}
                <div className="flex items-center gap-3 cursor-pointer" onClick={() => toggleExpand(pack.project_id)}>
                  <div className="w-10 h-10 rounded-lg flex-shrink-0" style={{ background: 'var(--surface-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {pack.icon_url
                      ? <img src={pack.icon_url} alt="" className="w-10 h-10 rounded-lg object-cover" />
                      : <Package size={16} style={{ color: 'var(--text-3)' }} />}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{pack.title}</span>
                      {isInstalled && <span className="badge badge-success" style={{ fontSize: '0.6rem' }}>Installed</span>}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', lineHeight: 1.4 }} className="truncate">{pack.description}</div>
                    <div className="flex items-center gap-3 mt-1">
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}>↓ {formatDownloads(pack.downloads)}</span>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}><Star size={10} /> {pack.follows}</span>
                      {pack.categories.slice(0, 2).map((c: string) => (
                        <span key={c} className="badge badge-default" style={{ fontSize: '0.58rem' }}>{c}</span>
                      ))}
                    </div>
                  </div>

                  <ChevronDown size={14} style={{ color: 'var(--text-3)', flexShrink: 0, transform: expanded ? 'rotate(180deg)' : '', transition: '0.2s' }} />
                </div>

                {/* Expanded: version picker */}
                {expanded && (
                  <div className="border-t px-4 pb-4 pt-3 animate-fadeIn" style={{ borderColor: 'var(--border)' }}>
                    {isLoadingVersions ? (
                      <div className="flex items-center gap-2" style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>
                        <Loader size={12} className="animate-spin" /> Loading versions…
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 flex-wrap">
                          <select className="input" style={{ maxWidth: 280, height: 34 }}
                            value={selectedVersions[pack.project_id] || ''}
                            onChange={e => setSelectedVersions(prev => ({ ...prev, [pack.project_id]: e.target.value }))}>
                            {packVersions[pack.project_id]?.map((version: any) => (
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
                            <button onClick={() => installPack(pack)} disabled={!!isInstalling || !!installed || !selectedVersions[pack.project_id]}
                              className={`btn btn-sm ${isInstalled ? 'btn-success' : 'btn-primary'}`}>
                              {isInstalling ? <Loader size={12} className="animate-spin" /> : isInstalled ? <CheckCircle size={12} /> : <Download size={12} />}
                              {isInstalling ? 'Installing…' : isInstalled ? 'Installed!' : 'Install Pack'}
                            </button>
                          )}
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
        {results.length < totalHits && results.length > 0 && (
          <div className="text-center py-4">
            <button onClick={() => search(offset + 20)} disabled={searching} className="btn btn-secondary">
              {searching ? <Loader size={14} className="animate-spin" /> : null}
              Load More
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
