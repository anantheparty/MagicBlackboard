import type { MagicDisposable } from './disposable';

/** Async by design so IndexedDB/localForage and deterministic test stores fit. */
export interface MagicSettingsStore {
  get<Value>(key: string): Promise<Value | undefined>;
  set<Value>(key: string, value: Value): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  dispose?(): void;
}

export class MemoryMagicSettingsStore implements MagicSettingsStore, MagicDisposable {
  readonly #values = new Map<string, unknown>();
  #disposed = false;

  constructor(initialValues?: Readonly<Record<string, unknown>>) {
    for (const [key, value] of Object.entries(initialValues ?? {})) {
      this.#values.set(key, value);
    }
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  async get<Value>(key: string): Promise<Value | undefined> {
    this.#assertActive();
    return this.#values.get(key) as Value | undefined;
  }

  async set<Value>(key: string, value: Value): Promise<void> {
    this.#assertActive();
    this.#values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.#assertActive();
    this.#values.delete(key);
  }

  async clear(): Promise<void> {
    this.#assertActive();
    this.#values.clear();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#values.clear();
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error('Settings store has been disposed.');
    }
  }
}
