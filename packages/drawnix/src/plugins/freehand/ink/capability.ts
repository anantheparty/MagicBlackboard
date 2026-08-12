import type {
  InkApiAvailability,
  InkCapabilitySnapshot,
  InkPointerIdentity,
  InkPressureCapability,
  InkRangeSummary,
  InkSample,
  InkVariation,
} from './types';

const MIN_CAPABILITY_SAMPLE_COUNT = 4;
const PRESSURE_VARIATION_THRESHOLD = 0.04;

class BoundedRangeTracker {
  #count = 0;
  #min = Number.POSITIVE_INFINITY;
  #max = Number.NEGATIVE_INFINITY;
  readonly #buckets = new Set<number>();

  observe(value: number | undefined): void {
    if (value === undefined || !Number.isFinite(value)) {
      return;
    }
    this.#count += 1;
    this.#min = Math.min(this.#min, value);
    this.#max = Math.max(this.#max, value);
    if (this.#buckets.size < 32) {
      this.#buckets.add(Math.round(value * 100) / 100);
    }
  }

  get count(): number {
    return this.#count;
  }

  snapshot(): InkRangeSummary | null {
    if (this.#count === 0) {
      return null;
    }
    const variation: InkVariation =
      this.#buckets.size > 1 || this.#max !== this.#min ? 'varying' : 'constant';
    return {
      min: this.#min,
      max: this.#max,
      distinctBuckets: this.#buckets.size,
      variation,
    };
  }
}

type PointerCapabilityTrackers = {
  readonly pressure: BoundedRangeTracker;
  readonly tiltX: BoundedRangeTracker;
  readonly tiltY: BoundedRangeTracker;
  readonly altitudeAngle: BoundedRangeTracker;
  readonly azimuthAngle: BoundedRangeTracker;
  readonly twist: BoundedRangeTracker;
  readonly contactWidth: BoundedRangeTracker;
  readonly contactHeight: BoundedRangeTracker;
};

function createTrackers(): PointerCapabilityTrackers {
  return {
    pressure: new BoundedRangeTracker(),
    tiltX: new BoundedRangeTracker(),
    tiltY: new BoundedRangeTracker(),
    altitudeAngle: new BoundedRangeTracker(),
    azimuthAngle: new BoundedRangeTracker(),
    twist: new BoundedRangeTracker(),
    contactWidth: new BoundedRangeTracker(),
    contactHeight: new BoundedRangeTracker(),
  };
}

export class InkCapabilityProbe {
  readonly #byPointerType = new Map<InkPointerIdentity['pointerType'], PointerCapabilityTrackers>();
  #apis: InkApiAvailability = {
    coalescedEvents: false,
    predictedEvents: false,
    pointerRawUpdate: false,
  };

  observe(
    identity: InkPointerIdentity,
    samples: readonly InkSample[],
    apis: InkApiAvailability
  ): InkCapabilitySnapshot {
    this.#apis = {
      coalescedEvents: this.#apis.coalescedEvents || apis.coalescedEvents,
      predictedEvents: this.#apis.predictedEvents || apis.predictedEvents,
      pointerRawUpdate: this.#apis.pointerRawUpdate || apis.pointerRawUpdate,
    };
    const trackers = this.#trackers(identity.pointerType);
    for (const sample of samples) {
      // A pointerup/cancel pressure of zero describes the end of contact, not
      // the hardware's active pressure capability.
      if (identity.buttons !== 0) {
        trackers.pressure.observe(sample.pressure);
      }
      trackers.tiltX.observe(sample.tiltX);
      trackers.tiltY.observe(sample.tiltY);
      trackers.altitudeAngle.observe(sample.altitudeAngle);
      trackers.azimuthAngle.observe(sample.azimuthAngle);
      trackers.twist.observe(sample.twist);
      trackers.contactWidth.observe(sample.width);
      trackers.contactHeight.observe(sample.height);
    }
    return this.snapshot(identity.pointerType);
  }

  snapshot(pointerType: InkPointerIdentity['pointerType']): InkCapabilitySnapshot {
    const trackers = this.#trackers(pointerType);
    const pressure = trackers.pressure.snapshot();
    return {
      pressure,
      pressureCapability: classifyPressureCapability(
        pointerType,
        pressure,
        trackers.pressure.count
      ),
      tiltX: trackers.tiltX.snapshot(),
      tiltY: trackers.tiltY.snapshot(),
      altitudeAngle: trackers.altitudeAngle.snapshot(),
      azimuthAngle: trackers.azimuthAngle.snapshot(),
      contactWidth: trackers.contactWidth.snapshot(),
      contactHeight: trackers.contactHeight.snapshot(),
      twist: trackers.twist.snapshot(),
      apis: this.#apis,
    };
  }

  #trackers(pointerType: InkPointerIdentity['pointerType']): PointerCapabilityTrackers {
    const existing = this.#byPointerType.get(pointerType);
    if (existing) {
      return existing;
    }
    const trackers = createTrackers();
    this.#byPointerType.set(pointerType, trackers);
    return trackers;
  }
}

export function classifyPressureCapability(
  pointerType: InkPointerIdentity['pointerType'],
  pressure: InkRangeSummary | null,
  activePressureSamples: number
): InkPressureCapability {
  if (!pressure || activePressureSamples === 0) {
    return 'unknown';
  }
  // One transient zero (for example, at contact start) is not enough to
  // establish that a device has no pressure capability. All terminal
  // classifications require the same small active-sample evidence window.
  if (activePressureSamples < MIN_CAPABILITY_SAMPLE_COUNT) {
    return 'unknown';
  }
  if (pointerType !== 'pen') {
    return pressure.max === 0 ? 'none' : 'fallback-0.5-suspected';
  }
  if (
    pressure.distinctBuckets >= 2 &&
    pressure.max - pressure.min >= PRESSURE_VARIATION_THRESHOLD
  ) {
    return 'variable-observed';
  }
  if (Math.abs(pressure.min - 0.5) < 0.01 && Math.abs(pressure.max - 0.5) < 0.01) {
    return 'fallback-0.5-suspected';
  }
  return pressure.max === 0 ? 'none' : 'unknown';
}
