import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  drawingMode: true,
  generatorDestroy: vi.fn(),
  generatorProcessDrawing: vi.fn(),
  insertNode: vi.fn(),
  lifecycleDisposers: [] as Array<ReturnType<typeof vi.fn>>,
  lifecycleHandlers: new WeakMap<object, (event: LifecycleEvent) => void>(),
  boardDisposers: new WeakMap<object, Set<() => void>>(),
  nextElementId: 0,
  twoFingerMode: false,
}));

type LifecycleEvent = {
  readonly reason:
    | 'pointer-cancel'
    | 'lost-pointer-capture'
    | 'orientation-change'
    | 'viewport-change';
  readonly pointerId?: number;
};

vi.mock('@plait/common', () => ({
  isDrawingMode: () => mocks.drawingMode,
}));

vi.mock('@plait-board/react-board', () => ({
  isTwoFingerMode: () => mocks.twoFingerMode,
  registerBoardDisposer: (board: object, dispose: () => void) => {
    const disposers = mocks.boardDisposers.get(board) ?? new Set<() => void>();
    disposers.add(dispose);
    mocks.boardDisposers.set(board, disposers);
    return () => {
      disposers.delete(dispose);
      if (disposers.size === 0) {
        mocks.boardDisposers.delete(board);
      }
    };
  },
  setBoardPointerLifecycleHandler: (board: object, handler: (event: LifecycleEvent) => void) => {
    mocks.lifecycleHandlers.set(board, handler);
    const dispose = vi.fn(() => {
      if (mocks.lifecycleHandlers.get(board) === handler) {
        mocks.lifecycleHandlers.delete(board);
      }
    });
    mocks.lifecycleDisposers.push(dispose);
    return dispose;
  },
}));

vi.mock('@plait/core', () => ({
  PlaitBoard: {
    getElementTopHost: () => ({ nodeName: 'synthetic-host' }),
    getPointer: (board: { pointer: string }) => board.pointer,
    isInPointer: (board: { pointer: string }, pointers: readonly string[]) =>
      pointers.includes(board.pointer),
  },
  Transforms: {
    insertNode: mocks.insertNode,
  },
  distanceBetweenPointAndPoint: (x1: number, y1: number, x2: number, y2: number) =>
    Math.hypot(x2 - x1, y2 - y1),
  isMainPointer: (event: { button: number; isPrimary?: boolean }) =>
    event.button === 0 && event.isPrimary !== false,
  throttleRAF: (_board: unknown, _key: string, callback: () => void) => callback(),
  toHostPoint: (board: { hostOffset?: readonly [number, number] }, x: number, y: number) => {
    const [offsetX, offsetY] = board.hostOffset ?? [0, 0];
    return [x - offsetX, y - offsetY];
  },
  toViewBoxPoint: (
    board: {
      viewport: { zoom: number; origination?: readonly [number, number] };
    },
    point: readonly [number, number]
  ) => {
    const [originX, originY] = board.viewport.origination ?? [0, 0];
    return [point[0] / board.viewport.zoom + originX, point[1] / board.viewport.zoom + originY];
  },
}));

vi.mock('./freehand.generator', () => ({
  FreehandGenerator: class {
    destroy = mocks.generatorDestroy;
    processDrawing = mocks.generatorProcessDrawing;
  },
}));

vi.mock('./smoother', () => ({
  FreehandSmoother: class {
    process(point: readonly [number, number]) {
      return [...point];
    }

    reset = vi.fn();
  },
}));

vi.mock('./utils', () => ({
  createFreehandElement: (
    shape: string,
    points: readonly (readonly [number, number])[],
    drawOptions: Record<string, unknown>
  ) => ({
    id: `stroke-${++mocks.nextElementId}`,
    type: 'freehand',
    shape,
    points: points.map((point) => [...point]),
    ...drawOptions,
  }),
  getFreehandDrawOptions: () => ({ strokeWidth: 4 }),
  getFreehandPointers: () => ['feltTipPen', 'eraser'],
}));

import { isValidFreehandInkData } from './ink/schema';
import { buildFreehandInkPlugin } from './ink/plugin';
import {
  MAX_LEGACY_FREEHAND_POINTS,
  MAX_FREEHAND_INK_SAMPLES,
  type FreehandInkDiagnostic,
  type FreehandInkMode,
  type FreehandInkPluginOptions,
  type PointerEventLike,
} from './ink/types';
import {
  appendLegacyFreehandPoint,
  closeLegacyFreehandPoints,
  withFreehandCreate,
} from './with-freehand-create';

type StoredElement = {
  readonly id: string;
  readonly type: string;
  readonly shape: string;
  readonly points: readonly (readonly [number, number])[];
  readonly strokeWidth: number;
  readonly ink?: {
    readonly version: number;
    readonly widths: readonly number[];
  };
};

type TestPointerEvent = PointerEventLike & {
  readonly type: string;
  readonly currentTarget: EventTarget | null;
  readonly x: number;
  readonly y: number;
};

type TestBoard = ReturnType<typeof createBoard>['board'];
type PluginInstallOrder = 'before-handler' | 'after-handler';

