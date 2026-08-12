import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  PlaitBoard,
  ThemeColorMode,
  addSelectedElement,
  getSelectedElements,
  PlaitElement,
} from '@plait/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Drawnix } from '../../../drawnix';
import { isValidDrawnixData, loadFromJSON } from '../../../data/json';
import { MAX_DRAWNIX_FILE_ELEMENTS } from '../../../constants';
import { FREEHAND_INK_SCHEMA_VERSION } from '../../../plugins/freehand/ink/types';
import { FreehandShape, type Freehand } from '../../../plugins/freehand/type';

const mocks = vi.hoisted(() => ({
  fileOpen: vi.fn(),
  fileSave: vi.fn(),
}));

vi.mock('../../../data/filesystem', () => ({
  fileOpen: mocks.fileOpen,
  fileSave: mocks.fileSave,
  nativeFileSystemSupported: false,
}));

const originalElement: Freehand = {
  id: 'original-document-stroke',
  type: 'freehand',
  shape: FreehandShape.feltTipPen,
  points: [
    [0, 0],
    [10, 10],
  ],
  strokeColor: '#111111',
  strokeWidth: 2,
};

const importedElement: Freehand = {
  id: 'imported-variable-ink',
  type: 'freehand',
  shape: FreehandShape.feltTipPen,
  points: [
    [20, 30],
    [40, 50],
    [70, 65],
  ],
  strokeColor: '#123456',
  strokeWidth: 4,
  ink: {
    version: FREEHAND_INK_SCHEMA_VERSION,
    widths: [2, 4, 7],
  },
};

const importedLegacyElement: Freehand = {
  id: 'imported-legacy-ink',
  type: 'freehand',
  shape: FreehandShape.feltTipPen,
  points: [
    [80, 90],
    [100, 110],
  ],
  strokeColor: '#abcdef',
  strokeWidth: 3,
};

const importedElements = [importedElement, importedLegacyElement];

const importedViewport = { zoom: 1.5, origination: [4, 8] as [number, number] };
const importedTheme = { themeColorMode: ThemeColorMode.dark };

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

