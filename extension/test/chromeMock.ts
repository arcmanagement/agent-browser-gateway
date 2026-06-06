import { vi } from "vitest";

type EventListener<TArgs extends unknown[]> = (...args: TArgs) => unknown;

export type ChromeMockEvent<TArgs extends unknown[] = unknown[]> = ReturnType<
  typeof createChromeEvent<TArgs>
>;

export function createChromeEvent<TArgs extends unknown[] = unknown[]>() {
  const listeners = new Set<EventListener<TArgs>>();

  return {
    addListener: vi.fn((listener: EventListener<TArgs>) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((listener: EventListener<TArgs>) => {
      listeners.delete(listener);
    }),
    hasListener: vi.fn((listener: EventListener<TArgs>) => listeners.has(listener)),
    hasListeners: vi.fn(() => listeners.size > 0),
    dispatch: async (...args: TArgs) => {
      const results: unknown[] = [];
      for (const listener of listeners) {
        results.push(await listener(...args));
      }
      return results;
    },
    clear: () => {
      listeners.clear();
    },
    listeners,
  };
}

type StorageKeys = string | string[] | Record<string, unknown> | null | undefined;

function readStorageValues(
  values: Map<string, unknown>,
  keys: StorageKeys,
): Record<string, unknown> {
  if (keys == null) return Object.fromEntries(values);
  if (typeof keys === "string") {
    return values.has(keys) ? { [keys]: values.get(keys) } : {};
  }
  if (Array.isArray(keys)) {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (values.has(key)) result[key] = values.get(key);
    }
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [key, fallback] of Object.entries(keys)) {
    result[key] = values.has(key) ? values.get(key) : fallback;
  }
  return result;
}

function removeStorageValues(values: Map<string, unknown>, keys: string | string[]): void {
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const key of keyList) values.delete(key);
}

export function createChromeStorageArea(initialValues: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initialValues));

  return {
    values,
    get: vi.fn(async (keys?: StorageKeys) => readStorageValues(values, keys)),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      removeStorageValues(values, keys);
    }),
    clear: vi.fn(async () => {
      values.clear();
    }),
  };
}

type MockTab = {
  id: number;
  active: boolean;
  currentWindow: boolean;
  incognito: boolean;
  title?: string;
  url?: string;
  windowId?: number;
};

type TabQuery = Partial<Pick<MockTab, "active" | "currentWindow" | "incognito" | "windowId">>;

type CreateTabProperties = {
  active?: boolean;
  url?: string;
  windowId?: number;
};

type UpdateTabProperties = {
  active?: boolean;
  url?: string;
};

function cloneTab(tab: MockTab): MockTab {
  return { ...tab };
}

function createChromeTabs(initialTabs: MockTab[] = []) {
  const tabs = new Map(initialTabs.map((tab) => [tab.id, cloneTab(tab)]));
  let nextTabId = Math.max(0, ...initialTabs.map((tab) => tab.id)) + 1;
  const onCreated = createChromeEvent<[MockTab]>();
  const onUpdated = createChromeEvent<[number, Record<string, unknown>, MockTab]>();
  const onRemoved = createChromeEvent<[number, Record<string, unknown>]>();

  return {
    tabs,
    onCreated,
    onUpdated,
    onRemoved,
    query: vi.fn(async (queryInfo: TabQuery = {}) =>
      Array.from(tabs.values())
        .filter((tab) =>
          Object.entries(queryInfo).every(([key, value]) => tab[key as keyof TabQuery] === value),
        )
        .map(cloneTab),
    ),
    get: vi.fn(async (tabId: number) => {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error(`No tab with id ${tabId}`);
      return cloneTab(tab);
    }),
    create: vi.fn(async (properties: CreateTabProperties = {}) => {
      const tab: MockTab = {
        id: nextTabId,
        active: properties.active ?? true,
        currentWindow: true,
        incognito: false,
        title: properties.url,
        url: properties.url,
        windowId: properties.windowId ?? 1,
      };
      nextTabId += 1;
      tabs.set(tab.id, tab);
      await onCreated.dispatch(cloneTab(tab));
      return cloneTab(tab);
    }),
    update: vi.fn(async (tabId: number, properties: UpdateTabProperties = {}) => {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error(`No tab with id ${tabId}`);
      Object.assign(tab, properties);
      await onUpdated.dispatch(tabId, properties, cloneTab(tab));
      return cloneTab(tab);
    }),
    remove: vi.fn(async (tabId: number | number[]) => {
      const tabIds = Array.isArray(tabId) ? tabId : [tabId];
      for (const id of tabIds) {
        tabs.delete(id);
        await onRemoved.dispatch(id, {});
      }
    }),
    sendMessage: vi.fn(async () => undefined),
  };
}