function pointerEvent(overrides: Partial<TestPointerEvent> = {}): PointerEvent {
  const clientX = overrides.clientX ?? 0;
  const clientY = overrides.clientY ?? 0;
  return {
    pointerId: 7,
    pointerType: 'pen',
    button: 0,
    buttons: 1,
    isPrimary: true,
    clientX,
    clientY,
    x: clientX,
    y: clientY,
    timeStamp: 0,
    pressure: 0.2,
    type: 'pointermove',
    currentTarget: null,
    ...overrides,
  } as unknown as PointerEvent;
}

function createBoard(
  mode: FreehandInkMode,
  optionOverrides: Partial<FreehandInkPluginOptions> = {},
  installOrder: PluginInstallOrder = 'before-handler'
) {
  const options: FreehandInkPluginOptions = {
    getMode: () => mode,
    ...optionOverrides,
  };
  const original = {
    apply: vi.fn(),
    globalPointerUp: vi.fn(),
    pointerCancel: vi.fn(),
    pointerDown: vi.fn(),
    pointerMove: vi.fn(),
    pointerUp: vi.fn(),
    touchStart: vi.fn(),
  };
  const pluginOptions = new Map<string, unknown>();
  const board = {
    ...original,
    children: [] as StoredElement[],
    getPluginOptions: vi.fn((key: string) => pluginOptions.get(key)),
    pointer: 'feltTipPen',
    setPluginOptions: vi.fn((key: string, value: unknown) => pluginOptions.set(key, value)),
    theme: { themeColorMode: 'default' },
    viewport: { zoom: 1 },
  };
  const installOptions = buildFreehandInkPlugin(options);
  if (installOrder === 'before-handler') {
    installOptions(board as never);
  }
  withFreehandCreate(board as never);
  if (installOrder === 'after-handler') {
    installOptions(board as never);
  }
  return { board, options, original };
}

function dispatchLifecycle(board: TestBoard, event: LifecycleEvent): void {
  mocks.lifecycleHandlers.get(board)?.(event);
}

function unmountBoard(board: TestBoard): void {
  const disposers = mocks.boardDisposers.get(board);
  mocks.boardDisposers.delete(board);
  disposers?.forEach((dispose) => dispose());
}

function insertedElement(): StoredElement {
  expect(mocks.insertNode).toHaveBeenCalledOnce();
  return mocks.insertNode.mock.calls[0][1] as StoredElement;
}

function drawLegacyStroke(board: TestBoard, pointerType: 'mouse' | 'pen' | 'touch' = 'pen') {
  board.pointerDown(
    pointerEvent({ pointerType, clientX: 0, clientY: 0, x: 0, y: 0, timeStamp: 1 })
  );
  board.pointerMove(
    pointerEvent({ pointerType, clientX: 20, clientY: 10, x: 20, y: 10, timeStamp: 10 })
  );
  board.pointerUp(
    pointerEvent({
      pointerType,
      clientX: 20,
      clientY: 10,
      x: 20,
      y: 10,
      timeStamp: 20,
      buttons: 0,
      type: 'pointerup',
    })
  );
}

function startPressureStroke(
  board: TestBoard,
  target: EventTarget | null = null,
  overrides: Partial<TestPointerEvent> = {}
) {
  board.pointerDown(
    pointerEvent({
      clientX: 0,
      clientY: 0,
      x: 0,
      y: 0,
      timeStamp: 1,
      pressure: 0.1,
      currentTarget: target,
      type: 'pointerdown',
      ...overrides,
    })
  );
}

function finishPressureStroke(board: TestBoard, overrides: Partial<TestPointerEvent> = {}) {
  board.pointerUp(
    pointerEvent({
      clientX: 40,
      clientY: 10,
      x: 40,
      y: 10,
      timeStamp: 50,
      pressure: 0,
      buttons: 0,
      type: 'pointerup',
      ...overrides,
    })
  );
}

function movePen(
  board: TestBoard,
  x: number,
  timeStamp: number,
  pressure?: number,
  overrides: Partial<TestPointerEvent> = {}
) {
  board.pointerMove(
    pointerEvent({
      clientX: x,
      clientY: 10,
      x,
      y: 10,
      timeStamp,
      pressure,
      ...overrides,
    })
  );
}

function pointerCaptureTarget() {
  const target = document.createElement('div');
  const setPointerCapture = vi.fn();
  const hasPointerCapture = vi.fn(() => true);
  const releasePointerCapture = vi.fn();
  Object.defineProperties(target, {
    setPointerCapture: { value: setPointerCapture },
    hasPointerCapture: { value: hasPointerCapture },
    releasePointerCapture: { value: releasePointerCapture },
  });
  return { target, setPointerCapture, hasPointerCapture, releasePointerCapture };
}

