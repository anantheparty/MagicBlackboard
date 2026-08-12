import type { MagicDisposable, MagicDisposer } from './disposable';
import { BoundedRingBuffer } from './ring-buffer';

export const DEFAULT_MAGIC_INK_DIAGNOSTICS_CAPACITY = 256;

export type MagicInkPointerType = 'mouse' | 'pen' | 'touch' | 'unknown';
export type MagicInkSampleSource = 'parent' | 'coalesced';
export type MagicInkStrategy = 'fixed-width' | 'velocity-fallback' | 'hardware-pressure';
export type MagicInkPressureCapability =
  | 'unknown'
  | 'none'
  | 'fallback-0.5-suspected'
  | 'variable-observed';
export type MagicInkVariation = 'unobserved' | 'constant' | 'varying';
export type MagicInkApiAvailability = 'unknown' | 'available' | 'unavailable';
export type MagicInkEndReason =
  | 'completed'
  | 'pointer-cancel'
  | 'lost-pointer-capture'
  | 'global-pointer-up'
  | 'two-finger-navigation'
  | 'viewport-change'
  | 'orientation-change'
  | 'detached'
  | 'disposed';

export interface MagicInkIntervalSummary {
  readonly intervalCount: number;
  readonly minimumMs: number;
  readonly maximumMs: number;
  readonly meanMs: number;
  readonly p50Ms?: number;
  readonly p95Ms?: number;
}

export interface MagicInkPressureSummary {
  readonly capability: MagicInkPressureCapability;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly distinctBucketCount: number;
}

export interface MagicInkTiltSummary {
  readonly x: MagicInkVariation;
  readonly y: MagicInkVariation;
}

export interface MagicInkAngleSummary {
  readonly altitude: MagicInkVariation;
  readonly azimuth: MagicInkVariation;
  readonly twist: MagicInkVariation;
}

export interface MagicInkContactSummary {
  readonly width: MagicInkVariation;
  readonly height: MagicInkVariation;
}

export interface MagicInkApiSummary {
  readonly coalescedEvents: MagicInkApiAvailability;
  readonly predictedEvents: MagicInkApiAvailability;
  readonly pointerRawUpdate: MagicInkApiAvailability;
}

/**
 * A compact summary of one accepted input batch. It deliberately has no
 * coordinates, pointer event, device identifier, or raw sample collection.
 * `observedAt` uses the producer's monotonic event-time clock, not wall time.
 */
export interface MagicInkDiagnosticsEntry {
  readonly observedAt: number;
  readonly pointerType: MagicInkPointerType;
  readonly isPrimary: boolean;
  readonly button: number;
  readonly buttons: number;
  readonly source: MagicInkSampleSource;
  readonly strategy: MagicInkStrategy;
  readonly receivedSamples: number;
  readonly acceptedSamples: number;
  readonly coalescedSamples: number;
  readonly droppedSamples: number;
  readonly geometryDroppedSamples?: number;
  readonly captureCapped?: boolean;
  readonly interval?: MagicInkIntervalSummary;
  readonly pressure?: MagicInkPressureSummary;
  readonly tilt?: MagicInkTiltSummary;
  readonly angles?: MagicInkAngleSummary;
  readonly contact?: MagicInkContactSummary;
  readonly apis?: MagicInkApiSummary;
  readonly endReason?: MagicInkEndReason;
}

export interface MagicInkDiagnosticsTotals {
  readonly batches: number;
  readonly receivedSamples: number;
  readonly acceptedSamples: number;
  readonly coalescedSamples: number;
  readonly droppedSamples: number;
  readonly geometryDroppedSamples: number;
}

export interface MagicInkCapabilitySummary {
  readonly pointerTypes: readonly MagicInkPointerType[];
  readonly pressure: MagicInkPressureSummary;
  readonly tilt: MagicInkTiltSummary;
  readonly angles: MagicInkAngleSummary;
  readonly contact: MagicInkContactSummary;
  readonly apis: MagicInkApiSummary;
}

