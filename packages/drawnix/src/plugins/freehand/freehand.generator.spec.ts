import { PlaitBoard, setupTestingBoard, withOptions } from '@plait/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FREEHAND_INK_SCHEMA_VERSION } from './ink/types';
import { FreehandGenerator } from './freehand.generator';
import { FreehandShape, type Freehand } from './type';

const fixtures: Array<ReturnType<typeof setupTestingBoard>> = [];

class TestFreehandGenerator extends FreehandGenerator {
  render(element: Freehand) {
    return this.draw(element);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  while (fixtures.length > 0) fixtures.pop()?.destroy();
});

function element(ink?: unknown): Freehand {
  return {
    id: 'renderer-ink',
    type: 'freehand',
    shape: FreehandShape.feltTipPen,
    points: [
      [0, 0],
      [10, 0],
    ],
    strokeColor: '#123456',
    strokeWidth: 4,
    ...(ink === undefined ? {} : { ink }),
  } as Freehand;
}

describe('FreehandGenerator ink compatibility', () => {
  it('renders valid open v1 ink as one filled SVG outline', () => {
    const target = element({ version: FREEHAND_INK_SCHEMA_VERSION, widths: [2, 6] });
    const fixture = setupTestingBoard([withOptions], [target], { withRoughSVG: true });
    fixtures.push(fixture);

    const rendered = new TestFreehandGenerator(fixture.board).render(target);
    const path = rendered?.querySelector('path');

    expect(path?.getAttribute('data-freehand-ink-version')).toBe('1');
    expect(path?.getAttribute('fill')).toBe('#123456');
    expect(path?.getAttribute('fill-rule')).toBe('nonzero');
    expect(path?.getAttribute('stroke')).toBe('none');
    expect(path?.getAttribute('d')).toMatch(/^M .* Z$/);
  });

  it('renders closed v1 ink shapes as one bounded filled path', () => {
    const target = {
      ...element(),
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      ink: { version: FREEHAND_INK_SCHEMA_VERSION, widths: [2, 2, 2, 2, 2] },
    } as Freehand;
    const fixture = setupTestingBoard([withOptions], [target], { withRoughSVG: true });
    fixtures.push(fixture);

    const rendered = new TestFreehandGenerator(fixture.board).render(target);

    expect(rendered?.querySelectorAll('path[data-freehand-ink-version="1"]')).toHaveLength(1);
  });

  it.each([
    ['legacy', undefined],
    ['unknown version', { version: 2, widths: [2, 6] }],
    ['misaligned widths', { version: FREEHAND_INK_SCHEMA_VERSION, widths: [2] }],
    ['non-finite widths', { version: FREEHAND_INK_SCHEMA_VERSION, widths: [2, Number.NaN] }],
    [
      'sparse widths',
      {
        version: FREEHAND_INK_SCHEMA_VERSION,
        widths: Object.assign(Object.assign([] as number[], { length: 2 }), { 0: 2 }),
      },
    ],
    [
      'closed endpoint width mismatch',
      { version: FREEHAND_INK_SCHEMA_VERSION, widths: [2, 4, 6, 8, 10] },
    ],
  ])('keeps the RoughJS fallback for %s input', (_name, ink) => {
    const target =
      _name === 'closed endpoint width mismatch'
        ? ({
            ...element(),
            points: [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
              [0, 0],
            ],
            ink,
          } as Freehand)
        : element(ink);
    const fixture = setupTestingBoard([withOptions], [target], { withRoughSVG: true });
    fixtures.push(fixture);
    const rough = PlaitBoard.getRoughSVG(fixture.board);
    const curve = vi.spyOn(rough, 'curve');

    const rendered = new TestFreehandGenerator(fixture.board).render(target);

    expect(curve).toHaveBeenCalledOnce();
    expect(rendered?.querySelector('[data-freehand-ink-version]')).toBeNull();
  });
});
