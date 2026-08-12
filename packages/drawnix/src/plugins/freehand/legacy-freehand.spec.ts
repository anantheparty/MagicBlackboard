import { describe, expect, it } from 'vitest';
import legacyDocument from './__fixtures__/legacy-freehand-v1.drawnix.json';
import { isValidDrawnixData, serializeAsJSON } from '../../data/json';
import { MAX_FREEHAND_INK_SAMPLES } from './ink/types';

describe('legacy freehand v1 fixture', () => {
  it('captures the pre-pressure Point[] element contract', () => {
    expect(isValidDrawnixData(legacyDocument)).toBe(true);
    const element = legacyDocument.elements[0];

    expect(element).toEqual({
      id: 'legacy-freehand-v1',
      type: 'freehand',
      shape: 'feltTipPen',
      points: [
        [120, 140],
        [136, 148],
        [154, 143],
        [176, 158],
        [201, 150],
      ],
      strokeColor: '#1d1d1f',
      strokeWidth: 2,
    });
    expect(element).not.toHaveProperty('ink');
  });

  it('exports the legacy element without adding optional pressure data', () => {
    const board = {
      children: legacyDocument.elements,
      theme: legacyDocument.theme,
      viewport: legacyDocument.viewport,
    };

    expect(JSON.parse(serializeAsJSON(board as never))).toEqual(legacyDocument);
  });

  it('keeps legacy/default-off strokes readable beyond the pressure sample cap', () => {
    const points = Array.from({ length: MAX_FREEHAND_INK_SAMPLES + 1 }, (_, index) => [index, 0]);
    const element = {
      ...legacyDocument.elements[0],
      id: 'legacy-beyond-pressure-cap',
      points,
    };
    const document = { ...legacyDocument, elements: [element] };

    expect(isValidDrawnixData(document)).toBe(true);
    expect(
      JSON.parse(
        serializeAsJSON({
          children: document.elements,
          viewport: document.viewport,
          theme: document.theme,
        } as never)
      ).elements[0]
    ).toEqual(element);
  });
});