beforeEach(() => {
  mocks.fileOpen.mockReset();
  mocks.fileSave.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('.drawnix document replacement', () => {
  it('accepts a valid acyclic group chain', () => {
    expect(
      isValidDrawnixData({
        type: 'drawnix',
        version: 1,
        source: 'web',
        elements: [
          { id: 'outer-group', type: 'group' },
          { id: 'inner-group', type: 'group', groupId: 'outer-group' },
          { ...importedLegacyElement, groupId: 'inner-group' },
        ],
        viewport: importedViewport,
        theme: importedTheme,
      })
    ).toBe(true);
  });

  it('loads valid v1 variable ink and commits one complete replacement event', async () => {
    const file = drawnixFile({
      type: 'drawnix',
      version: 1,
      source: 'web',
      elements: importedElements,
      viewport: importedViewport,
      theme: importedTheme,
    });
    mocks.fileOpen.mockResolvedValue(file);
    const onChange = vi.fn();
    const onSelectionChange = vi.fn();
    const onThemeChange = vi.fn();
    const onValueChange = vi.fn();
    const onViewportChange = vi.fn();
    let board: PlaitBoard | null = null;

    render(
      <Drawnix
        value={[originalElement]}
        afterInit={(initializedBoard) => {
          board = initializedBoard;
        }}
        onChange={onChange}
        onSelectionChange={onSelectionChange}
        onThemeChange={onThemeChange}
        onValueChange={onValueChange}
        onViewportChange={onViewportChange}
      />
    );
    await waitFor(() => expect(board).not.toBeNull());
    const initializedBoard = board as unknown as PlaitBoard;
    initializedBoard.selection = { anchor: [0, 0], focus: [10, 10] };
    addSelectedElement(initializedBoard, initializedBoard.children[0]);
    initializedBoard.history.undos = [{ operations: [] }] as never;
    initializedBoard.history.redos = [{ operations: [] }] as never;
    vi.spyOn(
      PlaitBoard.getBoardContainer(initializedBoard),
      'getBoundingClientRect'
    ).mockReturnValue({
      bottom: 40,
      height: 40,
      left: 0,
      right: 40,
      top: 0,
      width: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    onChange.mockClear();
    onSelectionChange.mockClear();
    onThemeChange.mockClear();
    onValueChange.mockClear();
    onViewportChange.mockClear();

    fireEvent.pointerDown(screen.getByRole('button', { name: '应用菜单' }));
    fireEvent.click(await screen.findByTestId('open-button'));

    await waitFor(() => expect(initializedBoard.children).toEqual(importedElements));
    expect((initializedBoard.children[0] as Freehand).ink).toEqual(importedElement.ink);
    const fittedViewport = initializedBoard.viewport;
    expect(fittedViewport.zoom).toBe(MIN_ZOOM);
    expect(fittedViewport.origination).toEqual([expect.any(Number), expect.any(Number)]);
    expect(initializedBoard.theme).toEqual(importedTheme);
    expect(initializedBoard.selection).toBeNull();
    expect(getSelectedElements(initializedBoard)).toEqual([]);
    expect(initializedBoard.history.undos).toEqual([]);
    expect(initializedBoard.history.redos).toEqual([]);
    expect(initializedBoard.operations).toEqual([]);
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({
      children: importedElements,
      operations: [],
      viewport: fittedViewport,
      selection: null,
      theme: importedTheme,
      source: 'document-replace',
    });
    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith(importedElements);
    expect(onSelectionChange).toHaveBeenCalledOnce();
    expect(onSelectionChange).toHaveBeenCalledWith(null);
    expect(onViewportChange).toHaveBeenCalledOnce();
    expect(onViewportChange).toHaveBeenCalledWith(fittedViewport);
    expect(onThemeChange).toHaveBeenCalledOnce();
    expect(onThemeChange).toHaveBeenCalledWith(ThemeColorMode.dark);
  });

  it('recreates render ownership when an imported element reuses an id with a new type', async () => {
    const replacement = {
      id: originalElement.id,
      type: 'geometry',
      shape: 'rectangle',
      points: [
        [20, 30],
        [120, 90],
      ],
      text: { children: [{ text: 'Replacement' }] },
    } as unknown as PlaitElement;
    mocks.fileOpen.mockResolvedValue(
      drawnixFile({
        type: 'drawnix',
        version: 1,
        source: 'web',
        elements: [replacement],
        viewport: importedViewport,
        theme: importedTheme,
      })
    );
    let board: PlaitBoard | null = null;
    render(
      <Drawnix
        value={[originalElement]}
        afterInit={(initializedBoard) => {
          board = initializedBoard;
        }}
      />
    );
    await waitFor(() => expect(board).not.toBeNull());
    const initializedBoard = board as unknown as PlaitBoard;
    const previousRef = PlaitElement.getElementRef(initializedBoard.children[0]);

    fireEvent.pointerDown(screen.getByRole('button', { name: '应用菜单' }));
    fireEvent.click(await screen.findByTestId('open-button'));

    await waitFor(() => expect(initializedBoard.children).toEqual([replacement]));
    const replacementRef = PlaitElement.getElementRef(initializedBoard.children[0]);
    expect(replacementRef).not.toBe(previousRef);
  });

  it.each([
    ['wrong envelope', { type: 'not-drawnix' }],
    ['unknown element type', { elements: [{ id: 'bad', type: 'unknown' }] }],
    [
      'duplicate element ids',
      { elements: [importedElement, { ...importedLegacyElement, id: importedElement.id }] },
    ],
    [
      'a self-referencing group',
      {
        elements: [
          {
            id: 'self-grouped-shape',
            type: 'geometry',
            shape: 'rectangle',
            groupId: 'self-grouped-shape',
            points: [
              [0, 0],
              [100, 100],
            ],
            text: { type: 'paragraph', children: [{ text: '' }] },
          },
        ],
      },
    ],
    [
      'a cyclic group graph',
      {
        elements: [
          { id: 'group-a', type: 'group', groupId: 'group-b' },
          { id: 'group-b', type: 'group', groupId: 'group-a' },
        ],
      },
    ],
    [
      'a group reference to a non-group element',
      {
        elements: [
          {
            id: 'shape-a',
            type: 'geometry',
            shape: 'rectangle',
            points: [
              [0, 0],
              [100, 100],
            ],
            text: { type: 'paragraph', children: [{ text: '' }] },
          },
          { ...importedLegacyElement, groupId: 'shape-a' },
        ],
      },
    ],
    [
      'geometry without required text',
      {
        elements: [
          {
            id: 'incomplete-geometry',
            type: 'geometry',
            shape: 'rectangle',
            points: [
              [0, 0],
              [100, 100],
            ],
          },
        ],
      },
    ],
    [
      'unknown freehand shape',
      { elements: [{ ...importedLegacyElement, shape: 'future-pressure-brush' }] },
    ],
    ['unknown theme', { theme: { themeColorMode: 'future-theme' } }],
    [
      'theme metadata outside the exact schema',
      {
        theme: {
          themeColorMode: ThemeColorMode.default,
          eventHistory: [[10, 20, 0.8, 42]],
        },
      },
    ],
    ['unsafe viewport zoom', { viewport: { zoom: MAX_ZOOM + 1 } }],
    [
      'a document above the total element budget',
      {
        elements: Array.from({ length: MAX_DRAWNIX_FILE_ELEMENTS + 1 }, (_, index) => ({
          id: `group-${index}`,
          type: 'group',
        })),
      },
    ],
    [
      'viewport metadata outside the exact schema',
      {
        viewport: {
          ...importedViewport,
          inputHistory: [[10, 20, 0.8, 42]],
        },
      },
    ],
    [
      'unsafe element coordinate',
      {
        elements: [
          {
            ...importedLegacyElement,
            points: [
              [0, 0],
              [1_000_000_001, 0],
            ],
          },
        ],
      },
    ],
  ])('rejects %s without mutating the existing board document', async (_name, patch) => {
    const board = {
      children: [originalElement] as PlaitElement[],
      history: {
        undos: [{ operations: ['existing-undo'] }],
        redos: [{ operations: ['existing-redo'] }],
      },
      selection: { anchor: [0, 0], focus: [10, 10] },
      theme: { themeColorMode: ThemeColorMode.default },
      viewport: { zoom: 2, origination: [100, 200] },
    };
    const before = structuredClone(board);
    const candidate = {
      type: 'drawnix',
      version: 1,
      source: 'web',
      elements: importedElements,
      viewport: importedViewport,
      theme: importedTheme,
      ...patch,
    };
    mocks.fileOpen.mockResolvedValue(drawnixFile(candidate));

    await expect(loadFromJSON(board as unknown as PlaitBoard)).rejects.toThrow(
      'Error: invalid file'
    );

    expect(board).toEqual(before);
  });
});

function drawnixFile(value: unknown): File {
  return new File([JSON.stringify(value)], 'fixture.drawnix', {
    type: 'application/vnd.drawnix+json',
  });
}
