import type { Point } from '@plait/core';
import type {
  ExtractedInkSampleBatch,
  InkApiAvailability,
  InkPointerIdentity,
  InkSample,
  InkSampleSource,
  PointerEventLike,
} from './types';
import { MAX_ABSOLUTE_INK_COORDINATE } from './types';

const HALF_PI = Math.PI / 2;
const TWO_PI = Math.PI * 2;
const MAX_CONTACT_SIZE = 4096;
const MAX_COALESCED_SAMPLES_PER_EVENT = 4096;
const MAX_ABSOLUTE_CLIENT_COORDINATE = 1_000_000;

export function extractInkSampleBatch(
  parentEvent: PointerEventLike,
  pointerRawUpdateAvailable = detectPointerRawUpdateAvailability()
): ExtractedInkSampleBatch {
  const identity = extractPointerIdentity(parentEvent);
  const getCoalescedEvents = readEventMethod(parentEvent, 'getCoalescedEvents');
  const getPredictedEvents = readEventMethod(parentEvent, 'getPredictedEvents');
  const apis: InkApiAvailability = {
    coalescedEvents: Boolean(getCoalescedEvents),
    predictedEvents: Boolean(getPredictedEvents),
    pointerRawUpdate: pointerRawUpdateAvailable,
  };

  let sourceEvents: readonly PointerEventLike[] = [parentEvent];
  let source: InkSampleSource = 'parent';
  let receivedSamples = 1;
  if (apis.coalescedEvents) {
    try {
      const coalesced = getCoalescedEvents?.call(parentEvent) ?? [];
      if (Array.isArray(coalesced) && coalesced.length > 0) {
        receivedSamples = coalesced.length;
        sourceEvents = coalesced.slice(0, MAX_COALESCED_SAMPLES_PER_EVENT);
        source = 'coalesced';
      }
    } catch {
      // A browser/constructed event can expose a throwing method. The parent
      // remains the deterministic fallback and drawing must stay available.
    }
  }

  const samples: InkSample[] = [];
  for (const event of sourceEvents) {
    const sample =
      source === 'parent' || hasMatchingPointerIdentity(identity, event)
        ? extractInkSample(event)
        : null;
    if (sample) {
      samples.push(sample);
    }
  }

  return {
    identity,
    source,
    samples,
    receivedSamples,
    droppedSamples: receivedSamples - samples.length,
    coalescedSamples: source === 'coalesced' ? sourceEvents.length : 0,
    apis,
  };
}

export function extractInkSample(event: PointerEventLike): InkSample | null {
  try {
    return extractInkSampleUnsafe(event);
  } catch {
    return null;
  }
}

function extractInkSampleUnsafe(event: PointerEventLike): InkSample | null {
  if (
    !Number.isFinite(event.clientX) ||
    !Number.isFinite(event.clientY) ||
    Math.abs(event.clientX) > MAX_ABSOLUTE_CLIENT_COORDINATE ||
    Math.abs(event.clientY) > MAX_ABSOLUTE_CLIENT_COORDINATE ||
    !Number.isFinite(event.timeStamp) ||
    event.timeStamp < 0
  ) {
    return null;
  }

  return {
    point: [event.clientX, event.clientY],
    time: event.timeStamp,
    ...finiteClampedProperty('pressure', event.pressure, 0, 1),
    ...finiteClampedProperty('tiltX', event.tiltX, -90, 90),
    ...finiteClampedProperty('tiltY', event.tiltY, -90, 90),
    ...finiteClampedProperty('altitudeAngle', event.altitudeAngle, 0, HALF_PI),
    ...finiteClampedProperty('azimuthAngle', event.azimuthAngle, 0, TWO_PI),
    ...finiteClampedProperty('twist', event.twist, 0, 359),
    ...finiteClampedProperty('width', event.width, 0, MAX_CONTACT_SIZE),
    ...finiteClampedProperty('height', event.height, 0, MAX_CONTACT_SIZE),
  };
}

export function transformInkSamplePoints(
  samples: readonly InkSample[],
  transform: (point: Point) => Point
): InkSample[] {
  return samples.flatMap((sample) => {
    const point = transform(sample.point);
    return Number.isFinite(point[0]) &&
      Number.isFinite(point[1]) &&
      Math.abs(point[0]) <= MAX_ABSOLUTE_INK_COORDINATE &&
      Math.abs(point[1]) <= MAX_ABSOLUTE_INK_COORDINATE
      ? [{ ...sample, point }]
      : [];
  });
}

