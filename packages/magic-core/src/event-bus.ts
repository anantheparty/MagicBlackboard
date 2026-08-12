import type { MagicDisposable, MagicDisposer } from './disposable';
import { BoundedRingBuffer } from './ring-buffer';

export type MagicEventKey<Events extends object> = Extract<keyof Events, string>;

export interface MagicEvent<Type extends string = string, Payload = unknown> {
  readonly sequence: number;
  readonly type: Type;
  readonly payload: Payload;
  readonly timestamp: number;
}

export interface MagicEventHistoryEntry<Type extends string = string> {
  readonly sequence: number;
  readonly type: Type;
  readonly timestamp: number;
  /** Omitted for high-volume or large payloads that should not be retained. */
  readonly payload?: unknown;
}

export interface MagicEventEmitOptions {
  /** Defaults to true. Listeners always receive the payload. */
  readonly retainPayload?: boolean;
}

export class MagicEventDispatchError extends Error {
  readonly event: MagicEvent;
  readonly causes: readonly unknown[];

  constructor(event: MagicEvent, causes: readonly unknown[]) {
    super(`${causes.length} listener${causes.length === 1 ? '' : 's'} failed for "${event.type}".`);
    this.name = 'MagicEventDispatchError';
    this.event = event;
    this.causes = causes;
  }
}

export type MagicEventFor<Events extends object> = {
  [Type in MagicEventKey<Events>]: MagicEvent<Type, Events[Type]>;
}[MagicEventKey<Events>];

export type MagicEventListener<Event> = (event: Event) => void;

export interface MagicEventBusOptions {
  /** Maximum number of emitted events retained in memory. */
  readonly historyCapacity?: number;
  /** Injectable clock for deterministic rules and tests. */
  readonly now?: () => number;
}

/**
 * A synchronous, strongly typed event bus with bounded in-memory history.
 * Event payloads are retained by reference; producers should treat them as
 * immutable values.
 */
export class MagicEventBus<Events extends object> implements MagicDisposable {
  readonly #history: BoundedRingBuffer<MagicEventHistoryEntry<MagicEventKey<Events>>>;
  readonly #listeners = new Map<
    MagicEventKey<Events>,
    Set<MagicEventListener<MagicEventFor<Events>>>
  >();
  readonly #allListeners = new Set<MagicEventListener<MagicEventFor<Events>>>();
  readonly #now: () => number;

  #disposed = false;
  #sequence = 0;

  constructor(options: MagicEventBusOptions = {}) {
    this.#history = new BoundedRingBuffer(options.historyCapacity ?? 200);
    this.#now = options.now ?? Date.now;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get historyCapacity(): number {
    return this.#history.capacity;
  }

  emit<Type extends MagicEventKey<Events>>(
    type: Type,
    payload: Events[Type],
    options: MagicEventEmitOptions = {}
  ): void {
    if (this.#disposed) {
      return;
    }

    this.#sequence += 1;
    const event = Object.freeze({
      sequence: this.#sequence,
      type,
      payload,
      timestamp: this.#now(),
    }) as MagicEvent<Type, Events[Type]>;
    const genericEvent = event as MagicEventFor<Events>;

    this.#history.push(
      Object.freeze({
        sequence: event.sequence,
        type: event.type,
        timestamp: event.timestamp,
        ...(options.retainPayload === false ? {} : { payload: event.payload }),
      })
    );

    const errors: unknown[] = [];

    const listeners = this.#listeners.get(type);
    if (listeners) {
      for (const listener of Array.from(listeners)) {
        try {
          listener(genericEvent);
        } catch (error) {
          errors.push(error);
        }
      }
    }

    for (const listener of Array.from(this.#allListeners)) {
      try {
        listener(genericEvent);
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw new MagicEventDispatchError(event, errors);
    }
  }

  subscribe<Type extends MagicEventKey<Events>>(
    type: Type,
    listener: MagicEventListener<MagicEvent<Type, Events[Type]>>
  ): MagicDisposer {
    if (this.#disposed) {
      return () => undefined;
    }

    const genericListener = listener as MagicEventListener<MagicEventFor<Events>>;
    let listeners = this.#listeners.get(type);
    if (!listeners) {
      listeners = new Set<MagicEventListener<MagicEventFor<Events>>>();
      this.#listeners.set(type, listeners);
    }
    listeners.add(genericListener);

    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      listeners?.delete(genericListener);
      if (listeners?.size === 0) {
        this.#listeners.delete(type);
      }
    };
  }

  subscribeAll(listener: MagicEventListener<MagicEventFor<Events>>): MagicDisposer {
    if (this.#disposed) {
      return () => undefined;
    }

    this.#allListeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      this.#allListeners.delete(listener);
    };
  }

  getHistory(): readonly MagicEventHistoryEntry<MagicEventKey<Events>>[] {
    return this.#history.toArray();
  }

  clearHistory(): void {
    this.#history.clear();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#listeners.clear();
    this.#allListeners.clear();
    this.#history.clear();
  }
}
