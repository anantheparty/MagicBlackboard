import { describe, expect, it } from 'vitest';
import { mapInkSampleWidth, mapPressureToWidth, normalizeInkPressure } from './pressure';
import { MAX_FREEHAND_INK_WIDTH, type InkSample } from './types';

describe('freehand pressure mapping', () => {
  it('is continuous enough for adjacent normalized samples and monotonic across the domain', () => {
    const widths = Array.from({ length: 1_001 }, (_, index) =>
      mapPressureToWidth(index / 1_000, 10)
    );

    expect(widths[0]).toBeCloseTo(3.5);
    expect(widths[widths.length - 1]).toBeCloseTo(16.5);
    for (let index = 1; index < widths.length; index += 1) {
      expect(widths[index]).toBeGreaterThanOrEqual(widths[index - 1]);
      expect(widths[index] - widths[index - 1]).toBeLessThan(0.1);
    }
  });

  it('clamps invalid pressure, sensitivity, and base widths to finite safe output', () => {
    expect(normalizeInkPressure(Number.NaN, Number.NaN)).toBe(0);

    for (const baseWidth of [Number.NaN, Number.POSITIVE_INFINITY, 0, -100]) {
      const width = mapPressureToWidth(Number.NaN, baseWidth, {
        sensitivity: Number.NaN,
      });
      expect(Number.isFinite(width)).toBe(true);
      expect(width).toBeGreaterThan(0);
      expect(width).toBeLessThanOrEqual(MAX_FREEHAND_INK_WIDTH);
    }
  });

  it('never exceeds the persisted 96px width ceiling', () => {
    expect(mapPressureToWidth(1, Number.MAX_SAFE_INTEGER, { maximumFactor: 3 })).toBe(
      MAX_FREEHAND_INK_WIDTH
    );
    expect(mapPressureToWidth(1, MAX_FREEHAND_INK_WIDTH)).toBe(MAX_FREEHAND_INK_WIDTH);
  });

  it('smooths a pressure transition without overshooting either width', () => {
    const sample: InkSample = { point: [0, 0], time: 0, pressure: 1 };
    const target = mapPressureToWidth(1, 10);
    const smoothed = mapInkSampleWidth(sample, 'hardware-pressure', 10, 4);

    expect(smoothed).toBeGreaterThan(4);
    expect(smoothed).toBeLessThan(target);
    expect(smoothed).toBeLessThanOrEqual(MAX_FREEHAND_INK_WIDTH);
  });
});
