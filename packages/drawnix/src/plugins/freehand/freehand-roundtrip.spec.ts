import {
  WritableClipboardOperationType,
  setupTestingBoard,
  withBoard,
  withHistory,
  withOptions,
} from '@plait/core';
import { afterEach, describe, expect, it } from 'vitest';
import { loadFromBlob, normalizeFile, parseFileContents } from '../../data/blob';
import {
  DrawnixDocumentValidationError,
  isValidDrawnixData,
  serializeAsJSON,
} from '../../data/json';
import { MAX_DRAWNIX_FILE_BYTES, MAX_DRAWNIX_FILE_ELEMENTS } from '../../constants';
import { FREEHAND_INK_SCHEMA_VERSION, MAX_FREEHAND_INK_SAMPLES } from './ink/types';
import pressureInkDocument from './__fixtures__/pressure-ink-v1.drawnix.json';
import { FreehandShape, type Freehand } from './type';
import { withFreehandFragment } from './with-freehand-fragment';

const fixtures: Array<ReturnType<typeof setupTestingBoard>> = [];

afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()?.destroy();
});

function variableInk(): Freehand {
  return {
    id: 'roundtrip-ink',
    type: 'freehand',
    shape: FreehandShape.feltTipPen,
    points: [
      [10, 20],
      [30, 40],
    ],
    strokeColor: '#123456',
    strokeWidth: 4,
    ink: { version: FREEHAND_INK_SCHEMA_VERSION, widths: [2, 6] },
  };
}

