import { create } from 'zustand';
import { api, waitForPywebview } from '../api/bridge';

export type Page = 'home' | 'instances' | 'instance-detail' | 'mods' | 'modpacks' | 'resourcepacks' | 'shaderpacks' | 'settings';
export type Theme = 'system' | 'dark' | 'light';
export type AccountType = 'online' | 'offline';

export interface User {
  id: string; username: string; uuid: string;
  accessToken: string; refreshToken: string; isActive: boolean;
  accountType: AccountType;
}
export interface LogLine {
  timestamp: string; level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'; message: string;
}
export interface InstalledMod {
  id: string; name: string; slug: string; version: string;
  versionId: string; filename: string; enabled: boolean; iconUrl?: string;
}
export interface Instance {
  id: string; name: string; minecraftVersion: string; modLoader: string;
  modLoaderVersion?: string; lwjglOverride?: string; javaPath?: string;
  jvmArgs: string; ram: number; mods: InstalledMod[];
  createdAt: string; lastPlayed?: string; isRunning: boolean;
  processPid?: number; icon?: string; description?: string;
}

interface AppStore {
  page: Page;
  selectedInstanceId?: string;
  currentInstanceId: string | null;
  users: User[];
  activeUserId?: string;
  instances: Instance[];
  versions: any[];
  logs: Record<string, LogLine[]>;
  isLoading: boolean;
  isInitialized: boolean;
  showOnboarding: boolean;
  systemInfo: { os: string; arch: string; platform: string } | null;
  theme: Theme;
  windowFocused: boolean;
  initError: string | null;

  navigate: (page: Page, instanceId?: string) => void;
  addUser: (user: User) => void;
  removeUser: (id: string) => void;
  setActiveUser: (id: string) => void;
  setInstances: (instances: Instance[]) => void;
  addInstance: (instance: Instance) => void;
  updateInstance: (id: string, data: Partial<Instance>) => void;
  removeInstance: (id: string) => void;
  setInstanceRunning: (id: string, running: boolean, pid?: number) => void;
  setVersions: (versions: any[]) => void;
  addLog: (instanceId: string, line: LogLine) => void;
  clearLogs: (instanceId: string) => void;
  setLoading: (v: boolean) => void;
  setShowOnboarding: (v: boolean) => void;
  setTheme: (t: Theme) => void;
  setWindowFocused: (v: boolean) => void;
  setInitError: (error: string | null) => void;
  initialize: () => Promise<void>;
  refreshInstances: () => Promise<void>;
  setCurrentInstanceId: (id: string | null) => void; // For pack installation
}

// Apply theme class to document root
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove('theme-light', 'theme-dark');
  if (theme === 'light') {
    root.classList.add('theme-light');
  } else if (theme === 'dark') {
    // dark is default :root, no class needed
  } else {
    // system
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (!prefersDark) root.classList.add('theme-light');
  }
}

