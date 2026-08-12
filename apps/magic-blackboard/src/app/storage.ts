import type { MagicSettingsStore } from '@magic-blackboard/core';
import localforage from 'localforage';

export const STORAGE_NAMESPACES = {
  board: 'magic_blackboard.board.v1',
  preferences: 'magic_blackboard.preferences.v1',
  features: 'magic_blackboard.features.v1',
  console: 'magic_blackboard.console.v1',
} as const;

type LocalForageInstance = ReturnType<typeof localforage.createInstance>;

export type MagicStores = {
  board: LocalForageInstance;
  preferences: LocalForageInstance;
  features: LocalForageInstance;
  console: LocalForageInstance;
};

const createStore = (name: string): LocalForageInstance =>
  localforage.createInstance({
    name,
    storeName: 'state',
    driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
  });

export const createMagicStores = (): MagicStores => ({
  board: createStore(STORAGE_NAMESPACES.board),
  preferences: createStore(STORAGE_NAMESPACES.preferences),
  features: createStore(STORAGE_NAMESPACES.features),
  console: createStore(STORAGE_NAMESPACES.console),
});

export class LocalForageSettingsStore implements MagicSettingsStore {
  constructor(private readonly store: LocalForageInstance) {}

  async get<T>(key: string): Promise<T | undefined> {
    return (await this.store.getItem<T>(key)) ?? undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.store.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    await this.store.removeItem(key);
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }
}
