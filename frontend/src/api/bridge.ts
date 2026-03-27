/**
 * api/bridge.ts - wraps pywebview.api and unwraps {ok, data, error} envelope.
 * Falls back to mock data when running outside pywebview.
 */

const isPywebview = () =>
  typeof window !== 'undefined' && !!(window as any).pywebview?.api;

// Wait for pywebview to be ready with timeout
export const waitForPywebview = (timeoutMs = 10000): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (isPywebview()) {
      resolve();
      return;
    }

    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (isPywebview()) {
        clearInterval(checkInterval);
        resolve();
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(checkInterval);
        reject(new Error('pywebview not available within timeout'));
      }
    }, 100);
  });
};

async function call<T>(method: string, ...args: any[]): Promise<T> {
  if (isPywebview()) {
    const result = await (window as any).pywebview.api[method](...args);
    if (result && typeof result === 'object' && 'ok' in result) {
      if (!result.ok) throw new Error(result.error || 'Unknown error');
      return result.data as T;
    }
    return result as T;
  }
  const mock = mockHandlers[method];
  if (mock) return mock(...args) as T;
  throw new Error(`No mock for ${method}`);
}

export const api = {
  minimize: () => call<void>('minimize'),
  maximize: () => call<void>('maximize'),
  quit:     () => call<void>('quit'),

  startMicrosoftLogin:    () => call<{ url: string }>('startMicrosoftLogin'),
  completeMicrosoftLogin: (code: string) => call<any>('completeMicrosoftLogin', code),
  refreshUserToken:       (userId: string, rt: string) => call<any>('refreshUserToken', userId, rt),
  storeUserTokens:        (userId: string, at: string, rt: string, userObject?: any) => call<void>('storeUserTokens', userId, at, rt, userObject),
  getUsersFromDisk:       () => call<any>('getUsersFromDisk'),
  saveUsersToDisk:        (users: any[], activeUserId: string) => call<void>('saveUsersToDisk', users, activeUserId),
  removeUserFromDisk:     (userId: string) => call<void>('removeUserFromDisk', userId),
  setActiveUserOnDisk:    (userId: string) => call<void>('setActiveUserOnDisk', userId),
  validateToken:          (at: string) => call<{ valid: boolean }>('validateToken', at),

  getMinecraftVersions:   () => call<any[]>('getMinecraftVersions'),
  getVersionsFiltered:    (type: string) => call<any[]>('getVersionsFiltered', type),
  getAllMinecraftVersions: () => call<any[]>('getAllMinecraftVersions'),
  getFabricVersions:      (mc: string) => call<any[]>('getFabricVersions', mc),
  getForgeVersions:       (mc: string) => call<any[]>('getForgeVersions', mc),
  getNeoForgeVersions:    (mc: string) => call<any[]>('getNeoForgeVersions', mc),
  getQuiltVersions:       (mc: string) => call<any[]>('getQuiltVersions', mc),

  getInstances:    ()                       => call<any[]>('getInstances'),
  createInstance:  (data: any)              => call<any>('createInstance', data),
  updateInstance:  (id: string, data: any)  => call<any>('updateInstance', id, data),
  deleteInstance:  (id: string)             => call<void>('deleteInstance', id),

  launchInstance:      (instanceId: string, userId: string) => call<any>('launchInstance', instanceId, userId),
  killInstance:        (instanceId: string) => call<void>('killInstance', instanceId),
  getRunningInstances: ()                   => call<string[]>('getRunningInstances'),

  findJava:                ()              => call<any[]>('findJava'),
  checkJava:               (path?: string) => call<any>('checkJava', path || ''),
  testJava:                (path: string) => call<any>('testJava', path),
  setDefaultJava:          (path: string) => call<any>('setDefaultJava', path),
  getDefaultJava:          () => call<any>('getDefaultJava'),
  setInstanceJava:         (instanceId: string, path: string) => call<any>('setInstanceJava', instanceId, path),
  validateJavaForInstance: (id: string)    => call<any>('validateJavaForInstance', id),

  searchMods:    (q: string, mc: string, loader: string, offset: number) =>
                   call<any>('searchMods', q, mc, loader, offset),
  getModVersions:(projectId: string, mc: string, loader: string) =>
                   call<any[]>('getModVersions', projectId, mc, loader),
  installMod:    (instanceId: string, versionId: string, filename: string, url: string) =>
                   call<any>('installMod', instanceId, versionId, filename, url),
  removeMod:     (instanceId: string, filename: string)               => call<void>('removeMod', instanceId, filename),
  toggleMod:     (instanceId: string, filename: string, enabled: boolean) => call<void>('toggleMod', instanceId, filename, enabled),

  getModMetadata: (instanceId: string, modId: string) => call<any>('getModMetadata', instanceId, modId),
  getModIcon:      (instanceId: string, modId: string) => call<any>('getModIcon', instanceId, modId),

  getMods: (instanceId: string) => call<any[]>('getMods', instanceId),

  getResourcePacks: (instanceId: string) => call<any[]>('getResourcePacks', instanceId),
  getShaderPacks: (instanceId: string) => call<any[]>('getShaderPacks', instanceId),

  importResourcePack: (instanceId: string, fileInfo: { name: string, content: string }) => call<any>('importResourcePack', instanceId, fileInfo),
  importShaderPack: (instanceId: string, fileInfo: { name: string, content: string }) => call<any>('importShaderPack', instanceId, fileInfo),

  removeResourcePack: (instanceId: string, filename: string) => call<any>('removeResourcePack', instanceId, filename),
  removeShaderPack: (instanceId: string, filename: string) => call<any>('removeShaderPack', instanceId, filename),
  toggleResourcePack: (instanceId: string, filename: string, enabled: boolean) => call<any>('toggleResourcePack', instanceId, filename, enabled),
  toggleShaderPack: (instanceId: string, filename: string, enabled: boolean) => call<any>('toggleShaderPack', instanceId, filename, enabled),

  syncMods: (instanceId: string) => call<any>('syncMods', instanceId),

  exportModpack: (instanceId: string) => call<any>('exportModpack', instanceId),

  searchModpacks: (query: string, offset: number) => call<any>('searchModpacks', query, offset),
  searchResourcePacks: (query: string, offset: number) => call<any>('searchResourcePacks', query, offset),
  searchShaderPacks: (query: string, offset: number) => call<any>('searchShaderPacks', query, offset),
  getModpackVersions: (projectId: string) => call<any[]>('getModpackVersions', projectId),
  getModpackVersionDetails: (versionId: string) => call<any>('getModpackVersionDetails', versionId),

  getLogs:   (instanceId: string) => call<any[]>('getLogs', instanceId),
  openLogWindow: (instanceId: string, instanceName: string) => call<any>('openLogWindow', instanceId, instanceName),
  clearLogs: (instanceId: string) => call<void>('clearLogs', instanceId),
  getLogsAsText: (instanceId: string) => call<string>('getLogsAsText', instanceId),

  getSystemInfo:  () => call<any>('getSystemInfo'),
  openFolder:     (path: string) => call<void>('openFolder', path),
  getInstanceDir: (id: string)   => call<string>('getInstanceDir', id),

  importModpack:  (fileInfo: { name: string; content: string }) => call<any>('importModpack', fileInfo),
};

