import type { MagicDisposable, MagicDisposer } from './disposable';
import type { MagicSettingsStore } from './settings';

export interface MagicFeatureDefinition<Id extends string = string> {
  readonly id: Id;
  readonly title?: string;
  readonly description?: string;
  readonly defaultEnabled: boolean;
  /** Defaults to true. Unavailable features always fail closed. */
  readonly available?: boolean;
}

export interface MagicFeatureState<Id extends string = string> extends MagicFeatureDefinition<Id> {
  readonly enabled: boolean;
  readonly available: boolean;
  /** Storage failures lock the feature off without replacing recoverable settings. */
  readonly settingsStatus: MagicFeatureSettingsStatus;
}

export type MagicFeatureSettingsStatus = 'ready' | 'invalid' | 'read-error' | 'write-error';

export type MagicFeatureChangeReason = 'registered' | 'changed' | 'availability-changed';

export interface MagicFeatureChange<Id extends string = string> {
  readonly reason: MagicFeatureChangeReason;
  readonly feature: MagicFeatureState<Id>;
  readonly previousEnabled?: boolean;
}

export interface MagicFeatureRegistryOptions {
  readonly settingsKeyPrefix?: string;
}

export type MagicFeatureListener<Id extends string = string> = (
  change: MagicFeatureChange<Id>
) => void;

/** Feature flags backed by the supplied settings store. */
export class MagicFeatureRegistry<Id extends string = string> implements MagicDisposable {
  readonly #settings: MagicSettingsStore;
  readonly #settingsKeyPrefix: string;
  readonly #features = new Map<Id, MagicFeatureState<Id>>();
  readonly #registering = new Set<Id>();
  readonly #listeners = new Set<MagicFeatureListener<Id>>();
  #disposed = false;

  constructor(settings: MagicSettingsStore, options: MagicFeatureRegistryOptions = {}) {
    this.#settings = settings;
    this.#settingsKeyPrefix = options.settingsKeyPrefix ?? 'features';
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  async register(definition: MagicFeatureDefinition<Id>): Promise<MagicFeatureState<Id>> {
    this.#assertActive();
    if (!definition.id.trim()) {
      throw new Error('Feature id must not be empty.');
    }
    if (this.#features.has(definition.id) || this.#registering.has(definition.id)) {
      throw new Error(`Feature "${definition.id}" is already registered.`);
    }

    this.#registering.add(definition.id);
    try {
      let persisted: unknown;
      try {
        persisted = await this.#settings.get<unknown>(this.#settingsKey(definition.id));
      } catch {
        this.#assertActive();
        return this.#registerFailClosed(definition, 'read-error');
      }
      this.#assertActive();

      if (persisted !== undefined && typeof persisted !== 'boolean') {
        return this.#registerFailClosed(definition, 'invalid');
      }

      const available = definition.available ?? true;
      const enabled = available ? (persisted ?? definition.defaultEnabled) : false;
      if (persisted !== enabled) {
        try {
          await this.#settings.set(this.#settingsKey(definition.id), enabled);
        } catch {
          this.#assertActive();
          return this.#registerFailClosed(definition, 'write-error');
        }
        this.#assertActive();
      }

      return this.#registerState(definition, enabled, available, 'ready');
    } finally {
      this.#registering.delete(definition.id);
    }
  }

  async registerMany(
    definitions: readonly MagicFeatureDefinition<Id>[]
  ): Promise<readonly MagicFeatureState<Id>[]> {
    return Promise.all(definitions.map((definition) => this.register(definition)));
  }

  get(id: Id): MagicFeatureState<Id> | undefined {
    return this.#features.get(id);
  }

  list(): readonly MagicFeatureState<Id>[] {
    return [...this.#features.values()];
  }

  isEnabled(id: Id): boolean {
    return this.#features.get(id)?.enabled ?? false;
  }

  async setEnabled(id: Id, enabled: boolean): Promise<MagicFeatureState<Id>> {
    this.#assertActive();
    const previous = this.#features.get(id);
    if (!previous) {
      throw new Error(`Unknown feature "${id}".`);
    }
    if (previous.settingsStatus !== 'ready') {
      throw new Error(`Feature "${id}" settings are unavailable (${previous.settingsStatus}).`);
    }
    if (enabled && !previous.available) {
      throw new Error(`Feature "${id}" is unavailable.`);
    }
    if (previous.enabled === enabled) {
      return previous;
    }

    try {
      await this.#settings.set(this.#settingsKey(id), enabled);
    } catch {
      this.#assertActive();
      return this.#lockAfterWriteFailure(previous, 'changed');
    }
    this.#assertActive();

    const feature = Object.freeze({ ...previous, enabled });
    this.#features.set(id, feature);
    this.#notify({ reason: 'changed', feature, previousEnabled: previous.enabled });
    return feature;
  }

  toggle(id: Id): Promise<MagicFeatureState<Id>> {
    const feature = this.#features.get(id);
    if (!feature) {
      return Promise.reject(new Error(`Unknown feature "${id}".`));
    }
    return this.setEnabled(id, !feature.enabled);
  }

  async setAvailable(id: Id, available: boolean): Promise<MagicFeatureState<Id>> {
    this.#assertActive();
    const previous = this.#features.get(id);
    if (!previous) {
      throw new Error(`Unknown feature "${id}".`);
    }
    if (previous.settingsStatus !== 'ready') {
      throw new Error(`Feature "${id}" settings are unavailable (${previous.settingsStatus}).`);
    }
    if (previous.available === available) {
      return previous;
    }

    const enabled = available ? previous.enabled : false;
    if (enabled !== previous.enabled) {
      try {
        await this.#settings.set(this.#settingsKey(id), enabled);
      } catch {
        this.#assertActive();
        return this.#lockAfterWriteFailure(previous, 'availability-changed');
      }
      this.#assertActive();
    }

    const feature = Object.freeze({ ...previous, available, enabled });
    this.#features.set(id, feature);
    this.#notify({
      reason: 'availability-changed',
      feature,
      previousEnabled: previous.enabled,
    });
    return feature;
  }