export type MonotonicInkState = {
  readonly lastSample: InkSample | null;
};

export type MonotonicInkResult = {
  readonly accepted: readonly InkSample[];
  readonly droppedSamples: number;
  readonly state: MonotonicInkState;
};

export function acceptMonotonicInkSamples(
  state: MonotonicInkState,
  samples: readonly InkSample[]
): MonotonicInkResult {
  const accepted: InkSample[] = [];
  let lastSample = state.lastSample;
  let droppedSamples = 0;

  for (const sample of samples) {
    const outOfOrder = lastSample !== null && sample.time < lastSample.time;
    const duplicate = lastSample !== null && areEquivalentInkSamples(sample, lastSample);
    if (outOfOrder || duplicate) {
      droppedSamples += 1;
      continue;
    }
    accepted.push(sample);
    lastSample = sample;
  }

  return { accepted, droppedSamples, state: { lastSample } };
}

function areEquivalentInkSamples(left: InkSample, right: InkSample): boolean {
  return (
    left.time === right.time &&
    left.point[0] === right.point[0] &&
    left.point[1] === right.point[1] &&
    left.pressure === right.pressure &&
    left.tiltX === right.tiltX &&
    left.tiltY === right.tiltY &&
    left.altitudeAngle === right.altitudeAngle &&
    left.azimuthAngle === right.azimuthAngle &&
    left.twist === right.twist &&
    left.width === right.width &&
    left.height === right.height
  );
}

export function summarizeIntervals(samples: readonly InkSample[]) {
  if (samples.length < 2) {
    return undefined;
  }
  const intervals: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const interval = samples[index].time - samples[index - 1].time;
    if (Number.isFinite(interval) && interval >= 0) {
      intervals.push(interval);
    }
  }
  if (intervals.length === 0) {
    return undefined;
  }
  const buckets = new Set(intervals.map((value) => Math.round(value * 10) / 10));
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let total = 0;
  for (const interval of intervals) {
    min = Math.min(min, interval);
    max = Math.max(max, interval);
    total += interval;
  }
  return {
    min,
    max,
    count: intervals.length,
    mean: total / intervals.length,
    distinctBuckets: buckets.size,
    variation: min === max ? ('constant' as const) : ('varying' as const),
  };
}

function extractPointerIdentity(event: PointerEventLike): InkPointerIdentity {
  const pointerTypeValue = readEventProperty(event, 'pointerType');
  const pointerType =
    pointerTypeValue === 'mouse' || pointerTypeValue === 'pen' || pointerTypeValue === 'touch'
      ? pointerTypeValue
      : 'unknown';
  const pointerId = readEventProperty(event, 'pointerId');
  const button = readEventProperty(event, 'button');
  const buttons = readEventProperty(event, 'buttons');
  const isPrimary = readEventProperty(event, 'isPrimary');
  return {
    pointerId: Number.isInteger(pointerId) ? (pointerId as number) : -1,
    pointerType,
    button: Number.isInteger(button) ? (button as number) : -1,
    buttons: Number.isInteger(buttons) ? (buttons as number) : 0,
    isPrimary: isPrimary === true,
  };
}

function hasMatchingPointerIdentity(
  parent: InkPointerIdentity,
  candidate: unknown
): candidate is PointerEventLike {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }
  const identity = extractPointerIdentity(candidate as PointerEventLike);
  return identity.pointerId === parent.pointerId && identity.pointerType === parent.pointerType;
}

function readEventProperty<Key extends keyof PointerEventLike>(
  event: PointerEventLike,
  key: Key
): PointerEventLike[Key] | undefined {
  try {
    return event[key];
  } catch {
    return undefined;
  }
}

function readEventMethod(
  event: PointerEventLike,
  key: 'getCoalescedEvents' | 'getPredictedEvents'
): (() => readonly PointerEventLike[]) | undefined {
  const value = readEventProperty(event, key);
  return typeof value === 'function' ? value : undefined;
}

function finiteClampedProperty<Key extends keyof InkSample>(
  key: Key,
  value: number | undefined,
  minimum: number,
  maximum: number
): Partial<Pick<InkSample, Key>> {
  if (value === undefined || !Number.isFinite(value)) {
    return {};
  }
  return { [key]: Math.min(maximum, Math.max(minimum, value)) } as Partial<Pick<InkSample, Key>>;
}

function detectPointerRawUpdateAvailability(): boolean {
  return typeof window !== 'undefined' && 'onpointerrawupdate' in window;
}
