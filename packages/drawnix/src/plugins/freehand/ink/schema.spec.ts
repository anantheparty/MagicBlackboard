import { describe, expect, it } from 'vitest';
import { isValidFreehandInkData } from './schema';
import {
  FREEHAND_INK_SCHEMA_VERSION,
  MAX_FREEHAND_INK_SAMPLES,
  MAX_FREEHAND_INK_WIDTH,
  MIN_FREEHAND_INK_WIDTH,
} from './types';

describe('freehand ink schema', () => {
  it('accepts only the versioned width geometry matching the point count', () => {
    expect(
      isValidFreehandInkData(
        {
          version: FREEHAND_INK_SCHEMA_VERSION,
          widths: [MIN_FREEHAND_INK_WIDTH, 2.5, MAX_FREEHAND_INK_WIDTH],
        },
        3
      )
    ).toBe(true);
  });

  it('rejects missing ink objects and missing or empty width arrays', () => {
    expect(isValidFreehandInkData(undefined)).toBe(false);
    expect(isValidFreehandInkData(null)).toBe(false);
    expect(isValidFreehandInkData({})).toBe(false);
    expect(isValidFreehandInkData({ version: FREEHAND_INK_SCHEMA_VERSION })).toBe(false);
    expect(isValidFreehandInkData({ version: FREEHAND_INK_SCHEMA_VERSION, widths: [] }, 0)).toBe(
      false
    );
  });

  it('rejects unknown or incorrectly typed schema versions', () => {
    for (const version of [0, 2, '1', null]) {
      expect(isValidFreehandInkData({ version, widths: [2] }, 1)).toBe(false);
    }
  });

  it('rejects width arrays whose length does not match the existing points', () => {
    const ink = { version: FREEHAND_INK_SCHEMA_VERSION, widths: [1, 2] };

    expect(isValidFreehandInkData(ink, 1)).toBe(false);
    expect(isValidFreehandInkData(ink, 3)).toBe(false);
    expect(isValidFreehandInkData(ink, 2)).toBe(true);
  });

  it('rejects extra keys and unsafe width values', () => {
    expect(
      isValidFreehandInkData(
        { version: FREEHAND_INK_SCHEMA_VERSION, widths: [2], pressure: [0.5] },
        1
      )
    ).toBe(false);

    for (const width of [
      0,
      MIN_FREEHAND_INK_WIDTH / 2,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MAX_FREEHAND_INK_WIDTH + 0.01,
    ]) {
      expect(
        isValidFreehandInkData({ version: FREEHAND_INK_SCHEMA_VERSION, widths: [width] }, 1)
      ).toBe(false);
    }
  });

  it('rejects sparse width arrays instead of producing invalid geometry', () => {
    const sparse: number[] = [];
    sparse.length = 2;
    sparse[0] = 2;

    expect(
      isValidFreehandInkData({ version: FREEHAND_INK_SCHEMA_VERSION, widths: sparse }, 2)
    ).toBe(false);
  });

  it('accepts exactly the bounded maximum without recursion and rejects one over the cap', () => {
    const maximum = Array.from({ length: MAX_FREEHAND_INK_SAMPLES }, () => 2);
    const overMaximum = [...maximum, 2];

    expect(
      isValidFreehandInkData(
        { version: FREEHAND_INK_SCHEMA_VERSION, widths: maximum },
        MAX_FREEHAND_INK_SAMPLES
      )
    ).toBe(true);
    expect(
      isValidFreehandInkData(
        { version: FREEHAND_INK_SCHEMA_VERSION, widths: overMaximum },
        MAX_FREEHAND_INK_SAMPLES + 1
      )
    ).toBe(false);
  });
});
