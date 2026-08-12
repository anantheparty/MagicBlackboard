import { describe, expect, it, vi } from 'vitest';
import { LocalForageSettingsStore, STORAGE_NAMESPACES } from './storage';

describe('Magic Blackboard storage', () => {
  it('keeps public persistence namespaces explicit and versioned', () => {
    expect(STORAGE_NAMESPACES).toEqual({
      board: 'magic_blackboard.board.v1',
      preferences: 'magic_blackboard.preferences.v1',
      features: 'magic_blackboard.features.v1',
      console: 'magic_blackboard.console.v1',
    });
  });

  it('adapts localforage to the runtime settings contract', async () => {
    const values = new Map<string, unknown>();
    const store = {
      getItem: vi.fn(async (key: string) => values.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: unknown) => {
        values.set(key, value);
        return value;
      }),
      removeItem: vi.fn(async (key: string) => {
        values.delete(key);
      }),
      clear: vi.fn(async () => {
        values.clear();
      }),
    };
    const settings = new LocalForageSettingsStore(store as never);

    await settings.set('feature', true);
    expect(await settings.get('feature')).toBe(true);
    await settings.remove('feature');
    expect(await settings.get('feature')).toBeUndefined();
    await settings.set('another', 1);
    await settings.clear();
    expect(await settings.get('another')).toBeUndefined();
  });
});
