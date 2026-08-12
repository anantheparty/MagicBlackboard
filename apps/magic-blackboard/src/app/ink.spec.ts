import { getFreehandInkPluginOptions, type FreehandInkDiagnostic } from '@drawnix/drawnix';
import { createMagicRuntime } from '@magic-blackboard/runtime';
import type { PlaitBoard } from '@plait/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createMagicInkFeatureDefinitions,
  MagicInkController,
  MAGIC_INK_DIAGNOSTICS_FEATURE_ID,
  MAGIC_PRESSURE_INK_FEATURE_ID,
  toMagicInkDiagnostic,
} from './ink';

describe('MagicInkController', () => {
  it('keeps both ink features unavailable and default-off outside development', () => {
    expect(createMagicInkFeatureDefinitions(false)).toEqual([
      expect.objectContaining({
        id: MAGIC_INK_DIAGNOSTICS_FEATURE_ID,
        available: false,
        defaultEnabled: false,
      }),
      expect.objectContaining({
        id: MAGIC_PRESSURE_INK_FEATURE_ID,
        available: false,
        defaultEnabled: false,
      }),
    ]);
  });

  it('keeps diagnostics and pressure behavior disabled by default', async () => {
    const runtime = createMagicRuntime();
    await runtime.features.registerMany(createMagicInkFeatureDefinitions(true));
    const controller = new MagicInkController(runtime);
    const board = createOptionsBoard();
    controller.asPlugin()(board);
    const options = getFreehandInkPluginOptions(board);

    expect(options.getMode()).toBe('legacy');
    options.onDiagnostic?.(diagnosticFixture());
    expect(runtime.inkDiagnostics.getSnapshot().size).toBe(0);

    controller.dispose();
    runtime.dispose();
  });

  it('enables probe and pressure modes independently and stops after disposal', async () => {
    const runtime = createMagicRuntime();
    await runtime.features.registerMany(createMagicInkFeatureDefinitions(true));
    const controller = new MagicInkController(runtime);
    const board = createOptionsBoard();
    controller.asPlugin()(board);
    const options = getFreehandInkPluginOptions(board);

    await runtime.features.setEnabled(MAGIC_INK_DIAGNOSTICS_FEATURE_ID, true);
    expect(options.getMode()).toBe('probe');
    options.onDiagnostic?.(diagnosticFixture());
    expect(runtime.inkDiagnostics.getSnapshot().size).toBe(1);

    await runtime.features.setEnabled(MAGIC_PRESSURE_INK_FEATURE_ID, true);
    expect(options.getMode()).toBe('pressure');
    await runtime.features.setEnabled(MAGIC_INK_DIAGNOSTICS_FEATURE_ID, false);
    options.onDiagnostic?.(diagnosticFixture());
    expect(runtime.inkDiagnostics.getSnapshot().size).toBe(1);

    controller.dispose();
    expect(options.getMode()).toBe('legacy');
    runtime.dispose();
  });

  it('fails closed and remains idempotent when input cleanup throws', async () => {
    const runtime = createMagicRuntime();
    await runtime.features.registerMany(createMagicInkFeatureDefinitions(true));
    await runtime.features.setEnabled(MAGIC_PRESSURE_INK_FEATURE_ID, true);
    const controller = new MagicInkController(runtime);
    const board = createOptionsBoard();
    controller.asPlugin()(board);
    const options = getFreehandInkPluginOptions(board);
    const cleanupError = new Error('synthetic input cleanup failure');
    const disposeInput = vi.fn(() => {
      throw cleanupError;
    });
    options.onLifecycleRegistration?.(disposeInput);

    expect(options.getMode()).toBe('pressure');
    expect(() => controller.dispose()).toThrow(cleanupError);
    expect(options.getMode()).toBe('legacy');
    expect(() => controller.dispose()).not.toThrow();
    expect(disposeInput).toHaveBeenCalledOnce();

    runtime.dispose();
  });

  it('isolates two board runtimes and their toggles', async () => {
    const first = createMagicRuntime();
    const second = createMagicRuntime();
    await Promise.all([
      first.features.registerMany(createMagicInkFeatureDefinitions(true)),
      second.features.registerMany(createMagicInkFeatureDefinitions(true)),
    ]);
    const firstController = new MagicInkController(first);
    const secondController = new MagicInkController(second);
    const firstBoard = createOptionsBoard();
    const secondBoard = createOptionsBoard();
    firstController.asPlugin()(firstBoard);
    secondController.asPlugin()(secondBoard);

    await first.features.setEnabled(MAGIC_PRESSURE_INK_FEATURE_ID, true);
    expect(getFreehandInkPluginOptions(firstBoard).getMode()).toBe('pressure');
    expect(getFreehandInkPluginOptions(secondBoard).getMode()).toBe('legacy');

    firstController.dispose();
    secondController.dispose();
    first.dispose();
    second.dispose();
  });

  it('uses board-scoped persisted feature keys when runtimes share a settings store', async () => {
    const values = new Map<string, unknown>();
    const settings = {
      get: async <T>(key: string) => values.get(key) as T | undefined,
      set: async <T>(key: string, value: T) => {
        values.set(key, value);
      },
      remove: async (key: string) => {
        values.delete(key);
      },
      clear: async () => values.clear(),
    };
    const first = createMagicRuntime({
      boardId: 'first',
      settings,
      ownsSettings: false,
      featureSettingsKeyPrefix: 'first.features',
    });
    const second = createMagicRuntime({
      boardId: 'second',
      settings,
      ownsSettings: false,
      featureSettingsKeyPrefix: 'second.features',
    });
    await Promise.all([
      first.features.registerMany(createMagicInkFeatureDefinitions(true)),
      second.features.registerMany(createMagicInkFeatureDefinitions(true)),
    ]);

    await first.features.setEnabled(MAGIC_PRESSURE_INK_FEATURE_ID, true);

    expect(first.features.isEnabled(MAGIC_PRESSURE_INK_FEATURE_ID)).toBe(true);
    expect(second.features.isEnabled(MAGIC_PRESSURE_INK_FEATURE_ID)).toBe(false);
    expect(values.get('first.features.magic.pressure-ink.enabled')).toBe(true);
    expect(values.get('second.features.magic.pressure-ink.enabled')).toBe(false);

    first.dispose();
    second.dispose();
  });
});

