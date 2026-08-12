import { describe, expect, it } from 'vitest';
import {
  acceptMonotonicInkSamples,
  extractInkSample,
  extractInkSampleBatch,
  summarizeIntervals,
  transformInkSamplePoints,
} from './samples';
import type { InkSample, PointerEventLike } from './types';

function pointerEvent(overrides: Partial<PointerEventLike> = {}): PointerEventLike {
  return {
    pointerId: 7,
    pointerType: 'pen',
    button: 0,
    buttons: 1,
    isPrimary: true,
    clientX: 10,
    clientY: 20,
    timeStamp: 100,
    pressure: 0.4,
    ...overrides,
  };
}

function sample(point: readonly [number, number], time: number): InkSample {
  return { point: [...point], time };
}

describe('freehand ink sample extraction', () => {
  it('uses the parent when coalesced events are absent or empty', () => {
    const absent = extractInkSampleBatch(pointerEvent(), false);
    const empty = extractInkSampleBatch(pointerEvent({ getCoalescedEvents: () => [] }), false);

    expect(absent.source).toBe('parent');
    expect(absent.samples).toEqual([{ point: [10, 20], time: 100, pressure: 0.4 }]);
    expect(empty.source).toBe('parent');
    expect(empty.samples).toEqual(absent.samples);
  });

  it('processes a non-empty coalesced list instead of, never in addition to, the parent', () => {
    const batch = extractInkSampleBatch(
      pointerEvent({
        clientX: 999,
        clientY: 999,
        getCoalescedEvents: () => [
          pointerEvent({ clientX: 11, clientY: 21, timeStamp: 101 }),
          pointerEvent({ clientX: 12, clientY: 22, timeStamp: 102 }),
        ],
      }),
      false
    );

    expect(batch.source).toBe('coalesced');
    expect(batch.samples.map(({ point }) => point)).toEqual([
      [11, 21],
      [12, 22],
    ]);
    expect(batch.samples).not.toContainEqual(expect.objectContaining({ point: [999, 999] }));
    expect(batch.receivedSamples).toBe(2);
    expect(batch.coalescedSamples).toBe(2);
    expect(batch.droppedSamples).toBe(0);
  });

  it('falls back to the parent when getCoalescedEvents throws or returns a non-array', () => {
    const throwing = extractInkSampleBatch(
      pointerEvent({
        getCoalescedEvents: () => {
          throw new Error('constructed event failure');
        },
      }),
      false
    );
    const nonArray = extractInkSampleBatch(
      pointerEvent({
        getCoalescedEvents: (() => ({ 0: pointerEvent(), length: 1 })) as never,
      }),
      false
    );

    for (const batch of [throwing, nonArray]) {
      expect(batch.source).toBe('parent');
      expect(batch.samples).toHaveLength(1);
      expect(batch.samples[0].point).toEqual([10, 20]);
      expect(batch.droppedSamples).toBe(0);
    }
  });

  it('drops hostile or foreign coalesced entries without throwing or replaying the parent', () => {
    const throwingGetter = {
      pointerId: 7,
      pointerType: 'pen',
      get clientX() {
        throw new Error('hostile getter');
      },
    } as unknown as PointerEventLike;
    const batch = extractInkSampleBatch(
      pointerEvent({
        getCoalescedEvents: () => [
          null as unknown as PointerEventLike,
          throwingGetter,
          pointerEvent({ pointerId: 99, clientX: 30 }),
          pointerEvent({ pointerType: 'touch', clientX: 40 }),
          pointerEvent({ clientX: 50, timeStamp: 101 }),
        ],
      }),
      false
    );

    expect(batch.source).toBe('coalesced');
    expect(batch.receivedSamples).toBe(5);
    expect(batch.samples).toEqual([expect.objectContaining({ point: [50, 20], time: 101 })]);
    expect(batch.droppedSamples).toBe(4);
  });

  it('treats throwing event method getters as unavailable', () => {
    const event = pointerEvent();
    Object.defineProperty(event, 'getCoalescedEvents', {
      get() {
        throw new Error('hostile method getter');
      },
    });

    expect(() => extractInkSampleBatch(event, false)).not.toThrow();
    expect(extractInkSampleBatch(event, false)).toMatchObject({
      source: 'parent',
      samples: [expect.objectContaining({ point: [10, 20] })],
      apis: { coalescedEvents: false },
    });
  });

  it('bounds oversized coalesced lists and accounts for overflow as dropped', () => {
    const coalesced = Array.from({ length: 5_000 }, (_, index) =>
      pointerEvent({ clientX: index, timeStamp: index })
    );
    const batch = extractInkSampleBatch(
      pointerEvent({ getCoalescedEvents: () => coalesced }),
      false
    );

    expect(batch.source).toBe('coalesced');
    expect(batch.receivedSamples).toBe(5_000);
    expect(batch.samples).toHaveLength(4_096);
    expect(batch.coalescedSamples).toBe(4_096);
    expect(batch.droppedSamples).toBe(904);
  });

  it('rejects NaN, infinite, and excessive coordinates while accepting the boundary', () => {
    for (const overrides of [
      { clientX: Number.NaN },
      { clientY: Number.POSITIVE_INFINITY },
      { clientX: 1_000_001 },
      { clientY: -1_000_001 },
    ]) {
      expect(extractInkSample(pointerEvent(overrides))).toBeNull();
    }

    expect(extractInkSample(pointerEvent({ clientX: 1_000_000, clientY: -1_000_000 }))).toEqual(
      expect.objectContaining({ point: [1_000_000, -1_000_000] })
    );
  });

  it('drops transformed coordinates outside the finite ink geometry budget', () => {
    const source = [sample([1, 2], 1)];
    expect(transformInkSamplePoints(source, () => [Number.POSITIVE_INFINITY, 0])).toEqual([]);
    expect(transformInkSamplePoints(source, () => [1_000_000_001, 0])).toEqual([]);
    expect(transformInkSamplePoints(source, () => [1_000_000_000, -1_000_000_000])).toEqual([
      { point: [1_000_000_000, -1_000_000_000], time: 1 },
    ]);
  });

  it('clamps finite sensor properties, omits non-finite values, and rejects invalid time', () => {
    expect(
      extractInkSample(
        pointerEvent({
          pressure: 2,
          tiltX: -120,
          tiltY: 120,
          altitudeAngle: -1,
          azimuthAngle: 99,
          twist: 999,
          width: 9_999,
          height: -4,
        })
      )
    ).toEqual(
      expect.objectContaining({
        pressure: 1,
        tiltX: -90,
        tiltY: 90,
        altitudeAngle: 0,
        azimuthAngle: Math.PI * 2,
        twist: 359,
        width: 4_096,
        height: 0,
      })
    );
    const omitted = extractInkSample(
      pointerEvent({
        pressure: Number.NaN,
        tiltX: Number.POSITIVE_INFINITY,
        altitudeAngle: Number.NaN,
      })
    );
    expect(omitted).not.toHaveProperty('pressure');
    expect(omitted).not.toHaveProperty('tiltX');
    expect(omitted).not.toHaveProperty('altitudeAngle');
    expect(extractInkSample(pointerEvent({ timeStamp: -1 }))).toBeNull();
    expect(extractInkSample(pointerEvent({ timeStamp: Number.NaN }))).toBeNull();
  });

  it('accepts non-decreasing samples while dropping out-of-order and exact duplicates', () => {
    const result = acceptMonotonicInkSamples({ lastSample: null }, [
      sample([2, 2], 2),
      sample([1, 1], 1),
      sample([2, 2], 2),
      sample([3, 3], 2),
      sample([4, 4], 3),
    ]);

    expect(result.accepted).toEqual([sample([2, 2], 2), sample([3, 3], 2), sample([4, 4], 3)]);
    expect(result.droppedSamples).toBe(2);
    expect(result.state.lastSample).toEqual(sample([4, 4], 3));

    const next = acceptMonotonicInkSamples(result.state, [sample([5, 5], 2.5), sample([6, 6], 4)]);
    expect(next.accepted).toEqual([sample([6, 6], 4)]);
    expect(next.droppedSamples).toBe(1);
  });

  it('keeps stationary samples when pressure or tilt changes at the same timestamp', () => {
    const base: InkSample = { point: [2, 2], time: 2, pressure: 0.2, tiltX: 1 };
    const pressureChanged: InkSample = { ...base, pressure: 0.8 };
    const tiltChanged: InkSample = { ...pressureChanged, tiltX: 8 };

    const result = acceptMonotonicInkSamples({ lastSample: null }, [
      base,
      pressureChanged,
      tiltChanged,
    ]);
    expect(result.accepted).toEqual([base, pressureChanged, tiltChanged]);
    expect(result.droppedSamples).toBe(0);
  });

  it('summarizes valid sample intervals without inventing a one-sample result', () => {
    expect(summarizeIntervals([sample([0, 0], 10)])).toBeUndefined();
    expect(
      summarizeIntervals([sample([0, 0], 10), sample([1, 0], 12), sample([2, 0], 15)])
    ).toEqual({
      min: 2,
      max: 3,
      count: 2,
      mean: 2.5,
      distinctBuckets: 2,
      variation: 'varying',
    });
  });
});
