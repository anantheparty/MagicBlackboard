import { describe, expect, it, vi } from 'vitest';
import { MagicFeatureRegistry } from './feature-registry';
import { MemoryMagicSettingsStore, type MagicSettingsStore } from './settings';

type FeatureId = 'magic.actor' | 'magic.ink-diagnostics';

describe('MagicFeatureRegistry', () => {
  it('hydrates and persists feature toggles', async () => {
    const settings = new MemoryMagicSettingsStore({
      'features.magic.actor.enabled': true,
    });
    const registry = new MagicFeatureRegistry<FeatureId>(settings);
    const listener = vi.fn();
    registry.subscribe(listener);

    const actor = await registry.register({
      id: 'magic.actor',
      title: 'Actor',
      defaultEnabled: false,
    });
    await registry.register({
      id: 'magic.ink-diagnostics',
      defaultEnabled: false,
    });
    const changed = await registry.toggle('magic.ink-diagnostics');

    expect(actor.enabled).toBe(true);
    expect(changed.enabled).toBe(true);
    expect(registry.isEnabled('magic.actor')).toBe(true);
    expect(await settings.get('features.magic.ink-diagnostics.enabled')).toBe(true);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'changed', previousEnabled: false })
    );
  });

  it('rejects duplicate and unknown features', async () => {
    const registry = new MagicFeatureRegistry<FeatureId>(new MemoryMagicSettingsStore());
    const definition = { id: 'magic.actor' as const, defaultEnabled: false };
    await registry.register(definition);

    await expect(registry.register(definition)).rejects.toThrow('already registered');
    await expect(registry.setEnabled('magic.ink-diagnostics', true)).rejects.toThrow(
      'Unknown feature'
    );
  });

  it('fails closed while a feature is unavailable', async () => {
    const settings = new MemoryMagicSettingsStore({
      'features.magic.actor.enabled': true,
    });
    const registry = new MagicFeatureRegistry<FeatureId>(settings);
    const actor = await registry.register({
      id: 'magic.actor',
      defaultEnabled: true,
      available: false,
    });

    expect(actor).toMatchObject({ available: false, enabled: false });
    expect(await settings.get('features.magic.actor.enabled')).toBe(false);
    await expect(registry.setEnabled('magic.actor', true)).rejects.toThrow('unavailable');

    const available = await registry.setAvailable('magic.actor', true);
    expect(available).toMatchObject({ available: true, enabled: false });
    expect((await registry.setEnabled('magic.actor', true)).enabled).toBe(true);

    const unavailable = await registry.setAvailable('magic.actor', false);
    expect(unavailable).toMatchObject({ available: false, enabled: false });
    expect(await settings.get('features.magic.actor.enabled')).toBe(false);
  });

  it('does not overwrite a malformed persisted value and locks the feature off', async () => {
    const key = 'features.magic.actor.enabled';
    const settings = new MemoryMagicSettingsStore({ [key]: 'not-a-boolean' });
    const set = vi.spyOn(settings, 'set');
    const registry = new MagicFeatureRegistry<FeatureId>(settings);

    const actor = await registry.register({
      id: 'magic.actor',
      defaultEnabled: true,
    });

    expect(actor).toMatchObject({
      enabled: false,
      available: false,
      settingsStatus: 'invalid',
    });
    expect(registry.list()).toEqual([actor]);
    expect(set).not.toHaveBeenCalled();
    expect(await settings.get(key)).toBe('not-a-boolean');
    await expect(registry.setEnabled('magic.actor', true)).rejects.toThrow(
      'settings are unavailable'
    );
    expect(set).not.toHaveBeenCalled();
  });

  it('registers a fail-closed state when persisted settings cannot be read', async () => {
    const recoverableValue = Symbol('recoverable-feature-setting');
    let storedValue: unknown = recoverableValue;
    const settings: MagicSettingsStore = {
      async get<Value>(): Promise<Value | undefined> {
        throw new Error('synthetic read failure');
      },
      async set<Value>(_key: string, value: Value): Promise<void> {
        storedValue = value;
      },
      async remove(): Promise<void> {
        return undefined;
      },
      async clear(): Promise<void> {
        return undefined;
      },
    };
    const set = vi.spyOn(settings, 'set');
    const registry = new MagicFeatureRegistry<FeatureId>(settings);

    const actor = await registry.register({
      id: 'magic.actor',
      defaultEnabled: true,
    });

    expect(actor).toMatchObject({
      enabled: false,
      available: false,
      settingsStatus: 'read-error',
    });
    expect(registry.get('magic.actor')).toBe(actor);
    expect(set).not.toHaveBeenCalled();
    expect(storedValue).toBe(recoverableValue);
  });

  it('registers a fail-closed state when persisting a missing default fails', async () => {
    const settings: MagicSettingsStore = {
      async get<Value>(): Promise<Value | undefined> {
        return undefined;
      },
      async set(): Promise<void> {
        throw new Error('synthetic write failure');
      },
      async remove(): Promise<void> {
        return undefined;
      },
      async clear(): Promise<void> {
        return undefined;
      },
    };
    const registry = new MagicFeatureRegistry<FeatureId>(settings);

    await expect(
      registry.register({ id: 'magic.actor', defaultEnabled: true })
    ).resolves.toMatchObject({
      enabled: false,
      available: false,
      settingsStatus: 'write-error',
    });
    expect(registry.list()).toHaveLength(1);
  });
});
