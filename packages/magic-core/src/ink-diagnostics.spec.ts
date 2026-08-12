import { describe, expect, it, vi } from 'vitest';
import { MagicInkDiagnosticsStore, type MagicInkDiagnosticsEntry } from './ink-diagnostics';

const entry = (
  observedAt: number,
  patch: Partial<MagicInkDiagnosticsEntry> = {}
): MagicInkDiagnosticsEntry => ({
  observedAt,
  pointerType: 'pen',
  isPrimary: true,
  button: -1,
  buttons: 1,
  source: 'parent',
  strategy: 'fixed-width',
  receivedSamples: 1,
  acceptedSamples: 1,
  coalescedSamples: 0,
  droppedSamples: 0,
  ...patch,
});

describe('MagicInkDiagnosticsStore', () => {
  it('retains only bounded projected summaries while keeping compact session totals', () => {
    const store = new MagicInkDiagnosticsStore({ capacity: 2 });
    store.record(
      entry(1, {
        pointerType: 'mouse',
        pressure: {
          capability: 'none',
          distinctBucketCount: 0,
        },
      })
    );
    store.record({
      ...entry(2, {
        source: 'coalesced',
        strategy: 'velocity-fallback',
        receivedSamples: 4,
        acceptedSamples: 3,
        coalescedSamples: 4,
        droppedSamples: 1,
        pressure: {
          capability: 'fallback-0.5-suspected',
          minimum: 0.5,
          maximum: 0.5,
          distinctBucketCount: 1,
        },
        apis: {
          coalescedEvents: 'available',
          predictedEvents: 'unavailable',
          pointerRawUpdate: 'unknown',
        },
      }),
      rawSamples: [{ point: [10, 20] }],
      point: [10, 20],
    } as MagicInkDiagnosticsEntry);
    store.record(
      entry(3, {
        strategy: 'hardware-pressure',
        pressure: {
          capability: 'variable-observed',
          minimum: -0.25,
          maximum: 1.25,
          distinctBucketCount: 7,
        },
        tilt: { x: 'varying', y: 'constant' },
      })
    );

    const snapshot = store.getSnapshot();
    expect(snapshot.capacity).toBe(2);
    expect(snapshot.size).toBe(2);
    expect(snapshot.entries.map((value) => value.observedAt)).toEqual([2, 3]);
    expect(snapshot.entries[0]).not.toHaveProperty('rawSamples');
    expect(snapshot.entries[0]).not.toHaveProperty('point');
    expect(snapshot.totals).toEqual({
      batches: 3,
      receivedSamples: 6,
      acceptedSamples: 5,
      coalescedSamples: 4,
      droppedSamples: 1,
    });
    expect(snapshot.capability).toMatchObject({
      pointerTypes: ['mouse', 'pen'],
      pressure: {
        capability: 'variable-observed',
        minimum: 0,
        maximum: 1,
        distinctBucketCount: 7,
      },
      tilt: { x: 'varying', y: 'constant' },
      apis: {
        coalescedEvents: 'available',
        predictedEvents: 'unavailable',
        pointerRawUpdate: 'unknown',
      },
    });
    expect(snapshot.strategy).toEqual({
      current: 'hardware-pressure',
      batches: {
        'fixed-width': 1,
        'velocity-fallback': 1,
        'hardware-pressure': 1,
      },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.entries[0])).toBe(true);
  });

  it('isolates listener failures from recording and supports idempotent unsubscribe', () => {
    const failure = new Error('diagnostics view failed');
    const onListenerError = vi.fn();
    const survivor = vi.fn();
    const store = new MagicInkDiagnosticsStore({ onListenerError });
    store.subscribe(() => {
      throw failure;
    });
    const unsubscribe = store.subscribe(survivor);

    expect(() => store.record(entry(1))).not.toThrow();
    expect(onListenerError).toHaveBeenCalledWith(failure);
    expect(survivor).toHaveBeenCalledWith(1);

    unsubscribe();
    unsubscribe();
    store.record(entry(2));
    expect(survivor).toHaveBeenCalledTimes(1);
  });

  it('clears and disposes retained session data idempotently', () => {
    const store = new MagicInkDiagnosticsStore({ capacity: 3 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.record(entry(1));

    store.clear();
    expect(listener).toHaveBeenLastCalledWith(2);
    expect(store.getSnapshot()).toMatchObject({
      revision: 2,
      size: 0,
      totals: { batches: 0, acceptedSamples: 0 },
      strategy: { current: 'unknown' },
    });

    store.dispose();
    store.dispose();
    store.record(entry(3));
    store.clear();
    expect(store.disposed).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ revision: 2, size: 0 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
