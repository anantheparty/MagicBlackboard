import { parseMermaidToDrawnix } from '@plait-board/mermaid-to-drawnix';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 100, height: 20 }),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({
      font: '',
      measureText: (text: string) => ({ width: text.length * 8 }),
    }),
  });
});

afterAll(() => {
  Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'getContext');
});

describe('Mermaid compatibility override', () => {
  it('converts a basic flowchart with the security-patched transitive versions', async () => {
    const result = await parseMermaidToDrawnix('flowchart LR\n  A[Start] --> B[Finish]');

    expect(result.elements.length).toBeGreaterThan(0);
  });
});