function createChromePermissions() {
  const origins = new Set<string>();
  const permissions = new Set<string>();

  function remember(permissionRequest: { origins?: string[]; permissions?: string[] }) {
    for (const origin of permissionRequest.origins ?? []) origins.add(origin);
    for (const permission of permissionRequest.permissions ?? []) permissions.add(permission);
  }

  function contains(permissionRequest: { origins?: string[]; permissions?: string[] }) {
    return (
      (permissionRequest.origins ?? []).every((origin) => origins.has(origin)) &&
      (permissionRequest.permissions ?? []).every((permission) => permissions.has(permission))
    );
  }

  return {
    origins,
    permissions,
    request: vi.fn(async (permissionRequest: { origins?: string[]; permissions?: string[] }) => {
      remember(permissionRequest);
      return true;
    }),
    remove: vi.fn(async (permissionRequest: { origins?: string[]; permissions?: string[] }) => {
      for (const origin of permissionRequest.origins ?? []) origins.delete(origin);
      for (const permission of permissionRequest.permissions ?? []) permissions.delete(permission);
      return true;
    }),
    contains: vi.fn(async (permissionRequest: { origins?: string[]; permissions?: string[] }) =>
      contains(permissionRequest),
    ),
  };
}

export function createChromeMock() {
  const extensionId = "test-extension-id";

  return {
    runtime: {
      id: extensionId,
      getURL: vi.fn(
        (path: string) => `chrome-extension://${extensionId}/${path.replace(/^\//, "")}`,
      ),
      sendMessage: vi.fn(async () => undefined),
      onInstalled: createChromeEvent<[Record<string, unknown>]>(),
      onMessage: createChromeEvent<[unknown, unknown, (response?: unknown) => void]>(),
      onStartup: createChromeEvent<[]>(),
    },
    storage: {
      local: createChromeStorageArea(),
      session: createChromeStorageArea(),
    },
    tabs: createChromeTabs(),
    permissions: createChromePermissions(),
    action: {
      setBadgeBackgroundColor: vi.fn(async () => undefined),
      setBadgeText: vi.fn(async () => undefined),
      setTitle: vi.fn(async () => undefined),
    },
    alarms: {
      create: vi.fn(),
      onAlarm: createChromeEvent<[Record<string, unknown>]>(),
    },
    debugger: {
      attach: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({})),
      onDetach: createChromeEvent<[unknown, string]>(),
      onEvent: createChromeEvent<[unknown, string, Record<string, unknown> | undefined]>(),
    },
    downloads: {
      cancel: vi.fn(async () => undefined),
      download: vi.fn(async () => 1),
      erase: vi.fn(async () => []),
      onChanged: createChromeEvent<[Record<string, unknown>]>(),
      search: vi.fn(async () => []),
    },
    windows: {
      create: vi.fn(async () => ({ id: 1 })),
      remove: vi.fn(async () => undefined),
    },
  };
}

export type ChromeMock = ReturnType<typeof createChromeMock>;

export function installChromeMock(mock: ChromeMock = createChromeMock()): ChromeMock {
  vi.stubGlobal("chrome", mock);
  return mock;
}
