import { describe, expect, it } from 'vitest';
import legacyDocument from './__fixtures__/legacy-freehand-v1.drawnix.json';
import { isValidDrawnixData, serializeAsJSON } from '../../data/json';

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
});