describe('toMagicInkDiagnostic', () => {
  it('projects a coordinate-free bounded summary', () => {
    expect(toMagicInkDiagnostic(diagnosticFixture())).toEqual({
      observedAt: 42,
      pointerType: 'pen',
      isPrimary: true,
      button: -1,
      buttons: 1,
      source: 'coalesced',
      strategy: 'hardware-pressure',
      receivedSamples: 3,
      acceptedSamples: 2,
      coalescedSamples: 3,
      droppedSamples: 1,
      geometryDroppedSamples: 0,
      captureCapped: false,
      interval: {
        intervalCount: 2,
        minimumMs: 2,
        maximumMs: 4,
        meanMs: 3,
      },
      pressure: {
        capability: 'variable-observed',
        minimum: 0.2,
        maximum: 0.8,
        distinctBucketCount: 3,
      },
      tilt: { x: 'varying', y: 'constant' },
      angles: { altitude: 'varying', azimuth: 'varying', twist: 'unobserved' },
      contact: { width: 'constant', height: 'constant' },
      apis: {
        coalescedEvents: 'available',
        predictedEvents: 'available',
        pointerRawUpdate: 'unavailable',
      },
      endReason: 'completed',
    });
  });
});

function createOptionsBoard(): PlaitBoard {
  const options = new Map<string, unknown>();
  return {
    getPluginOptions: (key: string) => options.get(key),
    setPluginOptions: (key: string, value: unknown) => options.set(key, value),
  } as unknown as PlaitBoard;
}

function diagnosticFixture(): FreehandInkDiagnostic {
  return {
    observedAt: 42,
    pointerType: 'pen',
    isPrimary: true,
    button: -1,
    buttons: 1,
    source: 'coalesced',
    strategy: 'hardware-pressure',
    receivedSamples: 3,
    acceptedSamples: 2,
    coalescedSamples: 3,
    droppedSamples: 1,
    intervalMs: {
      min: 2,
      max: 4,
      count: 2,
      mean: 3,
      distinctBuckets: 2,
      variation: 'varying',
    },
    capability: {
      pressure: { min: 0.2, max: 0.8, distinctBuckets: 3, variation: 'varying' },
      pressureCapability: 'variable-observed',
      tiltX: { min: 0, max: 20, distinctBuckets: 2, variation: 'varying' },
      tiltY: { min: 3, max: 3, distinctBuckets: 1, variation: 'constant' },
      altitudeAngle: { min: 0.5, max: 1, distinctBuckets: 2, variation: 'varying' },
      azimuthAngle: { min: 1, max: 2, distinctBuckets: 2, variation: 'varying' },
      twist: null,
      contactWidth: { min: 1, max: 1, distinctBuckets: 1, variation: 'constant' },
      contactHeight: { min: 1, max: 1, distinctBuckets: 1, variation: 'constant' },
      apis: { coalescedEvents: true, predictedEvents: true, pointerRawUpdate: false },
    },
    endReason: 'pointer-up',
  };
}