export interface MagicInkStrategySummary {
  readonly current: MagicInkStrategy | 'unknown';
  readonly batches: Readonly<Record<MagicInkStrategy, number>>;
}

export interface MagicInkDiagnosticsSnapshot {
  readonly revision: number;
  readonly capacity: number;
  readonly size: number;
  readonly entries: readonly MagicInkDiagnosticsEntry[];
  readonly totals: MagicInkDiagnosticsTotals;
  readonly capability: MagicInkCapabilitySummary;
  readonly strategy: MagicInkStrategySummary;
}

export type MagicInkDiagnosticsListener = (revision: number) => void;

export interface MagicInkDiagnostics extends MagicDisposable {
  readonly capacity: number;
  getSnapshot(): MagicInkDiagnosticsSnapshot;
  subscribe(listener: MagicInkDiagnosticsListener): MagicDisposer;
  clear(): void;
}

export interface MagicInkDiagnosticsWriter {
  record(entry: MagicInkDiagnosticsEntry): void;
}

export type MagicInkDiagnosticsChannel = MagicInkDiagnostics & MagicInkDiagnosticsWriter;

export interface MagicInkDiagnosticsStoreOptions {
  readonly capacity?: number;
  /** Listener failures must never break the pointer hot path. */
  readonly onListenerError?: (error: unknown) => void;
}

const POINTER_TYPES: readonly MagicInkPointerType[] = ['mouse', 'pen', 'touch', 'unknown'];
const SAMPLE_SOURCES: readonly MagicInkSampleSource[] = ['parent', 'coalesced'];
const STRATEGIES: readonly MagicInkStrategy[] = [
  'fixed-width',
  'velocity-fallback',
  'hardware-pressure',
];
const PRESSURE_CAPABILITIES: readonly MagicInkPressureCapability[] = [
  'unknown',
  'none',
  'fallback-0.5-suspected',
  'variable-observed',
];
const VARIATIONS: readonly MagicInkVariation[] = ['unobserved', 'constant', 'varying'];
const API_AVAILABILITIES: readonly MagicInkApiAvailability[] = [
  'unknown',
  'available',
  'unavailable',
];
const END_REASONS: readonly MagicInkEndReason[] = [
  'completed',
  'pointer-cancel',
  'lost-pointer-capture',
  'global-pointer-up',
  'two-finger-navigation',
  'viewport-change',
  'orientation-change',
  'detached',
  'disposed',
];

const PRESSURE_RANK: Readonly<Record<MagicInkPressureCapability, number>> = {
  unknown: 0,
  none: 1,
  'fallback-0.5-suspected': 2,
  'variable-observed': 3,
};
const VARIATION_RANK: Readonly<Record<MagicInkVariation, number>> = {
  unobserved: 0,
  constant: 1,
  varying: 2,
};
const API_RANK: Readonly<Record<MagicInkApiAvailability, number>> = {
  unknown: 0,
  unavailable: 1,
  available: 2,
};

type MutableTotals = {
  batches: number;
  receivedSamples: number;
  acceptedSamples: number;
  coalescedSamples: number;
  droppedSamples: number;
  geometryDroppedSamples: number;
};

type MutableCapability = {
  pointerTypes: Set<MagicInkPointerType>;
  pressure: MagicInkPressureSummary;
  tilt: MagicInkTiltSummary;
  angles: MagicInkAngleSummary;
  contact: MagicInkContactSummary;
  apis: MagicInkApiSummary;
};

/** A session-only, fixed-capacity diagnostics channel. */
export class MagicInkDiagnosticsStore implements MagicInkDiagnosticsChannel {
  readonly #entries: BoundedRingBuffer<MagicInkDiagnosticsEntry>;
  readonly #listeners = new Set<MagicInkDiagnosticsListener>();
  readonly #onListenerError: (error: unknown) => void;