beforeEach(() => {
  mocks.drawingMode = true;
  mocks.generatorDestroy.mockClear();
  mocks.generatorProcessDrawing.mockClear();
  mocks.insertNode.mockReset();
  mocks.insertNode.mockImplementation(
    (board: { children: StoredElement[] }, element: StoredElement, path: readonly number[]) => {
      board.children.splice(path[0], 0, element);
    }
  );
  mocks.lifecycleDisposers.length = 0;
  mocks.boardDisposers = new WeakMap<object, Set<() => void>>();
  mocks.nextElementId = 0;
  mocks.twoFingerMode = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('withFreehandCreate ink integration', () => {
  it('bounds legacy capture at the largest document that can be saved and restored', () => {
    const points = Array.from(
      { length: MAX_LEGACY_FREEHAND_POINTS },
      (_, index) => [index, 0] as [number, number]
    );

    expect(appendLegacyFreehandPoint(points, [MAX_LEGACY_FREEHAND_POINTS, 0])).toBe(false);
    expect(points).toHaveLength(MAX_LEGACY_FREEHAND_POINTS);

    closeLegacyFreehandPoints(points);
    expect(points).toHaveLength(MAX_LEGACY_FREEHAND_POINTS);
    expect(points[points.length - 1]).toEqual(points[0]);
  });

  it('keeps legacy mode byte-for-byte on the legacy element shape and omits ink', () => {
    const onDiagnostic = vi.fn();
    const { board, original } = createBoard('legacy', { onDiagnostic });

    drawLegacyStroke(board);

    expect(insertedElement()).toEqual({
      id: 'stroke-2',
      type: 'freehand',
      shape: 'feltTipPen',
      points: [
        [0, 0],
        [20, 10],
      ],
      strokeWidth: 4,
    });
    expect(original.pointerDown).toHaveBeenCalledOnce();
    expect(original.pointerUp).toHaveBeenCalledOnce();
    expect(onDiagnostic).not.toHaveBeenCalled();
  });

  it('keeps direct pointerCancel behavior neutral when every ink feature is off', () => {
    const { board, original } = createBoard('legacy');
    board.pointerDown(pointerEvent({ type: 'pointerdown' }));
    board.pointerMove(pointerEvent({ clientX: 20, clientY: 10, x: 20, y: 10 }));

    board.pointerCancel(pointerEvent({ type: 'pointercancel' }));
    board.pointerUp(pointerEvent({ clientX: 20, clientY: 10, x: 20, y: 10 }));

    expect(original.pointerCancel).toHaveBeenCalledOnce();
    expect(insertedElement()).not.toHaveProperty('ink');
  });

  it('hands an early built-in lifecycle registration to a later feature-off plugin exactly once', () => {
    const registrations: Array<() => void> = [];
    const onDiagnostic = vi.fn();
    const { board, original } = createBoard(
      'legacy',
      {
        onDiagnostic,
        onLifecycleRegistration: (dispose) => registrations.push(dispose),
      },
      'after-handler'
    );

    expect(registrations).toHaveLength(1);
    board.pointerDown(pointerEvent({ type: 'pointerdown' }));
    board.pointerMove(pointerEvent({ clientX: 20, clientY: 10, x: 20, y: 10 }));
    const previewDestroysBeforeLifecycle = mocks.generatorDestroy.mock.calls.length;
    dispatchLifecycle(board, { reason: 'orientation-change' });
    expect(onDiagnostic).not.toHaveBeenCalled();
    expect(mocks.generatorDestroy).toHaveBeenCalledTimes(previewDestroysBeforeLifecycle);
    expect(mocks.insertNode).not.toHaveBeenCalled();
    expect(original.pointerCancel).not.toHaveBeenCalled();

    board.pointerUp(
      pointerEvent({ clientX: 20, clientY: 10, x: 20, y: 10, buttons: 0, type: 'pointerup' })
    );
    expect(insertedElement()).not.toHaveProperty('ink');

    registrations[0]();
    expect(mocks.lifecycleDisposers[0]).toHaveBeenCalledOnce();
    expect(board.getPluginOptions('drawnix.freehand-ink')).toMatchObject({
      getMode: expect.any(Function),
    });
    expect(
      (board.getPluginOptions('drawnix.freehand-ink') as FreehandInkPluginOptions).getMode()
    ).toBe('legacy');
  });

  it.each(['mouse', 'touch'] as const)(
    'delegates pressure-mode %s input to the unchanged legacy path',
    (pointerType) => {
      const onDiagnostic = vi.fn();
      const { board, original } = createBoard('pressure', { onDiagnostic });

      drawLegacyStroke(board, pointerType);

      expect(insertedElement()).not.toHaveProperty('ink');
      expect(original.pointerDown).toHaveBeenCalledOnce();
      expect(original.pointerUp).toHaveBeenCalledOnce();
      expect(onDiagnostic).not.toHaveBeenCalled();
    }
  );

  it('creates aligned valid ink after repeated dynamic pen pressure is observed', () => {
    const { board } = createBoard('pressure');
    startPressureStroke(board);
    movePen(board, 12, 10, 0.3);
    movePen(board, 24, 20, 0.6);
    movePen(board, 40, 30, 0.9);

    finishPressureStroke(board);

    const element = insertedElement();
    expect(element.ink).toBeDefined();
    expect(element.ink?.widths).toHaveLength(element.points.length);
    expect(isValidFreehandInkData(element.ink, element.points.length)).toBe(true);
    expect(new Set(element.ink?.widths).size).toBeGreaterThan(1);
  });

  it('stores pressure samples in viewBox coordinates under a panned and zoomed viewport', () => {
    const { board } = createBoard('pressure');
    Object.assign(board, { hostOffset: [100, 50] as const });
    Object.assign(board.viewport, { zoom: 2, origination: [10, -5] as const });

    startPressureStroke(board, null, { clientX: 120, clientY: 70, x: 120, y: 70 });
    movePen(board, 140, 10, 0.3, { clientY: 90, x: 140, y: 90 });
    movePen(board, 160, 20, 0.6, { clientY: 110, x: 160, y: 110 });
    movePen(board, 180, 30, 0.9, { clientY: 130, x: 180, y: 130 });
    finishPressureStroke(board, {
      clientX: 200,
      clientY: 150,
      x: 200,
      y: 150,
    });

    const element = insertedElement();
    expect(element.points[0]).toEqual([20, 5]);
    expect(element.points[element.points.length - 1]).toEqual([60, 45]);
    expect(element.ink?.widths).toHaveLength(element.points.length);
    expect(isValidFreehandInkData(element.ink, element.points.length)).toBe(true);
  });

  it.each([
    ['constant 0.5 pressure', [0.5, 0.5, 0.5, 0.5]],
    ['missing pressure', [undefined, undefined, undefined, undefined]],
  ] as const)('falls back to a legacy element for %s', (_caseName, pressures) => {
    const { board } = createBoard('pressure');
    startPressureStroke(board, null, { pressure: pressures[0] });
    movePen(board, 12, 10, pressures[1]);
    movePen(board, 24, 20, pressures[2]);
    movePen(board, 40, 30, pressures[3]);

    finishPressureStroke(board);

    expect(insertedElement()).not.toHaveProperty('ink');
  });

  it('does not reuse variable-pressure evidence across later pen strokes', () => {
    const { board } = createBoard('pressure');
    startPressureStroke(board);
    movePen(board, 12, 10, 0.3);
    movePen(board, 24, 20, 0.6);
    movePen(board, 40, 30, 0.9);
    finishPressureStroke(board);
    expect(insertedElement().ink).toBeDefined();

    mocks.insertNode.mockClear();
    startPressureStroke(board, null, { pointerId: 8, pressure: 0.5, timeStamp: 100 });
    movePen(board, 12, 110, 0.5, { pointerId: 8 });
    movePen(board, 24, 120, 0.5, { pointerId: 8 });
    movePen(board, 40, 130, 0.5, { pointerId: 8 });
    finishPressureStroke(board, { pointerId: 8, timeStamp: 140 });

    expect(insertedElement()).not.toHaveProperty('ink');
  });

  it('uses non-empty coalesced samples instead of the parent event, never in addition', () => {
    const diagnostics: FreehandInkDiagnostic[] = [];
    const { board } = createBoard('pressure', {
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      shouldEmitDiagnostics: () => true,
    });
    startPressureStroke(board);
    const coalesced = [
      pointerEvent({ clientX: 10, clientY: 2, timeStamp: 10, pressure: 0.2 }),
      pointerEvent({ clientX: 20, clientY: 4, timeStamp: 20, pressure: 0.4 }),
      pointerEvent({ clientX: 30, clientY: 6, timeStamp: 30, pressure: 0.6 }),
      pointerEvent({ clientX: 40, clientY: 8, timeStamp: 40, pressure: 0.9 }),
    ];
    movePen(board, 900, 45, 1, {
      clientY: 900,
      y: 900,
      getCoalescedEvents: () => coalesced,
    });

    finishPressureStroke(board);

    const element = insertedElement();
    expect(element.points.every(([x, y]) => x <= 40 && y <= 10)).toBe(true);
    expect(element.points.some(([x]) => x > 0)).toBe(true);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        source: 'coalesced',
        receivedSamples: 4,
        acceptedSamples: 4,
        coalescedSamples: 4,
      })
    );
  });

  it('ignores move, up, cancel, and global-up events from a foreign pointer', () => {
    const diagnostics: FreehandInkDiagnostic[] = [];
    const { board, original } = createBoard('pressure', {
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    startPressureStroke(board);
    const previewsAfterDown = mocks.generatorProcessDrawing.mock.calls.length;

    movePen(board, 20, 10, 0.8, { pointerId: 99 });
    board.pointerUp(pointerEvent({ pointerId: 99, buttons: 0, type: 'pointerup' }));
    board.pointerCancel(pointerEvent({ pointerId: 99, type: 'pointercancel' }));
    board.globalPointerUp(pointerEvent({ pointerId: 99, buttons: 0, type: 'pointerup' }));

    expect(mocks.generatorProcessDrawing).toHaveBeenCalledTimes(previewsAfterDown);
    expect(mocks.insertNode).not.toHaveBeenCalled();
    expect(diagnostics).not.toContainEqual(
      expect.objectContaining({ endReason: expect.anything() })
    );
    expect(original.pointerMove).not.toHaveBeenCalled();
    expect(original.pointerUp).not.toHaveBeenCalled();
    expect(original.pointerCancel).not.toHaveBeenCalled();
    expect(original.globalPointerUp).not.toHaveBeenCalled();

    movePen(board, 30, 20, 0.7);
    finishPressureStroke(board);
    expect(mocks.insertNode).toHaveBeenCalledOnce();
  });

  it('cancels an active pen stroke before a foreign touch can start a legacy stroke', () => {
    const { board, original } = createBoard('pressure');
    startPressureStroke(board);

    board.pointerDown(
      pointerEvent({
        pointerId: 99,
        pointerType: 'touch',
        type: 'pointerdown',
        clientX: 5,
        clientY: 5,
      })
    );
    board.pointerMove(pointerEvent({ pointerId: 99, pointerType: 'touch', clientX: 20, x: 20 }));
    board.pointerUp(
      pointerEvent({ pointerId: 99, pointerType: 'touch', buttons: 0, type: 'pointerup' })
    );
    finishPressureStroke(board);

    expect(mocks.insertNode).not.toHaveBeenCalled();
    expect(original.pointerCancel).toHaveBeenCalledOnce();
    expect(original.pointerDown).toHaveBeenCalledOnce();
  });

  it.each([
    ['pointer cancel', 'pointer-cancel', 'pointerCancel'],
    ['lost pointer capture', 'lost-pointer-capture', 'lostPointerCapture'],
    ['global pointer up', 'global-pointer-up', 'globalPointerUp'],
    ['two-finger navigation', 'two-finger-navigation', 'twoFinger'],
    ['set_viewport', 'viewport-change', 'setViewport'],
    ['orientation change', 'orientation-change', 'orientationChange'],
  ] as const)('cancels without insertion on %s', (_label, endReason, action) => {
    const diagnostics: FreehandInkDiagnostic[] = [];
    const { board, original } = createBoard('pressure', {
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      shouldEmitDiagnostics: () => true,
    });
    startPressureStroke(board);
    movePen(board, 20, 10, 0.7);

    switch (action) {
      case 'pointerCancel':
        dispatchLifecycle(board, { reason: 'pointer-cancel', pointerId: 7 });
        break;
      case 'lostPointerCapture':
        dispatchLifecycle(board, { reason: 'lost-pointer-capture', pointerId: 7 });
        break;
      case 'globalPointerUp':
        board.globalPointerUp(pointerEvent({ buttons: 0, type: 'pointerup' }));
        break;
      case 'twoFinger':
        mocks.twoFingerMode = true;
        movePen(board, 30, 20, 0.8);
        break;
      case 'setViewport':
        board.apply({ type: 'set_viewport' });
        break;
      case 'orientationChange':
        dispatchLifecycle(board, { reason: 'orientation-change' });
        break;
    }

    expect(mocks.insertNode).not.toHaveBeenCalled();
    expect(diagnostics).toContainEqual(expect.objectContaining({ endReason }));
    if (action === 'twoFinger' || action === 'setViewport' || action === 'orientationChange') {
      expect(original.pointerCancel).toHaveBeenCalledOnce();
      expect(original.pointerCancel).toHaveBeenCalledWith(
        expect.objectContaining({ pointerId: 7 })
      );
    } else if (action !== 'pointerCancel' && action !== 'lostPointerCapture') {
      expect(original.pointerCancel).not.toHaveBeenCalled();
    }
  });

  it('captures the active pen pointer and releases it exactly once on completion', () => {
    const { target, setPointerCapture, hasPointerCapture, releasePointerCapture } =
      pointerCaptureTarget();
    const { board } = createBoard('pressure');

    startPressureStroke(board, target);
    expect(setPointerCapture).toHaveBeenCalledOnce();
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(releasePointerCapture).not.toHaveBeenCalled();

    finishPressureStroke(board);

    expect(hasPointerCapture).toHaveBeenCalledWith(7);
    expect(releasePointerCapture).toHaveBeenCalledOnce();
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('silently tears down active pressure input exactly once when its owner disposes', () => {
    const diagnostics: FreehandInkDiagnostic[] = [];
    const registrations: Array<() => void> = [];
    const { target, releasePointerCapture } = pointerCaptureTarget();
    const { board, original } = createBoard(
      'pressure',
      {
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        onLifecycleRegistration: (dispose) => registrations.push(dispose),
        shouldEmitDiagnostics: () => true,
      },
      'after-handler'
    );
    startPressureStroke(board, target);
    movePen(board, 20, 10, 0.7);
    const diagnosticsBeforeDispose = diagnostics.length;

    registrations[0]();
    unmountBoard(board);
    registrations[0]();
    dispatchLifecycle(board, { reason: 'orientation-change' });
    finishPressureStroke(board);

    expect(mocks.lifecycleDisposers[0]).toHaveBeenCalledOnce();
    expect(releasePointerCapture).toHaveBeenCalledOnce();
    expect(mocks.insertNode).not.toHaveBeenCalled();
    expect(diagnostics).toHaveLength(diagnosticsBeforeDispose);
    expect(original.pointerCancel).not.toHaveBeenCalled();
  });

  it('owns and cancels a pending preview frame during active-stroke disposal', () => {
    let nextFrameId = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      nextFrameId += 1;
      callbacks.set(nextFrameId, callback);
      return nextFrameId;
    });
    const cancelFrame = vi.fn((frameId: number) => callbacks.delete(frameId));
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    const registrations: Array<() => void> = [];
    const { board } = createBoard(
      'pressure',
      { onLifecycleRegistration: (dispose) => registrations.push(dispose) },
      'after-handler'
    );

    startPressureStroke(board);
    const staleCallback = callbacks.get(1);
    movePen(board, 20, 10, 0.7);
    expect(requestFrame).toHaveBeenCalledOnce();

    registrations[0]();
    expect(cancelFrame).toHaveBeenCalledOnce();
    expect(callbacks.size).toBe(0);
    staleCallback?.(16);
    expect(mocks.generatorProcessDrawing).not.toHaveBeenCalled();
    expect(mocks.insertNode).not.toHaveBeenCalled();
  });

  it('self-cleans generic board unmount and keeps a remounted board independently live', () => {
    let nextFrameId = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      nextFrameId += 1;
      callbacks.set(nextFrameId, callback);
      return nextFrameId;
    });
    const cancelFrame = vi.fn((frameId: number) => callbacks.delete(frameId));
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    const firstCapture = pointerCaptureTarget();
    const first = createBoard('pressure');

    startPressureStroke(first.board, firstCapture.target);
    movePen(first.board, 20, 10, 0.7);
    const staleFrame = callbacks.get(1);
    const destroysBeforeUnmount = mocks.generatorDestroy.mock.calls.length;

    unmountBoard(first.board);
    unmountBoard(first.board);
    first.board.pointerMove(pointerEvent({ clientX: 30, x: 30, timeStamp: 20, pressure: 0.9 }));
    first.board.pointerUp(pointerEvent({ buttons: 0, type: 'pointerup' }));
    staleFrame?.(16);

    expect(mocks.lifecycleDisposers[0]).toHaveBeenCalledOnce();
    expect(mocks.lifecycleHandlers.has(first.board)).toBe(false);
    expect(cancelFrame).toHaveBeenCalledOnce();
    expect(callbacks.size).toBe(0);
    expect(firstCapture.releasePointerCapture).toHaveBeenCalledOnce();
    expect(mocks.generatorDestroy.mock.calls.length).toBe(destroysBeforeUnmount + 2);
    expect(mocks.generatorProcessDrawing).not.toHaveBeenCalled();
    expect(mocks.insertNode).not.toHaveBeenCalled();

    const second = createBoard('pressure');
    startPressureStroke(second.board, null, { pointerId: 8, pressure: 0.1, timeStamp: 100 });
    movePen(second.board, 12, 110, 0.3, { pointerId: 8 });
    movePen(second.board, 24, 120, 0.6, { pointerId: 8 });
    movePen(second.board, 40, 130, 0.9, { pointerId: 8 });
    finishPressureStroke(second.board, { pointerId: 8, timeStamp: 140 });

    expect(mocks.insertNode).toHaveBeenCalledOnce();
    expect(mocks.lifecycleHandlers.has(second.board)).toBe(true);
    expect(mocks.lifecycleDisposers[1]).not.toHaveBeenCalled();

    unmountBoard(second.board);
    expect(mocks.lifecycleDisposers[1]).toHaveBeenCalledOnce();
  });

  it('unwinds upstream input after a pressure rollout switches off mid-stroke', () => {
    let mode: FreehandInkMode = 'pressure';
    const diagnostics: FreehandInkDiagnostic[] = [];
    const { target, releasePointerCapture } = pointerCaptureTarget();
    const { board, original } = createBoard('pressure', {
      getMode: () => mode,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      shouldEmitDiagnostics: () => true,
    });
    startPressureStroke(board, target);
    const diagnosticsBeforeSwitch = diagnostics.length;

    mode = 'legacy';
    dispatchLifecycle(board, { reason: 'orientation-change' });
    finishPressureStroke(board);

    expect(releasePointerCapture).toHaveBeenCalledOnce();
    expect(mocks.insertNode).not.toHaveBeenCalled();
    expect(diagnostics).toHaveLength(diagnosticsBeforeSwitch);
    expect(original.pointerCancel).toHaveBeenCalledOnce();
    expect(original.pointerCancel).toHaveBeenCalledWith(
      expect.objectContaining({ pointerId: 7, type: 'orientationchange' })
    );
  });

  it('routes enabled probe lifecycle cancellation through the legacy and upstream handlers once', () => {
    const diagnostics: FreehandInkDiagnostic[] = [];
    const { board, original } = createBoard('probe', {
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      shouldEmitDiagnostics: () => true,
    });
    board.pointerDown(pointerEvent({ type: 'pointerdown' }));

    dispatchLifecycle(board, { reason: 'lost-pointer-capture', pointerId: 99 });
    expect(original.pointerCancel).not.toHaveBeenCalled();
    dispatchLifecycle(board, { reason: 'lost-pointer-capture', pointerId: 7 });
    board.pointerUp(pointerEvent({ buttons: 0, type: 'pointerup' }));

    expect(original.pointerCancel).toHaveBeenCalledOnce();
    expect(original.pointerCancel).toHaveBeenCalledWith(
      expect.objectContaining({ pointerId: 7, type: 'lostpointercapture' })
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ endReason: 'lost-pointer-capture' })
    );
    expect(mocks.insertNode).not.toHaveBeenCalled();
  });

  it.each(['mouse', 'touch'] as const)(
    'cancels pressure-mode %s fallback through the legacy handler without diagnostics',
    (pointerType) => {
      const diagnostics: FreehandInkDiagnostic[] = [];
      const { board, original } = createBoard('pressure', {
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        shouldEmitDiagnostics: () => true,
      });
      board.pointerDown(pointerEvent({ pointerType, type: 'pointerdown' }));
      board.pointerMove(pointerEvent({ pointerType, clientX: 20, x: 20 }));

      dispatchLifecycle(board, { reason: 'pointer-cancel', pointerId: 99 });
      expect(original.pointerCancel).not.toHaveBeenCalled();
      dispatchLifecycle(board, { reason: 'pointer-cancel', pointerId: 7 });
      board.pointerUp(pointerEvent({ pointerType, buttons: 0, type: 'pointerup' }));

      expect(original.pointerCancel).toHaveBeenCalledOnce();
      expect(mocks.insertNode).not.toHaveBeenCalled();
      expect(diagnostics).toEqual([]);
    }
  );

  it('emits optional probe diagnostics only while the diagnostics guard is enabled', () => {
    let diagnosticsEnabled = false;
    const diagnostics: FreehandInkDiagnostic[] = [];
    const shouldEmitDiagnostics = vi.fn(() => diagnosticsEnabled);
    const { board } = createBoard('probe', {
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      shouldEmitDiagnostics,
    });

    drawLegacyStroke(board);
    expect(diagnostics).toEqual([]);

    diagnosticsEnabled = true;
    board.pointerDown(pointerEvent({ pointerId: 8, timeStamp: 100, type: 'pointerdown' }));
    board.pointerMove(
      pointerEvent({ pointerId: 8, clientX: 20, x: 20, timeStamp: 110, pressure: 0.8 })
    );
    board.pointerUp(
      pointerEvent({
        pointerId: 8,
        clientX: 20,
        x: 20,
        timeStamp: 120,
        buttons: 0,
        type: 'pointerup',
      })
    );

    expect(shouldEmitDiagnostics).toHaveBeenCalled();
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics).toContainEqual(expect.objectContaining({ endReason: 'pointer-up' }));
    expect(mocks.insertNode.mock.calls).toHaveLength(2);
    expect(mocks.insertNode.mock.calls.every(([, element]) => !('ink' in element))).toBe(true);
  });

  it('drops probe-only tracking when diagnostics switch off without disturbing legacy drawing', () => {
    let mode: FreehandInkMode = 'probe';
    const diagnostics: FreehandInkDiagnostic[] = [];
    const { board, original } = createBoard('probe', {
      getMode: () => mode,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      shouldEmitDiagnostics: () => mode === 'probe',
    });
    board.pointerDown(pointerEvent({ type: 'pointerdown', timeStamp: 1 }));
    board.pointerMove(pointerEvent({ clientX: 10, x: 10, timeStamp: 10 }));
    const diagnosticsBeforeSwitch = diagnostics.length;

    mode = 'legacy';
    board.pointerMove(pointerEvent({ clientX: 20, x: 20, timeStamp: 20 }));
    board.pointerUp(pointerEvent({ clientX: 30, x: 30, timeStamp: 30, buttons: 0 }));
    dispatchLifecycle(board, { reason: 'pointer-cancel', pointerId: 7 });

    expect(insertedElement()).not.toHaveProperty('ink');
    expect(diagnostics).toHaveLength(diagnosticsBeforeSwitch);
    expect(original.pointerCancel).not.toHaveBeenCalled();
  });

  it.each(['orientation-change', 'viewport-change'] as const)(
    'retains cancellation ownership after probe switches off before %s',
    (reason) => {
      let mode: FreehandInkMode = 'probe';
      const { board, original } = createBoard('probe', { getMode: () => mode });
      board.pointerDown(pointerEvent({ type: 'pointerdown', timeStamp: 1 }));
      board.pointerMove(pointerEvent({ clientX: 10, x: 10, timeStamp: 10 }));

      mode = 'legacy';
      board.pointerMove(pointerEvent({ clientX: 20, x: 20, timeStamp: 20 }));
      dispatchLifecycle(board, { reason });
      board.pointerUp(pointerEvent({ clientX: 30, x: 30, buttons: 0, type: 'pointerup' }));

      expect(mocks.insertNode).not.toHaveBeenCalled();
      expect(original.pointerCancel).toHaveBeenCalledOnce();
    }
  );

  it('removes disposed board callbacks and keeps a remounted board independently live', () => {
    const firstDiagnostics: FreehandInkDiagnostic[] = [];
    const firstRegistrations: Array<() => void> = [];
    const first = createBoard(
      'probe',
      {
        onDiagnostic: (diagnostic) => firstDiagnostics.push(diagnostic),
        onLifecycleRegistration: (dispose) => firstRegistrations.push(dispose),
        shouldEmitDiagnostics: () => true,
      },
      'after-handler'
    );
    first.board.pointerDown(pointerEvent({ timeStamp: 1, type: 'pointerdown' }));
    firstDiagnostics.length = 0;

    firstRegistrations[0]();
    dispatchLifecycle(first.board, { reason: 'orientation-change' });
    expect(firstDiagnostics).toEqual([]);

    const secondDiagnostics: FreehandInkDiagnostic[] = [];
    const secondRegistrations: Array<() => void> = [];
    const second = createBoard(
      'probe',
      {
        onDiagnostic: (diagnostic) => secondDiagnostics.push(diagnostic),
        onLifecycleRegistration: (dispose) => secondRegistrations.push(dispose),
        shouldEmitDiagnostics: () => true,
      },
      'after-handler'
    );
    second.board.pointerDown(pointerEvent({ timeStamp: 10, type: 'pointerdown' }));
    secondDiagnostics.length = 0;

    dispatchLifecycle(second.board, { reason: 'orientation-change' });
    expect(secondDiagnostics).toEqual([
      expect.objectContaining({ endReason: 'orientation-change' }),
    ]);
    expect(firstDiagnostics).toEqual([]);

    secondRegistrations[0]();
    secondDiagnostics.length = 0;
    dispatchLifecycle(second.board, { reason: 'viewport-change' });
    expect(secondDiagnostics).toEqual([]);
  });

  it('does not let a stale feature owner dispose a replacement owner on the same board', () => {
    const firstRegistrations: Array<() => void> = [];
    const firstDiagnostics: FreehandInkDiagnostic[] = [];
    const { board } = createBoard(
      'probe',
      {
        onDiagnostic: (diagnostic) => firstDiagnostics.push(diagnostic),
        onLifecycleRegistration: (dispose) => firstRegistrations.push(dispose),
        shouldEmitDiagnostics: () => true,
      },
      'after-handler'
    );
    const secondRegistrations: Array<() => void> = [];
    const secondDiagnostics: FreehandInkDiagnostic[] = [];
    buildFreehandInkPlugin({
      getMode: () => 'probe',
      onDiagnostic: (diagnostic) => secondDiagnostics.push(diagnostic),
      onLifecycleRegistration: (dispose) => secondRegistrations.push(dispose),
      shouldEmitDiagnostics: () => true,
    })(board as never);

    expect(firstRegistrations).toHaveLength(1);
    expect(secondRegistrations).toHaveLength(1);
    firstRegistrations[0]();
    board.pointerDown(pointerEvent({ timeStamp: 1, type: 'pointerdown' }));
    secondDiagnostics.length = 0;
    dispatchLifecycle(board, { reason: 'orientation-change' });

    expect(firstDiagnostics).toHaveLength(0);
    expect(secondDiagnostics).toEqual([
      expect.objectContaining({ endReason: 'orientation-change' }),
    ]);

    secondRegistrations[0]();
    secondDiagnostics.length = 0;
    dispatchLifecycle(board, { reason: 'viewport-change' });
    expect(secondDiagnostics).toEqual([]);
  });

  it('caps a continuous pressure stroke and reports resampler and stroke overflow drops', () => {
    const diagnostics: FreehandInkDiagnostic[] = [];
    const { board } = createBoard('pressure', {
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      shouldEmitDiagnostics: () => true,
    });
    startPressureStroke(board);
    movePen(board, 100_000, 10, 0.3);
    movePen(board, 200_000, 20, 0.6);
    movePen(board, 300_000, 30, 0.9);

    finishPressureStroke(board);

    const element = insertedElement();
    expect(element.points).toHaveLength(MAX_FREEHAND_INK_SAMPLES);
    expect(element.ink?.widths).toHaveLength(MAX_FREEHAND_INK_SAMPLES);
    expect(isValidFreehandInkData(element.ink, element.points.length)).toBe(true);
    expect(
      diagnostics.some(
        ({ endReason, geometryDroppedSamples }) => !endReason && (geometryDroppedSamples ?? 0) > 0
      )
    ).toBe(true);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ endReason: 'pointer-up', droppedSamples: expect.any(Number) })
    );
    const terminal = diagnostics.find(({ endReason }) => endReason === 'pointer-up');
    // The terminal entry is a lifecycle marker. Drops are accounted in their
    // source batches and must not be counted twice in runtime totals.
    expect(terminal?.droppedSamples).toBe(0);
    const cappedBatch = [...diagnostics]
      .reverse()
      .find(
        ({ endReason, captureCapped, acceptedSamples }) =>
          !endReason && captureCapped === true && acceptedSamples > 0
      );
    expect(cappedBatch?.geometryDroppedSamples).toBe(cappedBatch?.acceptedSamples);
    expect(cappedBatch?.droppedSamples).toBe(0);
  });

  it('keeps the pointerup endpoint and the last active pressure', () => {
    const { board } = createBoard('pressure');
    startPressureStroke(board);
    movePen(board, 12, 5, 0.3);
    movePen(board, 20, 10, 0.6);
    movePen(board, 30, 15, 0.8);
    board.pointerUp(
      pointerEvent({
        pointerId: 7,
        clientX: 40,
        x: 40,
        timeStamp: 20,
        pressure: 0,
        buttons: 0,
        type: 'pointerup',
      })
    );

    const element = insertedElement();
    expect(element.points[element.points.length - 1][0]).toBe(40);
    expect(element.ink?.widths[element.ink.widths.length - 1]).toBeGreaterThan(4);
  });

  it('does not close a stroke when pointerup moves away from a near-start preview', () => {
    const { board } = createBoard('pressure');
    startPressureStroke(board);
    movePen(board, 12, 5, 0.3);
    movePen(board, 24, 10, 0.6);
    movePen(board, 2, 15, 0.8, { clientY: 2, y: 2 });
    finishPressureStroke(board, { clientX: 40, clientY: 10, x: 40, y: 10 });

    const element = insertedElement();
    expect(element.points[element.points.length - 1]).not.toEqual(element.points[0]);
  });

  it('closes a stroke when pointerup returns to its start after a far preview', () => {
    const { board } = createBoard('pressure');
    startPressureStroke(board);
    movePen(board, 12, 5, 0.3);
    movePen(board, 24, 10, 0.6);
    movePen(board, 40, 15, 0.8);
    finishPressureStroke(board, { clientX: 2, clientY: 2, x: 2, y: 2 });

    const element = insertedElement();
    expect(element.points[element.points.length - 1]).toEqual(element.points[0]);
    expect(element.ink?.widths[element.ink.widths.length - 1]).toBe(element.ink?.widths[0]);
  });
});
