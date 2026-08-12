import type { PlaitElement } from '@plait/core';
import { describe, expect, it } from 'vitest';
import { normalizeTtdElementsForInsertion } from './normalize-elements-for-insertion';

describe('normalizeTtdElementsForInsertion', () => {
  it('removes the Markdown-only root marker without mutating preview data', () => {
    const mind = {
      id: 'mind-root',
      type: 'mindmap',
      isRoot: true,
      points: [[0, 0]],
      data: { topic: { children: [{ text: 'Root' }] } },
      children: [],
    } as unknown as PlaitElement;

    const [normalized] = normalizeTtdElementsForInsertion([mind]);

    expect(normalized).not.toBe(mind);
    expect(normalized).not.toHaveProperty('isRoot');
    expect(mind).toHaveProperty('isRoot', true);
  });

  it('removes only derived Mermaid arrow-text dimensions and preserves valid content', () => {
    const arrow = {
      id: 'arrow',
      type: 'arrow-line',
      shape: 'curve',
      points: [
        [0, 0],
        [100, 100],
      ],
      source: { marker: 'none' },
      target: { marker: 'arrow' },
      texts: [
        {
          id: 'arrow-label',
          position: 0.5,
          text: { children: [{ text: 'Label', bold: true }] },
          width: 48,
          height: 20,
        },
      ],
    } as unknown as PlaitElement;

    const [normalized] = normalizeTtdElementsForInsertion([arrow]);

    expect(normalized).toMatchObject({
      id: 'arrow',
      points: [
        [0, 0],
        [100, 100],
      ],
      texts: [
        {
          id: 'arrow-label',
          position: 0.5,
          text: { children: [{ text: 'Label', bold: true }] },
        },
      ],
    });
    expect((normalized as Record<string, unknown>).texts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ width: expect.anything() })])
    );
    expect((arrow as Record<string, unknown>).texts).toEqual([
      expect.objectContaining({ width: 48, height: 20 }),
    ]);
  });
});