  #revision = 0;
  #disposed = false;
  #totals = emptyTotals();
  #capability = emptyCapability();
  #currentStrategy: MagicInkStrategy | 'unknown' = 'unknown';
  #strategyBatches = emptyStrategyBatches();

  constructor(options: MagicInkDiagnosticsStoreOptions = {}) {
    this.#entries = new BoundedRingBuffer(
      options.capacity ?? DEFAULT_MAGIC_INK_DIAGNOSTICS_CAPACITY
    );
    this.#onListenerError = options.onListenerError ?? (() => undefined);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get capacity(): number {
    return this.#entries.capacity;
  }

  record(input: MagicInkDiagnosticsEntry): void {
    if (this.#disposed) {
      return;
    }

    const entry = projectEntry(input);
    this.#entries.push(entry);
    this.#revision += 1;
    this.#totals.batches += 1;
    this.#totals.receivedSamples += entry.receivedSamples;
    this.#totals.acceptedSamples += entry.acceptedSamples;
    this.#totals.coalescedSamples += entry.coalescedSamples;
    this.#totals.droppedSamples += entry.droppedSamples;
    this.#totals.geometryDroppedSamples += entry.geometryDroppedSamples ?? 0;
    this.#currentStrategy = entry.strategy;
    this.#strategyBatches[entry.strategy] += 1;
    this.#mergeCapability(entry);
    this.#notify();
  }

  getSnapshot(): MagicInkDiagnosticsSnapshot {
    const pressure = Object.freeze({ ...this.#capability.pressure });
    const capability = Object.freeze({
      pointerTypes: Object.freeze([...this.#capability.pointerTypes]),
      pressure,
      tilt: Object.freeze({ ...this.#capability.tilt }),
      angles: Object.freeze({ ...this.#capability.angles }),
      contact: Object.freeze({ ...this.#capability.contact }),
      apis: Object.freeze({ ...this.#capability.apis }),
    });
    const strategy = Object.freeze({
      current: this.#currentStrategy,
      batches: Object.freeze({ ...this.#strategyBatches }),
    });

    return Object.freeze({
      revision: this.#revision,
      capacity: this.capacity,
      size: this.#entries.size,
      entries: Object.freeze(this.#entries.toArray()),
      totals: Object.freeze({ ...this.#totals }),
      capability,
      strategy,
    });
  }

  subscribe(listener: MagicInkDiagnosticsListener): MagicDisposer {
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

  clear(): void {
    if (this.#disposed) {
      return;
    }

    this.#reset();
    this.#revision += 1;
    this.#notify();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#listeners.clear();
    this.#reset();
  }

  #reset(): void {
    this.#entries.clear();
    this.#totals = emptyTotals();
    this.#capability = emptyCapability();
    this.#currentStrategy = 'unknown';
    this.#strategyBatches = emptyStrategyBatches();
  }

  #mergeCapability(entry: MagicInkDiagnosticsEntry): void {
    this.#capability.pointerTypes.add(entry.pointerType);
    if (entry.pressure) {
      const previous = this.#capability.pressure;
      const capability = stronger(previous.capability, entry.pressure.capability, PRESSURE_RANK);
      const minimum = minimumDefined(previous.minimum, entry.pressure.minimum);
      const maximum = maximumDefined(previous.maximum, entry.pressure.maximum);
      this.#capability.pressure = Object.freeze({
        capability,
        ...(minimum === undefined ? {} : { minimum }),
        ...(maximum === undefined ? {} : { maximum }),
        distinctBucketCount: Math.max(
          previous.distinctBucketCount,
          entry.pressure.distinctBucketCount
        ),
      });
    }
    if (entry.tilt) {
      this.#capability.tilt = Object.freeze({
        x: stronger(this.#capability.tilt.x, entry.tilt.x, VARIATION_RANK),
        y: stronger(this.#capability.tilt.y, entry.tilt.y, VARIATION_RANK),
      });
    }
    if (entry.angles) {
      this.#capability.angles = Object.freeze({
        altitude: stronger(this.#capability.angles.altitude, entry.angles.altitude, VARIATION_RANK),
        azimuth: stronger(this.#capability.angles.azimuth, entry.angles.azimuth, VARIATION_RANK),
        twist: stronger(this.#capability.angles.twist, entry.angles.twist, VARIATION_RANK),
      });
    }
    if (entry.contact) {
      this.#capability.contact = Object.freeze({
        width: stronger(this.#capability.contact.width, entry.contact.width, VARIATION_RANK),
        height: stronger(this.#capability.contact.height, entry.contact.height, VARIATION_RANK),
      });
    }
    if (entry.apis) {
      this.#capability.apis = Object.freeze({
        coalescedEvents: stronger(
          this.#capability.apis.coalescedEvents,
          entry.apis.coalescedEvents,
          API_RANK
        ),
        predictedEvents: stronger(
          this.#capability.apis.predictedEvents,
          entry.apis.predictedEvents,
          API_RANK
        ),
        pointerRawUpdate: stronger(
          this.#capability.apis.pointerRawUpdate,
          entry.apis.pointerRawUpdate,
          API_RANK
        ),
      });
    }
  }

  #notify(): void {
    for (const listener of Array.from(this.#listeners)) {
      try {
        listener(this.#revision);
      } catch (error) {
        try {
          this.#onListenerError(error);
        } catch {
          // Diagnostics must remain observational and must not break input.
        }
      }
    }
  }
}

const emptyTotals = (): MutableTotals => ({
  batches: 0,
  receivedSamples: 0,
  acceptedSamples: 0,
  coalescedSamples: 0,
  droppedSamples: 0,
  geometryDroppedSamples: 0,
});

const emptyCapability = (): MutableCapability => ({
  pointerTypes: new Set(),
  pressure: Object.freeze({ capability: 'unknown', distinctBucketCount: 0 }),
  tilt: Object.freeze({ x: 'unobserved', y: 'unobserved' }),
  angles: Object.freeze({
    altitude: 'unobserved',
    azimuth: 'unobserved',
    twist: 'unobserved',
  }),
  contact: Object.freeze({ width: 'unobserved', height: 'unobserved' }),
  apis: Object.freeze({
    coalescedEvents: 'unknown',
    predictedEvents: 'unknown',
    pointerRawUpdate: 'unknown',
  }),
});

const emptyStrategyBatches = (): Record<MagicInkStrategy, number> => ({
  'fixed-width': 0,
  'velocity-fallback': 0,
  'hardware-pressure': 0,
});

function projectEntry(input: MagicInkDiagnosticsEntry): MagicInkDiagnosticsEntry {
  const interval = input.interval ? projectInterval(input.interval) : undefined;
  const pressure = input.pressure ? projectPressure(input.pressure) : undefined;
  const tilt = input.tilt
    ? Object.freeze({
        x: enumValue(input.tilt.x, VARIATIONS, 'unobserved'),
        y: enumValue(input.tilt.y, VARIATIONS, 'unobserved'),
      })
    : undefined;
  const angles = input.angles
    ? Object.freeze({
        altitude: enumValue(input.angles.altitude, VARIATIONS, 'unobserved'),
        azimuth: enumValue(input.angles.azimuth, VARIATIONS, 'unobserved'),
        twist: enumValue(input.angles.twist, VARIATIONS, 'unobserved'),
      })
    : undefined;
  const contact = input.contact
    ? Object.freeze({
        width: enumValue(input.contact.width, VARIATIONS, 'unobserved'),
        height: enumValue(input.contact.height, VARIATIONS, 'unobserved'),
      })
    : undefined;
  const apis = input.apis
    ? Object.freeze({
        coalescedEvents: enumValue(input.apis.coalescedEvents, API_AVAILABILITIES, 'unknown'),
        predictedEvents: enumValue(input.apis.predictedEvents, API_AVAILABILITIES, 'unknown'),
        pointerRawUpdate: enumValue(input.apis.pointerRawUpdate, API_AVAILABILITIES, 'unknown'),
      })
    : undefined;
  const endReason = enumValue(input.endReason, END_REASONS, undefined);

  return Object.freeze({
    observedAt: nonNegativeFinite(input.observedAt),
    pointerType: enumValue(input.pointerType, POINTER_TYPES, 'unknown'),
    isPrimary: input.isPrimary === true,
    button: integer(input.button, -1),
    buttons: nonNegativeInteger(input.buttons),
    source: enumValue(input.source, SAMPLE_SOURCES, 'parent'),
    strategy: enumValue(input.strategy, STRATEGIES, 'fixed-width'),
    receivedSamples: nonNegativeInteger(input.receivedSamples),
    acceptedSamples: nonNegativeInteger(input.acceptedSamples),
    coalescedSamples: nonNegativeInteger(input.coalescedSamples),
    droppedSamples: nonNegativeInteger(input.droppedSamples),
    geometryDroppedSamples: nonNegativeInteger(input.geometryDroppedSamples ?? 0),
    captureCapped: input.captureCapped === true,
    ...(interval ? { interval } : {}),
    ...(pressure ? { pressure } : {}),
    ...(tilt ? { tilt } : {}),
    ...(angles ? { angles } : {}),
    ...(contact ? { contact } : {}),
    ...(apis ? { apis } : {}),
    ...(endReason ? { endReason } : {}),
  });
}

function projectInterval(input: MagicInkIntervalSummary): MagicInkIntervalSummary {
  const minimumMs = nonNegativeFinite(input.minimumMs);
  const maximumMs = Math.max(minimumMs, nonNegativeFinite(input.maximumMs));
  return Object.freeze({
    intervalCount: nonNegativeInteger(input.intervalCount),
    minimumMs,
    maximumMs,
    meanMs: clamp(nonNegativeFinite(input.meanMs), minimumMs, maximumMs),
    ...(input.p50Ms === undefined
      ? {}
      : { p50Ms: clamp(nonNegativeFinite(input.p50Ms), minimumMs, maximumMs) }),
    ...(input.p95Ms === undefined
      ? {}
      : { p95Ms: clamp(nonNegativeFinite(input.p95Ms), minimumMs, maximumMs) }),
  });
}

function projectPressure(input: MagicInkPressureSummary): MagicInkPressureSummary {
  const first = input.minimum === undefined ? undefined : clampPressure(input.minimum);
  const second = input.maximum === undefined ? undefined : clampPressure(input.maximum);
  const minimum =
    first === undefined ? second : second === undefined ? first : Math.min(first, second);
  const maximum =
    first === undefined ? second : second === undefined ? first : Math.max(first, second);
  return Object.freeze({
    capability: enumValue(input.capability, PRESSURE_CAPABILITIES, 'unknown'),
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    distinctBucketCount: nonNegativeInteger(input.distinctBucketCount),
  });
}

function enumValue<Value>(value: unknown, allowed: readonly Value[], fallback: Value): Value {
  return allowed.includes(value as Value) ? (value as Value) : fallback;
}

function stronger<Value extends string>(
  previous: Value,
  current: Value,
  rank: Readonly<Record<Value, number>>
): Value {
  return rank[current] > rank[previous] ? current : previous;
}

const nonNegativeFinite = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

const nonNegativeInteger = (value: number): number => Math.trunc(nonNegativeFinite(value));

const integer = (value: number, fallback: number): number =>
  Number.isSafeInteger(value) ? value : fallback;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const clampPressure = (value: number): number => clamp(nonNegativeFinite(value), 0, 1);

const minimumDefined = (left?: number, right?: number): number | undefined =>
  left === undefined ? right : right === undefined ? left : Math.min(left, right);

const maximumDefined = (left?: number, right?: number): number | undefined =>
  left === undefined ? right : right === undefined ? left : Math.max(left, right);
