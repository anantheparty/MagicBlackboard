import type { Point } from '@plait/core';
import { describe, expect, it } from 'vitest';
import { FreehandShape, type Freehand } from '../type';
import {
  buildInkOutline,
  getFreehandInkShapes,
  getFreehandInkOutline,
  getFreehandRectangle,
  inkOutlineToSvgPath,
  isPointHitFreehandInk,
  isRectangleHitFreehandInk,
} from './geometry';
import { FREEHAND_INK_SCHEMA_VERSION, MAX_FREEHAND_INK_SAMPLES } from './types';

function bounds(points: readonly Point[]) {
  return {
    minX: Math.min(...points.map(([x]) => x)),
    maxX: Math.max(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxY: Math.max(...points.map(([, y]) => y)),
  };
}

function freehand(points: Point[], widths?: number[]): Freehand {
  return {
    id: 'ink-test',
    type: 'freehand',
    shape: FreehandShape.feltTipPen,
    points,
    strokeColor: '#000000',
    strokeWidth: 4,
    ...(widths ? { ink: { version: FREEHAND_INK_SCHEMA_VERSION, widths } } : {}),
  } as Freehand;
}

describe('freehand ink geometry', () => {
  it('extends horizontal round caps outward from both endpoints', () => {
    const outline = buildInkOutline(
      [
        [0, 0],
        [10, 0],
      ],
      [2, 2]
    );
    const rectangle = bounds(outline);

    expect(rectangle.minX).toBeCloseTo(-1);
    expect(rectangle.maxX).toBeCloseTo(11);
    expect(rectangle.minY).toBeCloseTo(-1);
    expect(rectangle.maxY).toBeCloseTo(1);
  });

  it('extends vertical round caps outward from both endpoints', () => {
    const outline = buildInkOutline(
      [
        [0, 0],
        [0, 10],
      ],
      [4, 4]
    );
    const rectangle = bounds(outline);

    expect(rectangle.minX).toBeCloseTo(-2);
    expect(rectangle.maxX).toBeCloseTo(2);
    expect(rectangle.minY).toBeCloseTo(-2);
    expect(rectangle.maxY).toBeCloseTo(12);
  });

  it('builds a finite circular dot and a closed SVG path', () => {
    const outline = buildInkOutline([[5, 7]], [4]);
    const path = inkOutlineToSvgPath(outline);

    expect(outline).toHaveLength(12);
    for (const point of outline) {
      expect(Math.hypot(point[0] - 5, point[1] - 7)).toBeCloseTo(2);
    }
    expect(path).toMatch(/^M 7 7 /);
    expect(path).toMatch(/ Z$/);
    expect(path).not.toContain('NaN');
    expect(inkOutlineToSvgPath([])).toBe('');
  });

  it('builds a snapped closed stroke without overlapping endpoint caps', () => {
    const target = freehand(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [2, 2, 2, 2, 2]
    );
    const shapes = getFreehandInkShapes(target);

    expect(shapes).toHaveLength(8);
    expect(shapes?.flat().every((point) => point.every(Number.isFinite))).toBe(true);
    expect(shapes?.every((shape) => signedArea(shape) < 0)).toBe(true);
    expect(shapes?.map(inkOutlineToSvgPath).join(' ')).toMatch(/ Z$/);
    expect(isPointHitFreehandInk(target, [0, 5], 0)).toBe(true);
    expect(isPointHitFreehandInk(target, [5, 5], 0)).toBe(false);
  });

  it('falls back when a closed imported stroke disagrees on its duplicated endpoint width', () => {
    const target = freehand(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 0],
      ],
      [2, 4, 6, 8]
    );

    expect(getFreehandInkShapes(target)).toBeNull();
    expect(getFreehandInkOutline(target)).toBeNull();
  });

  it('includes the full variable-width envelope in element bounds', () => {
    const element = freehand(
      [
        [0, 0],
        [10, 0],
      ],
      [4, 4]
    );

    expect(getFreehandRectangle(element)).toEqual({
      x: -2,
      y: -2,
      width: 14,
      height: 4,
    });
  });

  it('uses the local variable width for segment and round-cap hit testing', () => {
    const element = freehand(
      [
        [0, 0],
        [10, 0],
      ],
      [4, 4]
    );

    expect(isPointHitFreehandInk(element, [5, 1.9], 0)).toBe(true);
    expect(isPointHitFreehandInk(element, [5, 2.1], 0)).toBe(false);
    expect(isPointHitFreehandInk(element, [11.9, 0], 0)).toBe(true);
    expect(isPointHitFreehandInk(element, [12.1, 0], 0)).toBe(false);
  });

  it('does not apply the thick endpoint radius to the thin end of a taper', () => {
    const element = freehand(
      [
        [0, 0],
        [10, 0],
      ],
      [2, 10]
    );

    expect(isPointHitFreehandInk(element, [0, 4], 0)).toBe(false);
    expect(isPointHitFreehandInk(element, [10, 4], 0)).toBe(true);
  });

  it('treats a selection rectangle contained by the filled outline as a hit', () => {
    const element = freehand(
      [
        [0, 0],
        [10, 0],
      ],
      [10, 10]
    );

    expect(
      isRectangleHitFreehandInk(element, {
        x: 4.5,
        y: -0.5,
        width: 1,
        height: 1,
      })
    ).toBe(true);
  });

  it('rotates the filled outline around the element center for marquee hit testing', () => {
    const element = {
      ...freehand(
        [
          [0, 0],
          [10, 0],
        ],
        [2, 10]
      ),
      angle: 90,
    };

    expect(
      isRectangleHitFreehandInk(element, {
        x: 4.5,
        y: 2.5,
        width: 1,
        height: 1,
      })
    ).toBe(true);
    expect(
      isRectangleHitFreehandInk(element, {
        x: 8,
        y: -8,
        width: 1,
        height: 1,
      })
    ).toBe(false);
  });

  it('matches nonzero SVG fill for a self-crossing open stroke', () => {
    const element = freehand(
      [
        [0, 0],
        [20, 20],
        [0, 20],
        [20, 0],
      ],
      [12, 12, 12, 12]
    );

    expect(isPointHitFreehandInk(element, [10, 9.75], 0)).toBe(true);
    expect(
      isRectangleHitFreehandInk(element, {
        x: 9.75,
        y: 9.5,
        width: 0.5,
        height: 0.5,
      })
    ).toBe(true);
  });

  it('returns the legacy geometry fallback signal for missing or malformed ink', () => {
    const legacy = freehand([
      [0, 0],
      [10, 0],
    ]);
    const malformed = {
      ...legacy,
      ink: { version: FREEHAND_INK_SCHEMA_VERSION, widths: [4] },
    } as Freehand;

    expect(getFreehandInkOutline(legacy)).toBeNull();
    expect(getFreehandInkOutline(malformed)).toBeNull();
    expect(isPointHitFreehandInk(legacy, [5, 0], 0)).toBe(false);
    expect(isPointHitFreehandInk(malformed, [5, 0], 0)).toBe(false);
  });

  it('builds the maximum bounded outline without recursive stack growth', () => {
    const points: Point[] = Array.from({ length: MAX_FREEHAND_INK_SAMPLES }, (_, index) => [
      index,
      index % 2,
    ]);
    const widths = Array.from({ length: MAX_FREEHAND_INK_SAMPLES }, () => 2);

    const outline = buildInkOutline(points, widths);

    expect(outline).toHaveLength(MAX_FREEHAND_INK_SAMPLES * 2 + 12);
    expect(outline[0].every(Number.isFinite)).toBe(true);
    expect(outline[outline.length - 1].every(Number.isFinite)).toBe(true);
  });
});

function signedArea(points: readonly Point[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index][0] * next[1] - next[0] * points[index][1];
  }
  return area / 2;
}