  subscribe(listener: MagicFeatureListener<Id>): MagicDisposer {
    if (this.#disposed) {
      return () => undefined;
    }

    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      this.#listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#listeners.clear();
    this.#features.clear();
    this.#registering.clear();
  }

  #settingsKey(id: Id): string {
    return `${this.#settingsKeyPrefix}.${id}.enabled`;
  }

  #state(
    definition: MagicFeatureDefinition<Id>,
    enabled: boolean,
    available = definition.available ?? true,
    settingsStatus: MagicFeatureSettingsStatus = 'ready'
  ): MagicFeatureState<Id> {
    return Object.freeze({
      ...definition,
      available,
      enabled: available && enabled,
      settingsStatus,
    });
  }

  #registerFailClosed(
    definition: MagicFeatureDefinition<Id>,
    settingsStatus: Exclude<MagicFeatureSettingsStatus, 'ready'>
  ): MagicFeatureState<Id> {
    return this.#registerState(definition, false, false, settingsStatus);
  }

  #registerState(
    definition: MagicFeatureDefinition<Id>,
    enabled: boolean,
    available: boolean,
    settingsStatus: MagicFeatureSettingsStatus
  ): MagicFeatureState<Id> {
    const feature = this.#state(definition, enabled, available, settingsStatus);
    this.#features.set(definition.id, feature);
    this.#notify({ reason: 'registered', feature });
    return feature;
  }

  #lockAfterWriteFailure(
    previous: MagicFeatureState<Id>,
    reason: Extract<MagicFeatureChangeReason, 'changed' | 'availability-changed'>
  ): MagicFeatureState<Id> {
    const feature = Object.freeze({
      ...previous,
      enabled: false,
      available: false,
      settingsStatus: 'write-error' as const,
    });
    this.#features.set(previous.id, feature);
    this.#notify({ reason, feature, previousEnabled: previous.enabled });
    return feature;
  }

  #notify(change: MagicFeatureChange<Id>): void {
    for (const listener of Array.from(this.#listeners)) {
      listener(change);
    }
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error('Feature registry has been disposed.');
    }
  }
}