export const useStore = create<AppStore>((set, get) => ({
  page: 'home',
  selectedInstanceId: undefined,
  currentInstanceId: null,
  users: [],
  activeUserId: undefined,
  instances: [],
  versions: [],
  logs: {},
  isLoading: false,
  isInitialized: false,
  showOnboarding: false,
  systemInfo: null,
  theme: 'dark',
  windowFocused: true,
  initError: null,

  navigate: (page, instanceId) => set({ page, selectedInstanceId: instanceId }),

  addUser: (user) => {
    set((s) => {
      // Migrate existing accounts to online type if they don't have accountType
      const migratedUser = {
        ...user,
        accountType: user.accountType || 'online' as const
      };
      
      const users = [...s.users.filter(u => u.id !== user.id), migratedUser].map(u => ({
        ...u, 
        isActive: u.id === migratedUser.id,
        // Migrate all existing users to online type if they don't have accountType
        accountType: u.accountType || 'online' as const
      }));
      
      return { users, activeUserId: migratedUser.id };
    });
    api.storeUserTokens(user.id, user.accessToken, user.refreshToken, user).catch(() => {});
    // Persist to users.json
    const newUsers = [...get().users];
    api.saveUsersToDisk(newUsers, user.id).catch(() => {});
  },

  removeUser: (id) => {
    set((s) => {
      const users = s.users.filter(u => u.id !== id);
      return { users, activeUserId: s.activeUserId === id ? users[0]?.id : s.activeUserId };
    });
    api.removeUserFromDisk(id).catch(() => {});
  },

  setActiveUser: (id) => {
    const user = get().users.find(u => u.id === id);
    if (user) api.storeUserTokens(user.id, user.accessToken, user.refreshToken, user).catch(() => {});
    set((s) => ({ users: s.users.map(u => ({ ...u, isActive: u.id === id })), activeUserId: id }));
    api.setActiveUserOnDisk(id).catch(() => {});
  },

  setInstances: (instances) => set({ instances }),
  addInstance: (instance) => set((s) => ({ instances: [...s.instances, instance] })),
  updateInstance: (id, data) => set((s) => ({
    instances: s.instances.map(i => i.id === id ? { ...i, ...data } : i),
  })),
  removeInstance: (id) => set((s) => ({ instances: s.instances.filter(i => i.id !== id) })),
  setInstanceRunning: (id, running, pid) => set((s) => ({
    instances: s.instances.map(i => i.id === id ? { ...i, isRunning: running, processPid: pid } : i),
  })),
  setVersions: (versions) => set({ versions }),
  addLog: (instanceId, line) => set((s) => ({
    logs: { ...s.logs, [instanceId]: [...(s.logs[instanceId] || []).slice(-1999), line] },
  })),
  clearLogs: (instanceId) => set((s) => ({ logs: { ...s.logs, [instanceId]: [] } })),
  setLoading: (isLoading) => set({ isLoading }),
  setShowOnboarding: (showOnboarding) => set({ showOnboarding }),
  setWindowFocused: (windowFocused) => set({ windowFocused }),
  setInitError: (initError) => set({ initError }),
  setCurrentInstanceId: (currentInstanceId) => set({ currentInstanceId }),

  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    api.saveSettings({ theme }).then(() => {
      console.log('[theme] saved to settings.json:', theme);
    }).catch((e) => {
      console.error('[theme] failed to save settings:', e);
    });
    localStorage.setItem('craftlaunch_theme', theme);
  },

  refreshInstances: async () => {
    try {
      const instances = await api.getInstances();
      set({ instances });
    } catch {}
  },

  initialize: async () => {
    try {
      // Clear any previous errors
      set({ initError: null });
      
      // Wait for pywebview to be ready
      console.log('Waiting for pywebview to be ready...');
      await waitForPywebview();
      console.log('pywebview is ready!');

      // Restore theme — prefer settings.json (persisted by backend), fall back to localStorage
      let savedTheme: Theme = 'dark';
      try {
        const settings = await api.getSettings();
        if (settings?.theme) {
          savedTheme = settings.theme as Theme;
        } else {
          savedTheme = (localStorage.getItem('craftlaunch_theme') as Theme) || 'dark';
        }
      } catch {
        savedTheme = (localStorage.getItem('craftlaunch_theme') as Theme) || 'dark';
      }
      applyTheme(savedTheme);
      set({ theme: savedTheme });
      localStorage.setItem('craftlaunch_theme', savedTheme);

      // Listen for system theme changes
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (get().theme === 'system') applyTheme('system');
      });

      // Window focus tracking
      window.addEventListener('focus', () => get().setWindowFocused(true));
      window.addEventListener('blur',  () => get().setWindowFocused(false));

      // Load users from disk (users.json) — authoritative source.
      // Fall back to localStorage if disk read fails (e.g. first run).
      let users: User[] = [];
      let activeUserId: string | undefined;
      try {
        const diskData = await api.getUsersFromDisk();
        console.log('Loaded users from disk:', diskData);
        if (diskData?.users?.length > 0) {
          users = diskData.users;
          activeUserId = diskData.activeUserId || users[0]?.id;
          console.log('Using users from disk:', { usersCount: users.length, activeUserId });
        } else {
          console.log('No users found on disk, checking localStorage...');
          // Migrate from localStorage if users.json is empty
          const savedUsers = localStorage.getItem('craftlaunch_users');
          if (savedUsers) {
            users = JSON.parse(savedUsers);
            // Migrate existing users to online type if they don't have accountType
            users = users.map(user => ({
              ...user,
              accountType: user.accountType || 'online' as const
            }));
            activeUserId = localStorage.getItem('craftlaunch_active_user') || users[0]?.id;
            // Write migrated users to disk
            if (users.length > 0) {
              api.saveUsersToDisk(users, activeUserId || '').catch(() => {});
            }
          }
        }
      } catch (error) {
        console.error('Failed to load users from disk:', error);
        // Fallback to localStorage
        const savedUsers = localStorage.getItem('craftlaunch_users');
        if (savedUsers) {
          users = JSON.parse(savedUsers);
          // Migrate existing users to online type if they don't have accountType
          users = users.map(user => ({
            ...user,
            accountType: user.accountType || 'online' as const
          }));
          activeUserId = localStorage.getItem('craftlaunch_active_user') || users[0]?.id;
        }
      }
      // Migrate existing users to online type if they don't have accountType
      users = users.map(user => ({
        ...user,
        accountType: user.accountType || 'online' as const
      }));

      // Sync all user tokens to backend memory cache
      for (const u of users) {
        api.storeUserTokens(u.id, u.accessToken, u.refreshToken, u).catch(() => {});
      }

      const [instances, versions, sysInfo] = await Promise.all([
        api.getInstances(),
        api.getMinecraftVersions(),
        api.getSystemInfo(),
      ]);

      set({
        instances, versions, users, systemInfo: sysInfo,
        activeUserId: activeUserId || users[0]?.id,
        isInitialized: true,
        showOnboarding: users.length === 0,
      });

      console.log('Final initialization state:', {
        usersCount: users.length,
        activeUserId,
        showOnboarding: users.length === 0,
        isInitialized: true
      });

      (window as any).__craftlaunch_log = (instanceId: string, entry: LogLine) => {
        get().addLog(instanceId, entry);
      };
      (window as any).__craftlaunch_state_changed = () => {
        get().refreshInstances();
      };
    } catch (e) {
      console.error('Init failed', e);
      const errorMessage = e instanceof Error ? e.message : 'Unknown initialization error';
      set({ isInitialized: true, showOnboarding: true, initError: errorMessage });
    }
  },
}));

let _lastUsersSig = '';
useStore.subscribe((state) => {
  if (state.isInitialized) {
    // Always keep localStorage in sync (for fast startup)
    localStorage.setItem('craftlaunch_users', JSON.stringify(state.users));
    if (state.activeUserId) localStorage.setItem('craftlaunch_active_user', state.activeUserId);
    // Debounce disk writes — only write when users actually changed
    const sig = JSON.stringify(state.users) + (state.activeUserId || '');
    if (sig !== _lastUsersSig) {
      _lastUsersSig = sig;
      // Disk save is handled by individual actions; subscriber is a safety net
    }
  }
});