// ── Dev mocks ──────────────────────────────────────────────────────────────

const MOCK_VERSIONS = [
  { id: '1.21.1', type: 'release', releaseTime: '2024-08-08', url: '' },
  { id: '1.20.4', type: 'release', releaseTime: '2023-12-07', url: '' },
  { id: '1.20.1', type: 'release', releaseTime: '2023-06-12', url: '' },
  { id: '1.19.4', type: 'release', releaseTime: '2023-03-14', url: '' },
  { id: '1.18.2', type: 'release', releaseTime: '2022-02-28', url: '' },
  { id: '1.16.5', type: 'release', releaseTime: '2021-01-15', url: '' },
  { id: '1.12.2', type: 'release', releaseTime: '2017-09-18', url: '' },
  { id: '1.8.9',  type: 'release', releaseTime: '2015-12-09', url: '' },
];

let mockInstances: any[] = [];

const mockHandlers: Record<string, (...args: any[]) => any> = {
  minimize: () => {}, maximize: () => {}, quit: () => {},
  startMicrosoftLogin:    () => ({ url: 'https://login.microsoftonline.com/mock' }),
  completeMicrosoftLogin: () => ({ id: 'mock-user-1', username: 'MockPlayer', uuid: 'mock-uuid-1', accessToken: 'mock-token', refreshToken: 'mock-refresh', isActive: true }),
  refreshUserToken: () => ({ accessToken: 'new-token', refreshToken: 'new-refresh' }),
  storeUserTokens: (userId: string, at: string, rt: string, userObject?: any) => {
    console.log('Mock: storeUserTokens called with userObject:', userObject);
  }, validateToken: () => ({ valid: true }),
  getUsersFromDisk: () => {
    // Check if we have real users data in localStorage (from previous runs)
    const stored = localStorage.getItem('craftlaunch_users');
    if (stored) {
      try {
        const users = JSON.parse(stored);
        const activeUserId = localStorage.getItem('craftlaunch_active_user');
        return { users, activeUserId };
      } catch {}
    }
    // Return empty to show onboarding for first-time dev experience
    return { users: [], activeUserId: null };
  },
  saveUsersToDisk: () => {}, removeUserFromDisk: () => {}, setActiveUserOnDisk: () => {},
  getMinecraftVersions: () => MOCK_VERSIONS,
  getVersionsFiltered: (type: string) => MOCK_VERSIONS.filter((v: any) => type === 'all' || v.type === type), getAllMinecraftVersions: () => MOCK_VERSIONS,
  getFabricVersions:   () => [{ id: '0.15.11', loader: 'fabric',   stable: true }],
  getForgeVersions:    () => [{ id: '49.0.7',  loader: 'forge',    stable: true }],
  getNeoForgeVersions: () => [{ id: '21.1.77', loader: 'neoforge', stable: true }],
  getQuiltVersions:    () => [{ id: '0.26.0',  loader: 'quilt',    stable: true }],
  getInstances: () => mockInstances,
  createInstance: (data: any) => {
    const inst = { ...data, id: Math.random().toString(36).slice(2), createdAt: new Date().toISOString(), isRunning: false, mods: [], ram: data.ram || 2048 };
    mockInstances.push(inst); return inst;
  },
  updateInstance: (id: string, data: any) => {
    mockInstances = mockInstances.map(i => i.id === id ? { ...i, ...data } : i);
    return mockInstances.find(i => i.id === id);
  },
  deleteInstance: (id: string) => { mockInstances = mockInstances.filter(i => i.id !== id); },
  launchInstance: () => ({ success: true, pid: 99999 }),
  killInstance: () => {}, getRunningInstances: () => [],
  findJava: () => [{ path: '/usr/bin/java', version: '21.0.1', arch: 'arm64', valid: true }],
  checkJava: () => ({ path: '/usr/bin/java', version: '21.0.1', arch: 'arm64', valid: true }),
  testJava: (path: string) => ({ path, version: '21.0.1', arch: 'arm64', valid: true, raw: 'openjdk 21.0.1 2023-10-17\nOpenJDK Runtime Environment Zulu21.30+15' }),
  setDefaultJava: (path: string) => ({ message: 'Default Java path set successfully', java_path: path }),
  getDefaultJava: () => ({}),
  setInstanceJava: (instanceId: string, path: string) => ({ message: 'Instance Java path set successfully', instance_id: instanceId, java_path: path }),
  validateJavaForInstance: () => ({ valid: true, java: { path: '/usr/bin/java', version: '21.0.1', arch: 'arm64' }, message: '' }),
  searchMods: (q: string) => ({
    hits: q ? [
      { project_id: 'AANobbMI', slug: 'sodium', title: 'Sodium', description: 'A modern rendering engine for Minecraft that greatly improves frame rates and reduces micro-stutter.', downloads: 16000000, follows: 55000, categories: ['optimization'], versions: ['1.21.1', '1.20.4'], loaders: ['fabric', 'quilt'] },
      { project_id: 'gvQqBUqZ', slug: 'lithium', title: 'Lithium', description: 'General-purpose optimization mod for Minecraft servers and clients.', downloads: 9000000, follows: 30000, categories: ['optimization'], versions: ['1.21.1', '1.20.4'], loaders: ['fabric'] },
    ] : [], total_hits: q ? 2 : 0,
  }),
  getModVersions: () => [{ id: 'mock-ver-1', project_id: 'AANobbMI', name: 'Sodium 0.5.8', version_number: '0.5.8', game_versions: ['1.21.1'], loaders: ['fabric'], date_published: '2024-08-15', downloads: 500000, featured: true, files: [{ url: 'https://cdn.modrinth.com/mock/sodium.jar', filename: 'sodium-fabric-0.5.8+mc1.21.1.jar', primary: true, size: 1234567 }] }],
  installMod: (_: any, vId: string, filename: string) => ({ id: Math.random().toString(36).slice(2), name: filename, slug: filename, version: '1.0.0', versionId: vId, filename, enabled: true }),
  removeMod: () => {}, toggleMod: () => {},
  getModMetadata: (instanceId: string, modId: string) => {
    // Mock implementation - in real app this would extract from JAR
    return {
      id: modId,
      name: `Mock Mod ${modId.slice(0, 8)}`,
      displayName: `Mock Mod ${modId.slice(0, 8)}`,
      displayVersion: '1.0.0',
      displayAuthor: 'Mock Author',
      displayDescription: 'This is a mock mod description extracted from JAR file.',
      modloader: 'forge',
      mcversion: '1.20.1',
      hasIcon: false,
      iconFilename: '',
      iconSize: 0,
      extractedMetadata: {
        modid: modId,
        name: `Mock Mod ${modId.slice(0, 8)}`,
        description: 'This is a mock mod description extracted from JAR file.',
        version: '1.0.0',
        mcversion: '1.20.1',
        author: 'Mock Author'
      }
    };
  },
  getModIcon: (instanceId: string, modId: string) => {
    // Mock implementation - return empty result for dev mode
    throw new Error('Icon extraction not available in mock mode');
  },
  getMods: (instanceId: string) => {
    // Mock implementation - in real app this would scan mods folder
    return Array.from({ length: 29 }, (_, i) => ({
      id: `mod-${i}`,
      filename: `mod-${i + 1}.jar`,
      name: `Mod ${i + 1}`,
      version: '1.0.0',
      enabled: true
    }));
  },
  getResourcePacks: (instanceId: string) => {
    // Mock implementation - in real app this would scan resourcepacks folder
    return Array.from({ length: 3 }, (_, i) => ({
      id: `resourcepack-${i}`,
      filename: `resourcepack-${i + 1}.zip`,
      name: `Resource Pack ${i + 1}`,
      enabled: true
    }));
  },
  getShaderPacks: (instanceId: string) => {
    // Mock implementation - in real app this would scan shaderpacks folder
    return Array.from({ length: 2 }, (_, i) => ({
      id: `shaderpack-${i}`,
      filename: `shaderpack-${i + 1}.zip`,
      name: `Shader Pack ${i + 1}`,
      enabled: true
    }));
  },
  importResourcePack: (instanceId: string, fileInfo: { name: string, content: string }) => {
    // Mock implementation - in real app this would save to instance resourcepacks folder
    console.log(`Importing resource pack ${fileInfo.name} to instance ${instanceId}`);
    return {
      message: "Resource pack imported successfully",
      filename: fileInfo.name,
      path: `/instances/${instanceId}/resourcepacks/${fileInfo.name}`
    };
  },
  importShaderPack: (instanceId: string, fileInfo: { name: string, content: string }) => {
    // Mock implementation - in real app this would save to instance shaderpacks folder
    console.log(`Importing shader pack ${fileInfo.name} to instance ${instanceId}`);
    return {
      message: "Shader pack imported successfully",
      filename: fileInfo.name,
      path: `/instances/${instanceId}/shaderpacks/${fileInfo.name}`
    };
  },
  removeResourcePack: (instanceId: string, filename: string) => {
    // Mock implementation - in real app this would delete the file
    console.log(`Removing resource pack ${filename} from instance ${instanceId}`);
    return { message: "Resource pack removed successfully" };
  },
  removeShaderPack: (instanceId: string, filename: string) => {
    // Mock implementation - in real app this would delete the file
    console.log(`Removing shader pack ${filename} from instance ${instanceId}`);
    return { message: "Shader pack removed successfully" };
  },
  toggleResourcePack: (instanceId: string, filename: string, enabled: boolean) => {
    // Mock implementation - in real app this would rename the file
    console.log(`Toggling resource pack ${filename} to ${enabled} for instance ${instanceId}`);
    return { message: `Resource pack ${enabled ? 'enabled' : 'disabled'} successfully` };
  },
  toggleShaderPack: (instanceId: string, filename: string, enabled: boolean) => {
    // Mock implementation - in real app this would rename the file
    console.log(`Toggling shader pack ${filename} to ${enabled} for instance ${instanceId}`);
    return { message: `Shader pack ${enabled ? 'enabled' : 'disabled'} successfully` };
  },
  syncMods: (instanceId: string) => {
    // Mock implementation - in real app this would sync mods with actual files
    return {
      id: instanceId,
      name: 'Synced Instance',
      mods: Array.from({ length: 29 }, (_, i) => ({
        id: `synced-mod-${i}`,
        name: `Synced Mod ${i + 1}`,
        filename: `synced-mod-${i + 1}.jar`,
        version: '1.0.0',
        enabled: true
      }))
    };
  },
  exportModpack: (instanceId: string) => {
    // Mock implementation - in real app this would create .mrpack file
    const mockModpackName = `Exported_Instance_${instanceId.slice(0, 8)}.mrpack`;
    return {
      modpackPath: `/mock/path/to/${mockModpackName}`,
      modpackName: mockModpackName
    };
  },
  searchModpacks: (query: string) => ({
    hits: query ? [
      {
        project_id: 'R8yw6Teo',
        slug: 'fabulously-optimized',
        title: 'Fabulously Optimized',
        description: 'A simple and optimized modpack focused on performance and graphics.',
        downloads: 5000000,
        follows: 25000,
        categories: ['optimization', 'utility'],
        icon_url: 'https://cdn.modrinth.com/data/R8yw6Teo/1b6b4d2b2c5b4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0.png'
      },
      {
        project_id: 'gqPjNrf7',
        slug: 'skyblock',
        title: 'Skyblock Modpack',
        description: 'A complete skyblock experience with all the essential mods.',
        downloads: 1200000,
        follows: 8000,
        categories: ['adventure', 'skyblock'],
        icon_url: 'https://cdn.modrinth.com/data/gqPjNrf7/9c8d7e6f5a4b3c2d1e0f9e8d7c6b5a4b3c2d1e0f.png'
      }
    ] : [], total_hits: query ? 2 : 0,
  }),
  getModpackVersions: (projectId: string) => [
    {
      id: 'mock-version-1',
      name: 'Latest',
      version_number: '1.0.0',
      game_versions: ['1.20.1'],
      loaders: ['fabric'],
      files: [
        {
          id: 'mock-file-1',
          url: 'https://cdn.modrinth.com/mock/modpack.mrpack',
          filename: 'modpack.mrpack',
          primary: true,
          size: 5000000
        }
      ]
    }
  ],
  getModpackVersionDetails: (versionId: string) => ({
    id: versionId,
    name: 'Latest',
    version_number: '1.0.0',
    game_versions: ['1.20.1'],
    loaders: ['fabric'],
    files: [
      {
        id: 'mock-file-1',
        url: 'https://cdn.modrinth.com/mock/modpack.mrpack',
        filename: 'modpack.mrpack',
        primary: true,
        size: 5000000,
        hashes: {
          sha1: 'mocksha1hash',
          sha512: 'mocksha512hash'
        }
      }
    ]
  }),
  getLogs: () => [], clearLogs: () => {}, getLogsAsText: () => "No logs available.",
  openLogWindow: () => ({ opened: true }),
  getSystemInfo: () => ({ os: 'darwin', arch: 'arm64', platform: 'Darwin' }),
  openFolder: () => {}, getInstanceDir: () => '/mock/path/to/instance',
  importModpack: (fileInfo: { name: string; content: string }) => {
    // Mock implementation - in real app this would parse the mrpack file
    const mockInstance = {
      id: Math.random().toString(36).slice(2),
      name: `Imported Modpack (${fileInfo.name})`,
      minecraftVersion: '1.20.1',
      modLoader: 'fabric',
      modLoaderVersion: '0.15.11',
      createdAt: new Date().toISOString(),
      isRunning: false,
      mods: [],
      ram: 2048,
      description: 'Imported from modpack'
    };
    mockInstances.push(mockInstance);
    return mockInstance;
  },
};