describe('freehand ink document round trips', () => {
  it('rejects an oversized file before reading or parsing its contents', async () => {
    let textRead = false;
    const oversized = {
      size: MAX_DRAWNIX_FILE_BYTES + 1,
      text: async () => {
        textRead = true;
        return '{}';
      },
    } as unknown as Blob;

    await expect(loadFromBlob({} as never, oversized)).rejects.toThrow('Error: invalid file');
    expect(textRead).toBe(false);
  });

  it('rejects an oversized untyped file before normalizing its contents', async () => {
    let arrayBufferRead = false;
    const oversized = {
      name: 'oversized.drawnix',
      size: MAX_DRAWNIX_FILE_BYTES + 1,
      type: '',
      arrayBuffer: async () => {
        arrayBufferRead = true;
        return new ArrayBuffer(0);
      },
    } as unknown as File;

    await expect(normalizeFile(oversized)).rejects.toThrow('Error: invalid file');
    expect(arrayBufferRead).toBe(false);
  });

  it.each(['error', 'abort'] as const)('rejects a Safari FileReader %s', async (outcome) => {
    const OriginalFileReader = globalThis.FileReader;
    class SyntheticFileReader {
      result: string | ArrayBuffer | null = null;
      error = outcome === 'error' ? new Error('synthetic read failure') : null;
      onabort: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      readAsText() {
        if (outcome === 'error') this.onerror?.();
        else this.onabort?.();
      }
    }
    Object.defineProperty(globalThis, 'FileReader', {
      configurable: true,
      value: SyntheticFileReader,
    });
    const legacyBlob = { size: 1, text: undefined } as unknown as Blob;
    try {
      await expect(parseFileContents(legacyBlob)).rejects.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'FileReader', {
        configurable: true,
        value: OriginalFileReader,
      });
    }
  });

  it('accepts the element budget boundary and rejects one element above it', () => {
    const elements = Array.from({ length: MAX_DRAWNIX_FILE_ELEMENTS }, (_, index) => ({
      id: `group-${index}`,
      type: 'group',
    }));
    const document = {
      type: 'drawnix',
      version: 1,
      source: 'web',
      elements,
      viewport: { zoom: 1 },
      theme: { themeColorMode: 'default' },
    };

    expect(isValidDrawnixData(document)).toBe(true);
    expect(
      isValidDrawnixData({
        ...document,
        elements: [...elements, { id: 'one-too-many', type: 'group' }],
      })
    ).toBe(false);
    expect(() =>
      serializeAsJSON({
        children: [...elements, { id: 'one-too-many', type: 'group' }],
        viewport: document.viewport,
        theme: document.theme,
      } as never)
    ).toThrow(DrawnixDocumentValidationError);
  });

  it('preserves valid v1 ink through .drawnix export and import', async () => {
    const target = pressureInkDocument.elements[0] as unknown as Freehand;
    const board = {
      children: [target],
      viewport: pressureInkDocument.viewport,
      theme: pressureInkDocument.theme,
    };

    const serialized = serializeAsJSON(board as never);
    const loaded = await loadFromBlob(
      board as never,
      new Blob([serialized], { type: 'application/vnd.drawnix+json' })
    );

    expect(loaded.elements).toEqual([target]);
    expect(loaded.elements[0].ink).toEqual(target.ink);
  });

  it('round-trips multiple creator-valid maximum pressure strokes within the file budget', async () => {
    const points = Array.from({ length: MAX_FREEHAND_INK_SAMPLES }, (_, index) => [
      index,
      index % 17,
    ]);
    const widths = Array.from({ length: MAX_FREEHAND_INK_SAMPLES }, (_, index) =>
      index % 2 === 0 ? 2 : 6
    );
    const elements = Array.from({ length: 4 }, (_, index) => ({
      id: `maximum-pressure-${index}`,
      type: 'freehand',
      shape: FreehandShape.feltTipPen,
      points,
      strokeWidth: 4,
      ink: { version: FREEHAND_INK_SCHEMA_VERSION, widths },
    }));
    const board = {
      children: elements,
      viewport: { zoom: 1 },
      theme: { themeColorMode: 'default' },
    };

    const serialized = serializeAsJSON(board as never);
    const loaded = await loadFromBlob(
      board as never,
      new Blob([serialized], { type: 'application/vnd.drawnix+json' })
    );

    expect(loaded.elements).toHaveLength(4);
    expect(loaded.elements.every((element) => element.ink?.widths.length === points.length)).toBe(
      true
    );
  });

  it('preserves aligned widths through copy, paste, undo, redo, clear, and restore', async () => {
    const target = variableInk();
    const fixture = setupTestingBoard(
      [withOptions, withBoard, withHistory, withFreehandFragment],
      [target],
      {
        selectedElements: [target],
        withElementHost: false,
        withHost: false,
      }
    );
    fixtures.push(fixture);
    const { board } = fixture;
    const clipboard = board.buildFragment(
      null,
      { x: 0, y: 0, width: 100, height: 100 },
      WritableClipboardOperationType.copy
    );
    expect(clipboard?.elements[0].ink).toEqual(target.ink);

    const pastedData = JSON.parse(JSON.stringify(clipboard?.elements)) as Freehand[];
    board.insertFragment({ elements: pastedData }, [100, 100]);
    await Promise.resolve();
    expect(board.children).toHaveLength(2);
    expect((board.children[1] as Freehand).ink).toEqual(target.ink);

    board.undo();
    await Promise.resolve();
    expect(board.children).toHaveLength(1);
    board.redo();
    await Promise.resolve();
    expect(board.children).toHaveLength(2);
    expect((board.children[1] as Freehand).ink).toEqual(target.ink);

    const pasted = board.children[1] as Freehand;
    board.deleteFragment([pasted]);
    await Promise.resolve();
    expect(board.children).toHaveLength(1);
    board.undo();
    await Promise.resolve();
    expect(board.children).toHaveLength(2);
    expect((board.children[1] as Freehand).ink).toEqual(target.ink);

    board.deleteFragment([...board.children]);
    await Promise.resolve();
    expect(board.children).toHaveLength(0);
    board.undo();
    await Promise.resolve();
    expect(board.children).toHaveLength(2);
    expect((board.children[0] as Freehand).ink).toEqual(target.ink);
    expect((board.children[1] as Freehand).ink).toEqual(target.ink);
  });
});
