type Listener = (event: { id: string; op: 'set' | 'remove' | 'clearAll'; key?: string }) => void;

const stores = new Map<string, Map<string, string | number | boolean>>();
const listeners = new Set<Listener>();

export interface MMKV {
  getString(key: string): string | undefined;
  set(key: string, value: string | number | boolean): void;
  remove(key: string): boolean;
  clearAll(): void;
  contains(key: string): boolean;
}

function getStore(id: string): Map<string, string | number | boolean> {
  let store = stores.get(id);
  if (!store) {
    store = new Map();
    stores.set(id, store);
  }
  return store;
}

export function createMMKV(config: { id: string }): MMKV {
  const { id } = config;
  return {
    getString(key) {
      const value = getStore(id).get(key);
      return typeof value === 'string' ? value : undefined;
    },
    set(key, value) {
      getStore(id).set(key, value);
      listeners.forEach((listener) => listener({ id, op: 'set', key }));
    },
    remove(key) {
      const existed = getStore(id).delete(key);
      listeners.forEach((listener) => listener({ id, op: 'remove', key }));
      return existed;
    },
    clearAll() {
      getStore(id).clear();
      listeners.forEach((listener) => listener({ id, op: 'clearAll' }));
    },
    contains(key) {
      return getStore(id).has(key);
    },
  };
}

/** Test helpers. */
export function __resetMMKV(): void {
  stores.clear();
  listeners.clear();
}

export function __onMMKVChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function __getMMKVValue(id: string, key: string): string | number | boolean | undefined {
  return stores.get(id)?.get(key);
}
