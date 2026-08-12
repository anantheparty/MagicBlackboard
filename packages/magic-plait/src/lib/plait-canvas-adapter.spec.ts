import type { MagicCanvasAdapter } from '@magic-blackboard/core';
import type {
  PlaitBoard,
  PlaitElement,
  PlaitOperation,
  Point,
  RectangleClient,
  Selection,
  Viewport,
} from '@plait/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createPlaitCanvasAdapterPlugin,
  getPlaitElementId,
  PlaitCanvasAdapter,
  withMagicPlaitAdapter,
  type PlaitCanvasAdapterHelpers,
} from './plait-canvas-adapter';

interface MockBoardState {
  selectedElements: PlaitElement[];
}

const createHarness = (elements: PlaitElement[] = []) => {
  const state: MockBoardState = { selectedElements: [] };
  const originalOnChange = vi.fn();
  const board = {
    children: elements,
    selection: null,
    viewport: { zoom: 2, origination: [10, 20] },
    theme: { themeColorMode: 'default' },
    operations: [],
    onChange: originalOnChange,
    getRectangle: (element: PlaitElement) => element.rectangle ?? null,
  } as unknown as PlaitBoard;

  const helpers: PlaitCanvasAdapterHelpers = {
    getSelectedElements: () => state.selectedElements,
    getRectangleByElements: (_board, selectedElements) => {
      const rectangles = selectedElements.map((element) => element.rectangle as RectangleClient);
      const left = Math.min(...rectangles.map((rectangle) => rectangle.x));
      const top = Math.min(...rectangles.map((rectangle) => rectangle.y));
      const right = Math.max(...rectangles.map((rectangle) => rectangle.x + rectangle.width));
      const bottom = Math.max(...rectangles.map((rectangle) => rectangle.y + rectangle.height));
      return { x: left, y: top, width: right - left, height: bottom - top };
    },
    toHostPoint: (_board, x, y) => [x - 100, y - 50],
    toHostPointFromViewBoxPoint: (_board, point) => [point[0] * 2, point[1] * 2],
    toScreenPointFromHostPoint: (_board, point) => [point[0] + 100, point[1] + 50],
    toViewBoxPoint: (_board, point) => [point[0] / 2, point[1] / 2],
  };

  const adapter = new PlaitCanvasAdapter({ helpers });
  return { adapter, board, helpers, originalOnChange, state };
};

const element = (
  id: string,
  rectangle: RectangleClient,
  children?: PlaitElement[]
): PlaitElement => ({ id, rectangle, children });

const changeBoard = (board: PlaitBoard, operations: PlaitOperation[], update: () => void): void => {
  update();
  board.operations = operations;
  board.onChange();
  board.operations = [];
};

