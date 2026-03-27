import { useState, useEffect } from 'react';
import { ArrowLeft, Play, Square, Terminal, FolderOpen, Save, AlertTriangle, CheckCircle, Loader, Trash2, ToggleLeft, ToggleRight, Package, Upload } from 'lucide-react';
import { useStore } from '../store';
import { api } from '../api/bridge';
import LogViewer from '../components/LogViewer';

type Tab = 'overview' | 'mods' | 'resourcepacks' | 'shaderpacks' | 'libraries' | 'settings';

const LOADER_COLORS: Record<string, string> = {
  fabric: 'var(--text-2)', forge: 'var(--text-2)', neoforge: 'var(--text-2)', quilt: 'var(--text-2)', vanilla: 'var(--green-text)',
};
const LWJGL_OPTIONS = [
  { value: '', label: 'Auto-detect' },
  { value: 'lwjgl2-arm64', label: 'LWJGL2 arm64 (pre-1.13 Apple Silicon)' },
  { value: 'lwjgl3-arm64', label: 'LWJGL3 arm64 (1.13–1.19 Apple Silicon)' },
  { value: 'lwjgl3-3.3.1', label: 'LWJGL 3.3.1 (force specific version)' },
];

export default function InstanceDetailPage() {
  const { navigate, instances, selectedInstanceId, setCurrentInstanceId, users, activeUserId, setShowOnboarding,
          setInstanceRunning, updateInstance, systemInfo } = useStore();

  const inst = instances.find(i => i.id === selectedInstanceId);
  const activeUser = users.find(u => u.id === activeUserId);
  const isArm64Mac = systemInfo?.os === 'darwin' && systemInfo?.arch === 'arm64';

  const [tab, setTab] = useState<Tab>('overview');
  const [launching, setLaunching] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [javaInfo, setJavaInfo] = useState<any>(null);
  const [javaChecking, setJavaChecking] = useState(false);
  const [modMetadata, setModMetadata] = useState<Record<string, any>>({});
  const [loadingMetadata, setLoadingMetadata] = useState<Record<string, boolean>>({});
  const [modIcons, setModIcons] = useState<Record<string, string>>({});
  const [loadingIcons, setLoadingIcons] = useState<Record<string, boolean>>({});
  const [exporting, setExporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [mods, setMods] = useState<any[]>([]);
  const [resourcePacks, setResourcePacks] = useState<any[]>([]);
  const [shaderPacks, setShaderPacks] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);

  // Editable settings
  const [name, setName] = useState(inst?.name || '');
  const [ram, setRam] = useState(inst?.ram || 2048);
  const [jvmArgs, setJvmArgs] = useState(inst?.jvmArgs || '');
  const [javaPath, setJavaPath] = useState(inst?.javaPath || '');
  const [lwjgl, setLwjgl] = useState(inst?.lwjglOverride || '');
  const [description, setDescription] = useState(inst?.description || '');

  // Libraries tab
  const [mcVersionOverride, setMcVersionOverride] = useState(inst?.minecraftVersion || '');
  const [loaderOverride, setLoaderOverride] = useState(inst?.modLoader || 'vanilla');
  const [loaderVerOverride, setLoaderVerOverride] = useState(inst?.modLoaderVersion || '');
  const [loaderVersions, setLoaderVersions] = useState<any[]>([]);
  const { versions } = useStore();

  useEffect(() => {
    if (!inst) return;
    setName(inst.name); setRam(inst.ram); setJvmArgs(inst.jvmArgs);
    setJavaPath(inst.javaPath || ''); setLwjgl(inst.lwjglOverride || '');
    setDescription(inst.description || '');
    setMcVersionOverride(inst.minecraftVersion);
    setLoaderOverride(inst.modLoader); setLoaderVerOverride(inst.modLoaderVersion || '');
  }, [selectedInstanceId]);

  useEffect(() => {
    if (loaderOverride === 'vanilla') { setLoaderVersions([]); return; }
    const fetchers: Record<string, () => Promise<any[]>> = {
      fabric: () => api.getFabricVersions(mcVersionOverride),
      forge: () => api.getForgeVersions(mcVersionOverride),
      neoforge: () => api.getNeoForgeVersions(mcVersionOverride),
      quilt: () => api.getQuiltVersions(mcVersionOverride),
    };
    fetchers[loaderOverride]?.().then(vs => { setLoaderVersions(vs); if (!loaderVerOverride && vs[0]) setLoaderVerOverride(vs[0].id); }).catch(() => {});
  }, [loaderOverride, mcVersionOverride]);

  useEffect(() => {
    if (tab === 'overview' && inst) {
      setJavaChecking(true);
      api.validateJavaForInstance(inst.id).then(r => { setJavaInfo(r); setJavaChecking(false); }).catch(() => setJavaChecking(false));
    }
  }, [tab, selectedInstanceId]);

  if (!inst) { navigate('instances'); return null; }

  const launch = async () => {
    if (!activeUser) { setShowOnboarding(true); return; }
    setLaunching(true); setLaunchError('');
    try {
      const result = await api.launchInstance(inst.id, activeUser.id);
      if (result.success) {
        setInstanceRunning(inst.id, true, result.pid);
        api.openLogWindow(inst.id, inst.name).catch(() => setShowLog(true));
      } else {
        setLaunchError(result.error || 'Failed to launch');
      }
    } catch (e: any) { setLaunchError(e.message); }
    finally { setLaunching(false); }
  };

  const kill = async () => {
    await api.killInstance(inst.id).catch(() => {});
    setInstanceRunning(inst.id, false);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.updateInstance(inst.id, { name, ram, jvmArgs, javaPath, lwjglOverride: lwjgl, description });
      updateInstance(inst.id, { name, ram, jvmArgs, javaPath, lwjglOverride: lwjgl, description });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

  const applyLibraryChanges = async () => {
    setSaving(true);
    try {
      await api.updateInstance(inst.id, { minecraftVersion: mcVersionOverride, modLoader: loaderOverride, modLoaderVersion: loaderVerOverride });
      updateInstance(inst.id, { minecraftVersion: mcVersionOverride, modLoader: loaderOverride, modLoaderVersion: loaderVerOverride });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

  const removeMod = async (modId: string) => {
    await api.removeMod(inst.id, modId).catch(() => {});
    // Remove from local mods state
    setMods(prev => prev.filter(m => m.id !== modId));
  };

  const toggleMod = async (modId: string, enabled: boolean) => {
    await api.toggleMod(inst.id, modId, enabled).catch(() => {});
    // Update local mods state
    setMods(prev => prev.map(m => m.id === modId ? { ...m, enabled } : m));
  };

  const loadModIcon = async (modId: string) => {
    // Skip if already loaded or loading
    if (modIcons[modId] || loadingIcons[modId]) return;
    
    setLoadingIcons(prev => ({ ...prev, [modId]: true }));
    try {
      const iconData = await api.getModIcon(inst.id, modId);
      if (iconData.data) {
        setModIcons(prev => ({ ...prev, [modId]: iconData.data }));
      }
    } catch (e) {
      console.error(`Failed to load icon for mod ${modId}:`, e);
    } finally {
      setLoadingIcons(prev => ({ ...prev, [modId]: false }));
    }
  };

  const loadModMetadata = async (modId: string) => {
    // Skip if already loaded or loading
    if (modMetadata[modId] || loadingMetadata[modId]) return;
    
    setLoadingMetadata(prev => ({ ...prev, [modId]: true }));
    try {
      const metadata = await api.getModMetadata(inst.id, modId);
      setModMetadata(prev => ({ ...prev, [modId]: metadata }));
      
      // Load icon if metadata indicates it has one
      if (metadata.hasIcon && !modIcons[modId]) {
        await loadModIcon(modId);
      }
    } catch (e) {
      console.error(`Failed to load metadata for mod ${modId}:`, e);
      // Set empty metadata to prevent retrying failed mods
      setModMetadata(prev => ({ ...prev, [modId]: { error: true } }));
    } finally {
      setLoadingMetadata(prev => ({ ...prev, [modId]: false }));
    }
  };

  // Load mods when component mounts or when instance changes
  useEffect(() => {
    if (inst) {
      // Set current instance for pack installation
      setCurrentInstanceId(inst.id);
      
      // Load mods directly from folder
      const loadModsFromFolder = async () => {
        try {
          console.log(`Loading mods from folder for instance ${inst.name} (ID: ${inst.id})`);
          const modsList = await api.getMods(inst.id);
          console.log(`API returned mods:`, modsList);
          console.log(`Found ${modsList.length} mods in folder`);
          
          if (Array.isArray(modsList)) {
            setMods(modsList);
            console.log(`Set mods state to:`, modsList.map(m => ({ id: m.id, name: m.name, filename: m.filename })));
          } else {
            console.error(`API returned non-array:`, modsList);
          }
        } catch (e) {
          console.error('Failed to load mods from folder:', e);
        }
      };
      
      // Load resource packs
      const loadResourcePacks = async () => {
        try {
          console.log(`Loading resource packs for instance ${inst.name}`);
          const packsList = await api.getResourcePacks(inst.id);
          console.log(`Found ${packsList.length} resource packs`);
          setResourcePacks(packsList);
        } catch (e) {
          console.error('Failed to load resource packs:', e);
        }
      };
      
      // Load shader packs
      const loadShaderPacks = async () => {
        try {
          console.log(`Loading shader packs for instance ${inst.name}`);
          const packsList = await api.getShaderPacks(inst.id);
          console.log(`Found ${packsList.length} shader packs`);
          setShaderPacks(packsList);
        } catch (e) {
          console.error('Failed to load shader packs:', e);
        }
      };
      
      // Load all content
      loadModsFromFolder();
      loadResourcePacks();
      loadShaderPacks();
    }
  }, [selectedInstanceId]); // Load when instance changes

  // Load metadata when switching to mods tab
  useEffect(() => {
    if (tab === 'mods' && mods.length > 0) {
      // Reset metadata state
      setModMetadata({});
      setLoadingMetadata({});
      
      // Load metadata for each mod
      const loadMetadataForMods = async () => {
        for (let i = 0; i < mods.length; i++) {
          const mod = mods[i];
          console.log(`Loading metadata for mod ${i + 1}/${mods.length}: ${mod.name}`);
          await loadModMetadata(mod.id);
          
          // Add small delay between mods to prevent overwhelming
          if (i % 10 === 9) { // Every 10 mods, add a longer delay
            console.log(`Loaded 10 mods, taking a break...`);
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
        console.log(`Finished loading metadata for ${mods.length} mods`);
      };
      
      loadMetadataForMods();
    }
  }, [tab, mods]); // Load metadata when switching to mods tab

  const openFolder = async () => {
    const dir = await api.getInstanceDir(inst.id).catch(() => '');
    if (dir) api.openFolder(dir).catch(() => {});
  };

  const exportModpack = async () => {
    setExporting(true);
    try {
      const result = await api.exportModpack(inst.id);
      // The backend will open the folder containing the modpack
      console.log(`Modpack exported: ${result.modpackName}`);
    } catch (e: any) {
      console.error('Failed to export modpack:', e);
      // You might want to show an error message to the user here
    } finally {
      setExporting(false);
    }
  };

  const syncMods = async () => {
    setSyncing(true);
    try {
      const result = await api.syncMods(inst.id);
      // Update the instance data with the synced mods
      updateInstance(inst.id, { mods: result.mods });
      console.log(`Synced mods: ${result.mods.length} mods found`);
    } catch (e: any) {
      console.error('Failed to sync mods:', e);
    } finally {
      setSyncing(false);
    }
  };

  const removeResourcePack = async (filename: string) => {
    if (!inst) return;
    try {
      await api.removeResourcePack(inst.id, filename);
      // Reload resource packs
      const packsList = await api.getResourcePacks(inst.id);
      setResourcePacks(packsList);
    } catch (e) {
      console.error('Failed to remove resource pack:', e);
    }
  };

  const toggleResourcePack = async (filename: string, enabled: boolean) => {
    if (!inst) return;
    try {
      await api.toggleResourcePack(inst.id, filename, enabled);
      // Reload resource packs
      const packsList = await api.getResourcePacks(inst.id);
      setResourcePacks(packsList);
    } catch (e) {
      console.error('Failed to toggle resource pack:', e);
    }
  };

  const removeShaderPack = async (filename: string) => {
    if (!inst) return;
    try {
      await api.removeShaderPack(inst.id, filename);
      // Reload shader packs
      const packsList = await api.getShaderPacks(inst.id);
      setShaderPacks(packsList);
    } catch (e) {
      console.error('Failed to remove shader pack:', e);
    }
  };

  const toggleShaderPack = async (filename: string, enabled: boolean) => {
    if (!inst) return;
    try {
      await api.toggleShaderPack(inst.id, filename, enabled);
      // Reload shader packs
      const packsList = await api.getShaderPacks(inst.id);
      setShaderPacks(packsList);
    } catch (e) {
      console.error('Failed to toggle shader pack:', e);
    }
  };

  const uploadMod = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.jar';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setUploading(true);
      try {
        // Convert file to base64
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1];
          
          const fileInfo = {
            name: file.name,
            content: base64
          };

          // Import the mod (use importModpack for now)
          await api.importModpack(fileInfo);
          
          // Reload mods list
          const modsList = await api.getMods(inst.id);
          setMods(modsList);
        };
        reader.readAsDataURL(file);
      } catch (e: any) {
        console.error('Failed to upload mod:', e);
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  const loaderColor = LOADER_COLORS[inst.modLoader] || '#888';
  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'mods', label: `Mods (${mods.length})` },
    { id: 'resourcepacks', label: 'Resource Packs' },
    { id: 'shaderpacks', label: 'Shader Packs' },
    { id: 'libraries', label: 'Libraries ⚗' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border)', flexShrink: 0 }}>
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate('instances')} className="btn btn-ghost btn-sm" style={{ padding: '0.35rem 0.7rem' }}>
            <ArrowLeft size={13} /> Back
          </button>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${loaderColor}18`, border: `1px solid ${loaderColor}30` }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: loaderColor, fontFamily: 'DM Mono' }}>
              {inst.minecraftVersion.split('.').slice(0, 2).join('.')}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div style={{ fontWeight: 600, fontSize: '1rem' }} className="truncate">{inst.name}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
              {inst.minecraftVersion} · <span style={{ color: loaderColor }}>{inst.modLoader}{inst.modLoaderVersion ? ` ${inst.modLoaderVersion}` : ''}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={openFolder} className="btn btn-ghost btn-sm"><FolderOpen size={13} /></button>
            <button onClick={() => setShowLog(true)} className="btn btn-ghost btn-sm"><Terminal size={13} /> Logs</button>
            {inst.modLoader !== 'vanilla' && (
              <button onClick={exportModpack} disabled={exporting} className="btn btn-secondary btn-sm">
                {exporting ? <Loader size={12} className="animate-spin" /> : <Package size={12} />}
                {exporting ? 'Exporting…' : 'Export'}
              </button>
            )}
            {inst.isRunning ? (
              <button onClick={kill} className="btn btn-danger btn-sm"><Square size={11} fill="currentColor" /> Kill</button>
            ) : (
              <button onClick={launch} disabled={launching} className="btn btn-success btn-sm">
                {launching ? <Loader size={12} className="animate-spin" /> : <Play size={11} fill="currentColor" />}
                {launching ? 'Launching…' : 'Play'}
              </button>
            )}
          </div>
        </div>
        {launchError && (
          <div className="flex items-center gap-2 text-sm mb-2" style={{ color: '#f87171' }}>
            <AlertTriangle size={13} /> {launchError}
          </div>
        )}
        {/* Tabs */}
        <div className="flex gap-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="px-3 py-1.5 rounded-lg transition-all"
              style={{
                fontSize: '0.8rem', fontWeight: tab === t.id ? 500 : 400,
                background: tab === t.id ? 'rgba(139,92,246,0.15)' : 'transparent',
                color: tab === t.id ? '#c4b5fd' : 'var(--text-2)',
                border: `1px solid ${tab === t.id ? 'rgba(139,92,246,0.25)' : 'transparent'}`,
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">

        {/* OVERVIEW TAB */}
        {tab === 'overview' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Minecraft', value: inst.minecraftVersion },
                { label: 'Mod Loader', value: inst.modLoader + (inst.modLoaderVersion ? ` ${inst.modLoaderVersion}` : '') },
                { label: 'RAM', value: `${(inst.ram / 1024).toFixed(1)} GB` },
                { label: 'Mods', value: `${mods.length} installed` },
              ].map(({ label, value }) => (
                <div key={label} className="glass-card p-3">
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 500 }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Java status */}
            <div className="glass-card p-4">
              <div style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 8 }}>Java Status</div>
              {javaChecking ? (
                <div className="flex items-center gap-2" style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>
                  <Loader size={13} className="animate-spin" /> Checking Java…
                </div>
              ) : javaInfo ? (
                <div className="flex items-center gap-2">
                  {javaInfo.valid
                    ? <CheckCircle size={15} style={{ color: '#4ade80' }} />
                    : <AlertTriangle size={15} style={{ color: '#f87171' }} />}
                  <div>
                    <div style={{ fontSize: '0.84rem', fontWeight: 500, color: javaInfo.valid ? '#4ade80' : '#f87171' }}>
                      {javaInfo.valid ? 'Java OK' : 'Java Required'}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', fontFamily: 'DM Mono' }}>
                      {javaInfo.java ? `${javaInfo.java.version} (${javaInfo.java.arch}) — ${javaInfo.java.path}` : javaInfo.message}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {inst.description && (
              <div className="glass-card p-4">
                <div style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>{inst.description}</div>
              </div>
            )}
          </div>
        )}

        {/* MODS TAB */}
        {tab === 'mods' && (
          <div className="space-y-2 animate-fadeIn">
            <div className="flex items-center justify-between mb-3">
              <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>{mods.length} mods installed</span>
              <div className="flex items-center gap-2">
                <button onClick={uploadMod} disabled={uploading} className="btn btn-primary btn-sm">
                  {uploading ? <Loader size={12} className="animate-spin" /> : <Upload size={12} />}
                  {uploading ? 'Uploading…' : 'Upload Mod'}
                </button>
                <button onClick={() => navigate('mods')} className="btn btn-secondary btn-sm">Browse Mods</button>
              </div>
            </div>
            {mods.length === 0 ? (
              <div className="glass-card p-8 text-center">
                <div style={{ color: 'var(--text-3)', fontSize: '0.88rem', marginBottom: 12 }}>No mods installed</div>
                <button onClick={() => navigate('mods')} className="btn btn-primary btn-sm">Browse Modrinth</button>
              </div>
            ) : mods.map(mod => {
              console.log(`Rendering mod: ${mod.name} (${mod.id})`);
              const metadata = modMetadata[mod.id] || {};
              const displayName = metadata.displayName || mod.name || mod.filename || 'Unknown Mod';
              const displayVersion = metadata.displayVersion || mod.version || 'unknown';
              const displayAuthor = metadata.displayAuthor || 'Unknown';
              const displayDescription = metadata.displayDescription || '';
              const modloader = metadata.modloader || 'unknown';
              const mcversion = metadata.mcversion || 'unknown';
              const isLoading = loadingMetadata[mod.id] || false;
              const hasError = metadata.error || false;
              
              // Check if this is a ZIP file
              const isZipFile = mod.filename?.toLowerCase().endsWith('.zip') || false;

              // Always render the mod, even if metadata is loading or failed
              return (
                <div key={mod.id} className="glass-card p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex-shrink-0" style={{ background: 'var(--surface-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {modIcons[mod.id] ? (
                      <img src={modIcons[mod.id]} alt="" className="w-full h-full rounded-lg object-cover" />
                    ) : (
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}>
                        {loadingIcons[mod.id] ? (
                          <Loader size={10} className="animate-spin" />
                        ) : isZipFile ? (
                          'ZIP'
                        ) : (
                          'MOD'
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span style={{ fontSize: '0.84rem', fontWeight: 500 }} className="truncate">{displayName}</span>
                      {isZipFile && <span className="badge badge-warning" style={{ fontSize: '0.58rem' }}>ZIP</span>}
                      {modloader !== 'unknown' && !isZipFile && (
                        <span className="badge badge-default" style={{ fontSize: '0.58rem', opacity: 0.7 }}>{modloader}</span>
                      )}
                      {isLoading && <Loader size={12} className="animate-spin" style={{ color: 'var(--text-3)' }} />}
                      {hasError && !isZipFile && <span style={{ fontSize: '0.58rem', color: '#f87171' }}>Failed to load</span>}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>{displayVersion}</div>
                    {isZipFile ? (
                      <div style={{ fontSize: '0.65rem', color: '#fbbf24' }}>ZIP file - not a mod JAR</div>
                    ) : (
                      <>
                        {displayAuthor && displayAuthor !== 'Unknown' && (
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}>by {displayAuthor}</div>
                        )}
                        {displayDescription && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', lineHeight: 1.3 }} className="line-clamp-2">{displayDescription}</div>
                        )}
                        {mcversion !== 'unknown' && (
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}>MC {mcversion}</div>
                        )}
                      </>
                    )}
                  </div>
                  <button onClick={() => toggleMod(mod.id, !mod.enabled)} className="btn btn-ghost btn-sm" style={{ padding: '0.3rem', color: mod.enabled ? '#4ade80' : 'var(--text-3)' }}>
                    {mod.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  </button>
                  <button onClick={() => removeMod(mod.id)} className="btn btn-ghost btn-sm" style={{ padding: '0.3rem', color: '#f87171' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* RESOURCE PACKS TAB */}
        {tab === 'resourcepacks' && (
          <div className="space-y-2 animate-fadeIn">
            <div className="flex items-center justify-between mb-3">
              <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>{resourcePacks.length} resource packs</span>
              <div className="flex items-center gap-2">
                <button onClick={() => navigate('resourcepacks')} className="btn btn-secondary btn-sm">Browse Modrinth</button>
                <button onClick={() => {/* TODO: Implement upload */}} className="btn btn-primary btn-sm">Upload Pack</button>
              </div>
            </div>
            {resourcePacks.length === 0 ? (
              <div className="glass-card p-8 text-center">
                <div style={{ color: 'var(--text-3)', fontSize: '0.88rem', marginBottom: 12 }}>No resource packs installed</div>
                <div className="flex items-center gap-2 justify-center">
                  <button onClick={() => navigate('resourcepacks')} className="btn btn-primary btn-sm">Browse Modrinth</button>
                  <button onClick={() => {/* TODO: Implement upload */}} className="btn btn-secondary btn-sm">Upload Pack</button>
                </div>
              </div>
            ) : resourcePacks.map(pack => (
              <div key={pack.id} className="glass-card p-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex-shrink-0" style={{ background: 'var(--surface-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}>RP</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span style={{ fontSize: '0.84rem', fontWeight: 500 }} className="truncate">{pack.name}</span>
                    <span className="badge badge-info" style={{ fontSize: '0.58rem' }}>Resource Pack</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>{pack.filename}</div>
                </div>
                <button onClick={() => toggleResourcePack(pack.filename, !pack.enabled)} className="btn btn-ghost btn-sm" style={{ padding: '0.3rem', color: pack.enabled ? '#4ade80' : 'var(--text-3)' }}>
                  {pack.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                </button>
                <button onClick={() => removeResourcePack(pack.filename)} className="btn btn-ghost btn-sm" style={{ padding: '0.3rem', color: '#f87171' }}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* SHADER PACKS TAB */}
        {tab === 'shaderpacks' && (
          <div className="space-y-2 animate-fadeIn">
            <div className="flex items-center justify-between mb-3">
              <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>{shaderPacks.length} shader packs</span>
              <div className="flex items-center gap-2">
                <button onClick={() => navigate('shaderpacks')} className="btn btn-secondary btn-sm">Browse Modrinth</button>
                <button onClick={() => {/* TODO: Implement upload */}} className="btn btn-primary btn-sm">Upload Pack</button>
              </div>
            </div>
            {shaderPacks.length === 0 ? (
              <div className="glass-card p-8 text-center">
                <div style={{ color: 'var(--text-3)', fontSize: '0.88rem', marginBottom: 12 }}>No shader packs installed</div>
                <div className="flex items-center gap-2 justify-center">
                  <button onClick={() => navigate('shaderpacks')} className="btn btn-primary btn-sm">Browse Modrinth</button>
                  <button onClick={() => {/* TODO: Implement upload */}} className="btn btn-secondary btn-sm">Upload Pack</button>
                </div>
              </div>
            ) : shaderPacks.map(pack => (
              <div key={pack.id} className="glass-card p-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex-shrink-0" style={{ background: 'var(--surface-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}>SP</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span style={{ fontSize: '0.84rem', fontWeight: 500 }} className="truncate">{pack.name}</span>
                    <span className="badge badge-warning" style={{ fontSize: '0.58rem' }}>Shader Pack</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>{pack.filename}</div>
                </div>
                <button onClick={() => toggleShaderPack(pack.filename, !pack.enabled)} className="btn btn-ghost btn-sm" style={{ padding: '0.3rem', color: pack.enabled ? '#4ade80' : 'var(--text-3)' }}>
                  {pack.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                </button>
                <button onClick={() => removeShaderPack(pack.filename)} className="btn btn-ghost btn-sm" style={{ padding: '0.3rem', color: '#f87171' }}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* LIBRARIES TAB */}
        {tab === 'libraries' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="rounded-xl p-3 flex items-start gap-2" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
              <AlertTriangle size={13} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: '0.78rem', color: '#fbbf24', lineHeight: 1.6 }}>
                <strong>Experimental.</strong> Changing these settings modifies which shared library set this instance uses. Instances with the same MC version + modloader + modloader version automatically share libraries on disk.
              </div>
            </div>

            <div className="glass-card p-5 space-y-4">
              <div style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 4 }}>
                Shared Library Key
              </div>
              <div style={{ fontFamily: 'DM Mono', fontSize: '0.76rem', color: '#a78bfa', padding: '6px 10px', background: 'rgba(139,92,246,0.08)', borderRadius: 8, border: '1px solid rgba(139,92,246,0.15)' }}>
                {inst.minecraftVersion} / {inst.modLoader} / {inst.modLoaderVersion || 'none'}
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-3)', lineHeight: 1.6 }}>
                All instances sharing this key use the same downloaded jars, saving disk space. Only mods, config, saves, and screenshots are per-instance.
              </p>

              <div style={{ height: 1, background: 'var(--border)' }} />

              <div style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#fbbf24' }}>
                Override (Experimental)
              </div>

              <div>
                <label className="block mb-1.5" style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>Minecraft Version</label>
                <select className="input" value={mcVersionOverride} onChange={e => setMcVersionOverride(e.target.value)}>
                  {versions.map((v: any) => <option key={v.id} value={v.id}>{v.id}</option>)}
                </select>
              </div>

              <div>
                <label className="block mb-1.5" style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>Mod Loader</label>
                <div className="flex gap-1.5 flex-wrap">
                  {['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'].map(l => (
                    <button key={l} onClick={() => setLoaderOverride(l)}
                      className="px-3 py-1 rounded-lg text-sm transition-all"
                      style={{ background: loaderOverride === l ? 'rgba(139,92,246,0.15)' : 'var(--surface)', border: `1px solid ${loaderOverride === l ? 'rgba(139,92,246,0.3)' : 'var(--border)'}`, color: loaderOverride === l ? '#c4b5fd' : 'var(--text-2)', fontSize: '0.78rem' }}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {loaderOverride !== 'vanilla' && loaderVersions.length > 0 && (
                <div>
                  <label className="block mb-1.5" style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>Loader Version</label>
                  <select className="input" value={loaderVerOverride} onChange={e => setLoaderVerOverride(e.target.value)}>
                    {loaderVersions.map((v: any) => <option key={v.id} value={v.id}>{v.id}</option>)}
                  </select>
                </div>
              )}

              {isArm64Mac && (
                <div>
                  <label className="block mb-1.5" style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>
                    LWJGL Override <span style={{ fontSize: '0.65rem', color: '#fbbf24' }}>Apple Silicon</span>
                  </label>
                  <select className="input" value={lwjgl} onChange={e => setLwjgl(e.target.value)}>
                    {LWJGL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginTop: 4 }}>
                    For Minecraft ≤ 1.8.x on Apple Silicon (M1/M2/M3), use "LWJGL2 arm64" to get native arm64 rendering. Auto-detect handles this automatically based on version.
                  </div>
                </div>
              )}

              <button onClick={applyLibraryChanges} disabled={saving} className="btn btn-primary">
                {saving ? <Loader size={13} className="animate-spin" /> : saved ? <CheckCircle size={13} /> : <Save size={13} />}
                {saved ? 'Applied!' : 'Apply Changes'}
              </button>
            </div>
          </div>
        )}

        {/* SETTINGS TAB */}
        {tab === 'settings' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="glass-card p-5 space-y-4">
              <div>
                <label className="block mb-1.5" style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>Instance Name</label>
                <input className="input" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div>
                <label className="block mb-1.5" style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>Description</label>
                <textarea className="input" rows={2} value={description} onChange={e => setDescription(e.target.value)} style={{ resize: 'vertical' }} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>Memory (RAM)</label>
                  <span style={{ fontSize: '0.78rem', color: '#a78bfa', fontFamily: 'DM Mono', fontWeight: 500 }}>{(ram / 1024).toFixed(1)} GB</span>
                </div>
                <input type="range" min={512} max={16384} step={512} value={ram} onChange={e => setRam(Number(e.target.value))} style={{ width: '100%', accentColor: '#8b5cf6' }} />
              </div>
              <div>
                <label className="block mb-1.5" style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>Extra JVM Arguments</label>
                <input className="input" value={jvmArgs} onChange={e => setJvmArgs(e.target.value)} placeholder="-XX:+UseShenandoahGC …" />
              </div>
              <div>
                <label className="block mb-1.5" style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>Java Path (leave blank for auto)</label>
                <input className="input" value={javaPath} onChange={e => setJavaPath(e.target.value)} placeholder="/usr/bin/java" style={{ fontFamily: 'DM Mono', fontSize: '0.8rem' }} />
              </div>
              <button onClick={save} disabled={saving} className="btn btn-primary">
                {saving ? <Loader size={13} className="animate-spin" /> : saved ? <CheckCircle size={13} /> : <Save size={13} />}
                {saved ? 'Saved!' : 'Save Settings'}
              </button>
            </div>
          </div>
        )}
      </div>

      {showLog && <LogViewer instanceId={inst.id} onClose={() => setShowLog(false)} />}
    </div>
  );
}
