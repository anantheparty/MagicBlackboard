import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  boardDisposers: new WeakMap<object, Set<() => void>>(),
  insertNode: vi.fn(),
  laserDestroy: vi.fn(),
  laserInit: vi.fn(),
  removeElements: vi.fn(),
}));

vi.mock('@plait/common', () => ({
  isDrawingMode: () => true,
}));

vi.mock('@plait-board/react-board', () => ({
  isTwoFingerMode: () => false,
  registerBoardDisposer: (board: object, dispose: () => void) => {
    const disposers = mocks.boardDisposers.get(board) ?? new Set<() => void>();
    disposers.add(dispose);
    mocks.boardDisposers.set(board, disposers);
    return () => disposers.delete(dispose);
  },
  setBoardPointerLifecycleHandler: () => () => undefined,
}));

vi.mock('@plait/core', () => ({
  CoreTransforms: {
    removeElements: mocks.removeElements,
  },
  DEFAULT_COLOR: '#000000',
  PlaitBoard: {
    getElementTopHost: () => ({}),
    getPointer: (board: { pointer: string }) => board.pointer,
    isInPointer: (board: { pointer: string }, pointers: string[]) =>
      pointers.includes(board.pointer),
  },
  PlaitElement: {
    getElementG: () => ({ style: {} }),
  },
  ThemeColorMode: {
    colorful: 'colorful',
    dark: 'dark',
    default: 'default',
    retro: 'retro',
    soft: 'soft',
    starry: 'starry',
  },
  Transforms: {
    insertNode: mocks.insertNode,
  },
  distanceBetweenPointAndPoint: (x1: number, y1: number, x2: number, y2: number) =>
    Math.hypot(x2 - x1, y2 - y1),
  isMainPointer: (event: MouseEvent) => event.button === 0,
  throttleRAF: (_board: unknown, _key: string, callback: () => void) => callback(),
  toHostPoint: (_board: unknown, x: number, y: number) => [x, y],
  toViewBoxPoint: (_board: unknown, point: [number, number]) => point,
}));

vi.mock('./freehand.generator', () => ({
  FreehandGenerator: class {
    destroy = vi.fn();
    processDrawing = vi.fn();
  },
}));

vi.mock('./smoother', () => ({
  FreehandSmoother: class {
    process(point: [number, number]) {
      return point;
    }
    reset = vi.fn();
  },
}));

vi.mock('../../utils/laser-pointer', () => ({
  LaserPointer: class {
    destroy = mocks.laserDestroy;
    init = mocks.laserInit;
  },
}));

import { withFreehandCreate } from './with-freehand-create';
import { withFreehandErase } from './with-freehand-erase';
import { FreehandShape } from './type';

const createPointerEvent = (button: number) =>
  ({
    button,
    isPrimary: true,
    x: 10,
    y: 10,
  }) as PointerEvent;

const unmountBoard = (board: object) => {
  const disposers = mocks.boardDisposers.get(board);
  mocks.boardDisposers.delete(board);
  disposers?.forEach((dispose) => dispose());
};

const createBoard = (pointer: string) => ({
  apply: vi.fn(),
  children: [],
  getPluginOptions: vi.fn(),
  globalPointerUp: vi.fn(),
  pointer,
  pointerCancel: vi.fn(),
  pointerDown: vi.fn(),
  pointerMove: vi.fn(),
  pointerUp: vi.fn(),
  setPluginOptions: vi.fn(),
  theme: {
    themeColorMode: 'default',
  },
  touchStart: vi.fn(),
  viewport: { zoom: 1 },
});

beforeEach(() => {
  mocks.boardDisposers = new WeakMap<object, Set<() => void>>();
  mocks.insertNode.mockClear();
  mocks.laserDestroy.mockClear();
  mocks.laserInit.mockClear();
  mocks.removeElements.mockClear();
});

describe('freehand pointer buttons', () => {
  it('does not start freehand drawing from the middle mouse button', () => {
    const board = createBoard(FreehandShape.feltTipPen);
    const originalPointerDown = board.pointerDown;

    withFreehandCreate(board as any);

    board.pointerDown(createPointerEvent(1));
    board.pointerMove(createPointerEvent(1));
    board.pointerUp(createPointerEvent(1));

    expect(originalPointerDown).toHaveBeenCalledOnce();
    expect(mocks.insertNode).not.toHaveBeenCalled();
  });

  it('does not start freehand erasing from the middle mouse button', () => {
    const board = createBoard(FreehandShape.eraser);
    const originalPointerDown = board.pointerDown;

    withFreehandErase(board as any);

    board.pointerDown(createPointerEvent(1));
    board.pointerMove(createPointerEvent(1));
    board.pointerUp(createPointerEvent(1));

    expect(originalPointerDown).toHaveBeenCalledOnce();
    expect(mocks.removeElements).not.toHaveBeenCalled();
  });

  it('silently tears down an active eraser once on generic board unmount', () => {
    const firstBoard = createBoard(FreehandShape.eraser);
    withFreehandErase(firstBoard as any);

    firstBoard.pointerDown(createPointerEvent(0));
    expect(mocks.laserInit).toHaveBeenCalledOnce();

    unmountBoard(firstBoard);
    unmountBoard(firstBoard);
    expect(mocks.laserDestroy).toHaveBeenCalledOnce();
    expect(mocks.removeElements).not.toHaveBeenCalled();

    const secondBoard = createBoard(FreehandShape.eraser);
    withFreehandErase(secondBoard as any);
    secondBoard.pointerDown(createPointerEvent(0));
    secondBoard.pointerUp(createPointerEvent(0));

    expect(mocks.laserInit).toHaveBeenCalledTimes(2);
    expect(mocks.laserDestroy).toHaveBeenCalledTimes(2);
  });
});