describe('PlaitCanvasAdapter', () => {
  it('implements the shared typed canvas port', () => {
    const canvas: MagicCanvasAdapter<
      PlaitBoard,
      PlaitElement,
      Selection,
      Viewport,
      PlaitBoard['theme']
    > = new PlaitCanvasAdapter();

    expect(canvas.isAttached).toBe(false);
    expect(canvas.disposed).toBe(false);
  });

  it('captures snapshots, rich selection, and nested elements without returning live data', () => {
    const child = element('child', { x: 8, y: 9, width: 10, height: 11 });
    const root = element('root', { x: 0, y: 0, width: 20, height: 20 }, [child]);
    const { adapter, board, state } = createHarness([root]);
    const range: Selection = { anchor: [1, 2], focus: [3, 4] };
    board.selection = range;
    state.selectedElements = [child];

    adapter.attach(board);

    expect(adapter.getSelection()).toEqual({ range, elementIds: ['child'] });
    expect(adapter.getElementsByIds(['child', 'missing', 'root'])).toEqual([child, root]);
    expect(adapter.getElementsByIds(['child'])[0]).not.toBe(child);

    const snapshot = adapter.getSnapshot();
    expect(snapshot).toMatchObject({
      elements: [root],
      viewport: board.viewport,
      theme: board.theme,
      selection: { range, elementIds: ['child'] },
    });
    expect(snapshot?.elements).not.toBe(board.children);
  });

  it('returns stable empty results for an empty document and deleted element IDs', () => {
    const { adapter, board } = createHarness();
    adapter.attach(board);

    expect(adapter.getSnapshot()).toMatchObject({ elements: [] });
    expect(adapter.getElementsByIds(['deleted'])).toEqual([]);
    expect(adapter.getSelection()).toEqual({ range: null, elementIds: [] });
    expect(adapter.getSelectionBounds()).toBeNull();
  });

  it('infers compatible IDs defensively', () => {
    expect(getPlaitElementId({ id: 'normal' })).toBe('normal');
    expect(getPlaitElementId({ id: 42 })).toBe('42');
    expect(getPlaitElementId({ elementId: 'legacy' })).toBe('legacy');
    expect(getPlaitElementId({ metadata: { id: 'nested' } })).toBe('nested');
    expect(getPlaitElementId({ id: '' })).toBeNull();
    expect(getPlaitElementId(null)).toBeNull();
  });

  it('returns bounds for selected elements and safely falls back to board rectangles', () => {
    const first = element('first', { x: 10, y: 20, width: 30, height: 40 });
    const second = element('second', { x: -5, y: 30, width: 10, height: 15 });
    const { adapter, board, helpers, state } = createHarness([first, second]);
    state.selectedElements = [first, second];
    adapter.attach(board);

    expect(adapter.getSelectionBounds()).toEqual({ x: -5, y: 20, width: 45, height: 40 });

    const fallbackAdapter = new PlaitCanvasAdapter({
      helpers: {
        ...helpers,
        getRectangleByElements: () => {
          throw new Error('DOM host is not mounted');
        },
      },
    });
    fallbackAdapter.attach(board);
    expect(fallbackAdapter.getSelectionBounds()).toEqual({
      x: -5,
      y: 20,
      width: 45,
      height: 40,
    });

    state.selectedElements = [];
    expect(adapter.getSelectionBounds()).toBeNull();
  });

  it('uses the Plait conversion helper chain in both directions', () => {
    const { board, helpers } = createHarness();
    const hostFromWorld = vi.spyOn(helpers, 'toHostPointFromViewBoxPoint');
    const screenFromHost = vi.spyOn(helpers, 'toScreenPointFromHostPoint');
    const hostFromScreen = vi.spyOn(helpers, 'toHostPoint');
    const worldFromHost = vi.spyOn(helpers, 'toViewBoxPoint');
    const adapter = new PlaitCanvasAdapter({ helpers });
    adapter.attach(board);

    expect(adapter.worldToScreen([5, 10])).toEqual([110, 70]);
    expect(hostFromWorld).toHaveBeenCalledWith(board, [5, 10]);
    expect(screenFromHost).toHaveBeenCalledWith(board, [10, 20]);

    expect(adapter.screenToWorld([110, 70])).toEqual([5, 10]);
    expect(hostFromScreen).toHaveBeenCalledWith(board, 110, 70);
    expect(worldFromHost).toHaveBeenCalledWith(board, [10, 20]);
  });

  it('emits typed document, selection, and viewport changes', () => {
    const first = element('first', { x: 0, y: 0, width: 10, height: 10 });
    const { adapter, board, state } = createHarness([first]);
    const documents = vi.fn();
    const selections = vi.fn();
    const viewports = vi.fn();
    adapter.subscribe('document', documents);
    adapter.subscribe('selection', selections);
    adapter.subscribe('viewport', viewports);
    adapter.attach(board);

    const second = element('second', { x: 10, y: 10, width: 5, height: 5 });
    changeBoard(board, [{ type: 'insert_node', path: [1], node: second }], () =>
      board.children.push(second)
    );
    expect(documents).toHaveBeenCalledTimes(1);
    expect(documents.mock.calls[0][0]).toMatchObject({
      type: 'document',
      previous: { revision: 0, changedElementIds: [] },
      current: { revision: 1, changedElementIds: ['second'] },
    });
    expect(documents.mock.calls[0][0].current).not.toHaveProperty('elements');

    const range: Selection = { anchor: [0, 0], focus: [1, 1] };
    changeBoard(board, [{ type: 'set_selection', properties: null, newProperties: range }], () => {
      board.selection = range;
      state.selectedElements = [second];
    });
    expect(selections).toHaveBeenCalledTimes(1);
    expect(selections.mock.calls[0][0].current).toEqual({
      range,
      elementIds: ['second'],
    });

    const viewport: Viewport = { zoom: 3, origination: [30, 40] };
    changeBoard(
      board,
      [{ type: 'set_viewport', properties: board.viewport, newProperties: viewport }],
      () => (board.viewport = viewport)
    );
    expect(viewports).toHaveBeenCalledTimes(1);
    expect(viewports.mock.calls[0][0]).toMatchObject({
      type: 'viewport',
      current: viewport,
    });
    expect(viewports.mock.calls[0][0]).not.toHaveProperty('snapshot');
  });

  it('does not clone the full document for operation-tagged viewport changes', () => {
    const expensiveRead = vi.fn(() => 'value');
    const first = element('first', { x: 0, y: 0, width: 10, height: 10 });
    Object.defineProperty(first, 'expensiveMetadata', {
      enumerable: true,
      get: expensiveRead,
    });
    const { adapter, board } = createHarness([first]);
    adapter.attach(board);
    expensiveRead.mockClear();

    const viewport: Viewport = { zoom: 3, origination: [30, 40] };
    changeBoard(
      board,
      [{ type: 'set_viewport', properties: board.viewport, newProperties: viewport }],
      () => (board.viewport = viewport)
    );

    expect(expensiveRead).not.toHaveBeenCalled();
  });

  it('summarizes changed IDs without cloning the document during set-node changes', () => {
    const expensiveRead = vi.fn(() => 'value');
    const first = element('first', { x: 0, y: 0, width: 10, height: 10 });
    Object.defineProperty(first, 'expensiveMetadata', {
      enumerable: true,
      get: expensiveRead,
    });
    const { adapter, board } = createHarness([first]);
    const documents = vi.fn();
    adapter.subscribe('document', documents);
    adapter.attach(board);
    expensiveRead.mockClear();

    changeBoard(
      board,
      [{ type: 'set_node', path: [0], properties: {}, newProperties: { angle: 15 } }],
      () => (first.angle = 15)
    );

    expect(documents).toHaveBeenCalledWith(
      expect.objectContaining({
        current: expect.objectContaining({ revision: 1, changedElementIds: ['first'] }),
      })
    );
    expect(expensiveRead).not.toHaveBeenCalled();
  });

  it('supports an early plugin seam and idempotent detach/dispose cleanup', () => {
    const { adapter, board, originalOnChange } = createHarness();
    const plugin = createPlaitCanvasAdapterPlugin(adapter);
    expect(plugin(board)).toBe(board);
    expect(withMagicPlaitAdapter(adapter)(board)).toBe(board);
    const pluginOnChange = board.onChange;
    expect(pluginOnChange).not.toBe(originalOnChange);

    const viewportListener = vi.fn();
    const unsubscribe = adapter.subscribe('viewport', viewportListener);
    adapter.attach(board);
    adapter.attach(board);
    changeBoard(board, [], () => (board.viewport = { zoom: 4 }));
    expect(originalOnChange).toHaveBeenCalledTimes(1);
    expect(viewportListener).toHaveBeenCalledTimes(1);

    unsubscribe();
    unsubscribe();
    adapter.detach();
    adapter.detach();
    board.onChange();
    expect(viewportListener).toHaveBeenCalledTimes(1);

    adapter.dispose();
    adapter.dispose();
    expect(board.onChange).toBe(originalOnChange);
    expect(adapter.isAttached).toBe(false);
    expect(adapter.disposed).toBe(true);
    expect(() => adapter.getSnapshot()).toThrow(/not attached/);
    expect(() => adapter.attach(board)).toThrow(/disposed/);
  });

  it('switches attached boards without leaving a direct listener behind', () => {
    const first = createHarness();
    const second = createHarness();
    first.adapter.attach(first.board);
    expect(first.board.onChange).not.toBe(first.originalOnChange);

    first.adapter.attach(second.board);
    expect(first.board.onChange).toBe(first.originalOnChange);
    expect(second.board.onChange).not.toBe(second.originalOnChange);
    expect(first.adapter.isAttached).toBe(true);
  });

  it('rolls back a partial attach when initial state capture fails', () => {
    const harness = createHarness();
    Object.defineProperty(harness.board, 'viewport', {
      configurable: true,
      get: () => {
        throw new Error('synthetic viewport failure');
      },
    });

    expect(() => harness.adapter.attach(harness.board)).toThrow('synthetic viewport failure');
    expect(harness.adapter.isAttached).toBe(false);
    expect(harness.board.onChange).toBe(harness.originalOnChange);
    expect(() => harness.adapter.getSnapshot()).toThrow(/not attached/);
  });

  it('restores a directly installed board listener on detach and isolates listener errors', () => {
    const listenerError = new Error('console failed');
    const onListenerError = vi.fn();
    const { board, helpers, originalOnChange } = createHarness();
    const adapter = new PlaitCanvasAdapter({ helpers, onListenerError });
    adapter.subscribe('viewport', () => {
      throw listenerError;
    });
    adapter.attach(board);
    expect(board.onChange).not.toBe(originalOnChange);

    changeBoard(board, [], () => (board.viewport = { zoom: 5 }));
    expect(onListenerError).toHaveBeenCalledWith(listenerError);

    adapter.detach();
    expect(board.onChange).toBe(originalOnChange);
    expect(adapter.getSelection()).toEqual({ range: null, elementIds: [] });
    expect(() => adapter.worldToScreen([0, 0] as Point)).toThrow(/not attached/);
  });
});
