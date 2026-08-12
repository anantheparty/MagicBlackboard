import type { CanvasPoint, MagicCanvasAdapter } from '@magic-blackboard/core';
import {
  getRectangleByElements,
  getSelectedElements,
  toHostPoint,
  toHostPointFromViewBoxPoint,
  toScreenPointFromHostPoint,
  toViewBoxPoint,
  type PlaitBoard,
  type PlaitElement,
  type PlaitOperation,
  type PlaitPlugin,
  type PlaitTheme,
  type Point,
  type RectangleClient,
  type Selection,
  type Viewport,
} from '@plait/core';

export type PlaitCanvasEventType = 'selection' | 'document' | 'viewport';
export type PlaitCanvasPoint = CanvasPoint;

export interface PlaitCanvasSelection {
  readonly range: Selection | null;
  readonly elementIds: readonly string[];
}

export interface PlaitCanvasDocument {
  readonly revision: number;
  readonly changedElementIds: readonly string[];
  readonly theme: PlaitTheme;
}

export interface PlaitCanvasSnapshot {
  readonly elements: readonly PlaitElement[];
  readonly theme: PlaitTheme;
  readonly selection: PlaitCanvasSelection;
  readonly viewport: Viewport;
}

interface PlaitCanvasChangeEventBase<TType extends PlaitCanvasEventType, TValue> {
  readonly type: TType;
  readonly previous: TValue;
  readonly current: TValue;
  /** Deliberately omitted from hot events; use getSnapshot() on demand. */
  readonly snapshot?: PlaitCanvasSnapshot;
  readonly operations: readonly PlaitOperation[];
}

export type PlaitCanvasSelectionEvent = PlaitCanvasChangeEventBase<
  'selection',
  PlaitCanvasSelection
>;

export type PlaitCanvasDocumentEvent = PlaitCanvasChangeEventBase<'document', PlaitCanvasDocument>;

export type PlaitCanvasViewportEvent = PlaitCanvasChangeEventBase<'viewport', Viewport>;

export interface PlaitCanvasEventMap {
  readonly selection: PlaitCanvasSelectionEvent;
  readonly document: PlaitCanvasDocumentEvent;
  readonly viewport: PlaitCanvasViewportEvent;
}

export type PlaitCanvasEvent = PlaitCanvasEventMap[PlaitCanvasEventType];

export type PlaitCanvasEventListener<TType extends PlaitCanvasEventType> = (
  event: PlaitCanvasEventMap[TType]
) => void;

export interface PlaitCanvasAdapterHelpers {
  readonly getSelectedElements: (board: PlaitBoard) => PlaitElement[];
  readonly getRectangleByElements: (
    board: PlaitBoard,
    elements: PlaitElement[],
    recursion: boolean
  ) => RectangleClient;
  readonly toHostPoint: (board: PlaitBoard, x: number, y: number) => Point;
  readonly toHostPointFromViewBoxPoint: (board: PlaitBoard, point: Point) => Point;
  readonly toScreenPointFromHostPoint: (board: PlaitBoard, point: Point) => Point;
  readonly toViewBoxPoint: (board: PlaitBoard, point: Point) => Point;
}

export interface PlaitCanvasAdapterOptions {
  /** Overrides exist for deterministic tests and future Plait compatibility shims. */
  readonly helpers?: Partial<PlaitCanvasAdapterHelpers>;
  /** Listener failures are isolated from Plait's change lifecycle and reported here. */
  readonly onListenerError?: (error: unknown) => void;
}

interface BoardHook {
  readonly board: PlaitBoard;
  readonly previousOnChange: PlaitBoard['onChange'];
  readonly wrappedOnChange: PlaitBoard['onChange'];
  persistent: boolean;
  notify: (() => void) | null;
}

type UntypedListener = (event: PlaitCanvasEvent) => void;

const DEFAULT_HELPERS: PlaitCanvasAdapterHelpers = {
  getSelectedElements,
  getRectangleByElements,
  toHostPoint,
  toHostPointFromViewBoxPoint,
  toScreenPointFromHostPoint,
  toViewBoxPoint,
};

const EMPTY_SELECTION: PlaitCanvasSelection = {
  range: null,
  elementIds: [],
};

/**
 * A board-scoped, read-only bridge from Plait into the Magic Blackboard runtime.
 *
 * The adapter wraps only the attached board's change callback. It never writes to
 * Plait's exported singleton maps and it can be installed before the board mounts
 * by passing `asPlugin()` in the product's additional Plait plugins.
 */
export class PlaitCanvasAdapter implements MagicCanvasAdapter<
  PlaitBoard,
  PlaitElement,
  Selection,
  Viewport,
  PlaitTheme
> {
  private readonly helpers: PlaitCanvasAdapterHelpers;
  private readonly listeners = new Map<PlaitCanvasEventType, Set<UntypedListener>>();
  private readonly hooks = new Map<PlaitBoard, BoardHook>();
  private readonly onListenerError: (error: unknown) => void;
  private board: PlaitBoard | null = null;
  private previousSelection: PlaitCanvasSelection = cloneData(EMPTY_SELECTION);
  private previousViewport: Viewport | null = null;
  private previousTheme: PlaitTheme | null = null;
  private documentRevision = 0;
  private _disposed = false;

  public constructor(options: PlaitCanvasAdapterOptions = {}) {
    this.helpers = { ...DEFAULT_HELPERS, ...options.helpers };
    this.onListenerError = options.onListenerError ?? (() => undefined);
  }

  public get isAttached(): boolean {
    return this.board !== null;
  }

  public get disposed(): boolean {
    return this._disposed;
  }

  public attach(board: PlaitBoard): void {
    this.assertNotDisposed();

    if (this.board === board) {
      return;
    }

    this.detach();
    try {
      this.board = board;
      this.previousSelection = this.captureSelection(board);
      this.previousViewport = cloneData(board.viewport);
      this.previousTheme = cloneData(board.theme);
      this.documentRevision = 0;

      const hook = this.ensureBoardHook(board, false);
      hook.notify = () => this.handleBoardChange(board);
    } catch (error) {
      this.rollbackFailedAttach(board);
      throw error;
    }
  }

  public detach(): void {
    if (!this.board) {
      return;
    }

    const board = this.board;
    this.board = null;
    this.previousSelection = cloneData(EMPTY_SELECTION);
    this.previousViewport = null;
    this.previousTheme = null;
    this.documentRevision = 0;

    const hook = this.hooks.get(board);
    if (!hook) {
      return;
    }

    hook.notify = null;
    if (!hook.persistent) {
      if (board.onChange === hook.wrappedOnChange) {
        board.onChange = hook.previousOnChange;
      }
      this.hooks.delete(board);
    }
  }

  public dispose(): void {
    if (this._disposed) {
      return;
    }

    this.detach();
    this._disposed = true;
    this.listeners.clear();

    for (const [board, hook] of this.hooks) {
      hook.notify = null;
      if (board.onChange === hook.wrappedOnChange) {
        board.onChange = hook.previousOnChange;
      }
    }
    this.hooks.clear();
  }

  /**
   * Creates a Plait plugin that installs the change-listener seam early without
   * attaching the runtime. Call `attach(board)` from Drawnix's `afterInit` hook.
   */
  public asPlugin(): PlaitPlugin {
    return (board) => {
      this.assertNotDisposed();
      this.ensureBoardHook(board, true);
      return board;
    };
  }

  public getSnapshot(): PlaitCanvasSnapshot {
    return this.captureSnapshot(this.requireBoard());
  }

  public getSelection(): PlaitCanvasSelection {
    return this.board ? this.captureSelection(this.board) : cloneData(EMPTY_SELECTION);
  }

  public getElementsByIds(ids: readonly string[]): readonly PlaitElement[] {
    if (!this.board || ids.length === 0) {
      return [];
    }

    const elementsById = new Map<string, PlaitElement>();
    visitElements(this.board.children, (element) => {
      const id = getPlaitElementId(element);
      if (id !== null && !elementsById.has(id)) {
        elementsById.set(id, element);
      }
    });

    return ids.flatMap((id) => {
      const element = elementsById.get(String(id));
      return element ? [cloneData(element)] : [];
    });
  }

  public getSelectionBounds(): RectangleClient | null {
    if (!this.board) {
      return null;
    }

    const elements = this.readSelectedElements(this.board);
    if (elements.length === 0) {
      return null;
    }

    try {
      const bounds = normalizeRectangle(
        this.helpers.getRectangleByElements(this.board, elements, false)
      );
      return bounds ?? getFallbackBounds(this.board, elements);
    } catch {
      return getFallbackBounds(this.board, elements);
    }
  }

  /** Converts a Plait viewBox/world point to browser client coordinates. */
  public worldToScreen(point: PlaitCanvasPoint): PlaitCanvasPoint {
    const board = this.requireBoard();
    const hostPoint = this.helpers.toHostPointFromViewBoxPoint(board, [point[0], point[1]]);
    const screenPoint = this.helpers.toScreenPointFromHostPoint(board, hostPoint);
    return [screenPoint[0], screenPoint[1]];
  }

  /** Converts browser client coordinates to a Plait viewBox/world point. */
  public screenToWorld(point: PlaitCanvasPoint): PlaitCanvasPoint {
    const board = this.requireBoard();
    const hostPoint = this.helpers.toHostPoint(board, point[0], point[1]);
    const worldPoint = this.helpers.toViewBoxPoint(board, hostPoint);
    return [worldPoint[0], worldPoint[1]];
  }

  public subscribe<TType extends PlaitCanvasEventType>(
    type: TType,
    listener: PlaitCanvasEventListener<TType>
  ): () => void {
    this.assertNotDisposed();

    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }

    const untypedListener = listener as UntypedListener;
    listeners.add(untypedListener);
    let subscribed = true;

    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      listeners?.delete(untypedListener);
      if (listeners?.size === 0) {
        this.listeners.delete(type);
      }
    };
  }

  private ensureBoardHook(board: PlaitBoard, persistent: boolean): BoardHook {
    const existing = this.hooks.get(board);
    if (existing) {
      existing.persistent ||= persistent;
      return existing;
    }

    const previousOnChange = board.onChange;
    let notify: (() => void) | null = null;
    const wrappedOnChange = () => {
      previousOnChange();
      notify?.();
    };

    const hook: BoardHook = {
      board,
      previousOnChange,
      wrappedOnChange,
      persistent,
      get notify() {
        return notify;
      },
      set notify(value: (() => void) | null) {
        notify = value;
      },
    };

    board.onChange = wrappedOnChange;
    this.hooks.set(board, hook);
    return hook;
  }

  private rollbackFailedAttach(board: PlaitBoard): void {
    this.board = null;
    this.previousSelection = cloneData(EMPTY_SELECTION);
    this.previousViewport = null;
    this.previousTheme = null;
    this.documentRevision = 0;
    const hook = this.hooks.get(board);
    if (!hook) return;
    hook.notify = null;
    if (!hook.persistent) {
      if (board.onChange === hook.wrappedOnChange) {
        board.onChange = hook.previousOnChange;
      }
      this.hooks.delete(board);
    }
  }

  private handleBoardChange(board: PlaitBoard): void {
    if (this._disposed || this.board !== board) {
      return;
    }

    const operations = cloneData(board.operations ?? []);
    const previousSelection = this.previousSelection;
    const previousViewport = this.previousViewport ?? cloneData(board.viewport);
    const previousTheme = this.previousTheme ?? cloneData(board.theme);
    const currentSelection = this.captureSelection(board);
    const currentViewport = cloneData(board.viewport);
    const currentTheme = cloneData(board.theme);
    const documentChanged =
      hasDocumentOperation(operations) || !isEqual(previousTheme, currentTheme);
    const selectionChanged =
      hasOperation(operations, 'set_selection') || !isEqual(previousSelection, currentSelection);
    const viewportChanged =
      hasOperation(operations, 'set_viewport') || !isEqual(previousViewport, currentViewport);

    if (documentChanged) {
      const previousRevision = this.documentRevision;
      this.documentRevision += 1;
      const changedElementIds = getChangedElementIds(board, operations);
      this.emit('document', {
        type: 'document',
        previous: {
          revision: previousRevision,
          changedElementIds: [],
          theme: previousTheme,
        },
        current: {
          revision: this.documentRevision,
          changedElementIds,
          theme: currentTheme,
        },
        operations,
      });
    }

    if (selectionChanged) {
      this.emit('selection', {
        type: 'selection',
        previous: previousSelection,
        current: currentSelection,
        operations,
      });
    }

    if (viewportChanged) {
      this.emit('viewport', {
        type: 'viewport',
        previous: previousViewport,
        current: currentViewport,
        operations,
      });
    }

    this.previousSelection = currentSelection;
    this.previousViewport = currentViewport;
    this.previousTheme = currentTheme;
  }

  private emit<TType extends PlaitCanvasEventType>(
    type: TType,
    event: PlaitCanvasEventMap[TType]
  ): void {
    const listeners = this.listeners.get(type);
    if (!listeners) {
      return;
    }

    for (const listener of Array.from(listeners)) {
      try {
        listener(event);
      } catch (error) {
        try {
          this.onListenerError(error);
        } catch {
          // Diagnostics must never break the Plait change lifecycle.
        }
      }
    }
  }

  private captureSnapshot(board: PlaitBoard): PlaitCanvasSnapshot {
    return {
      elements: cloneData(board.children ?? []),
      theme: cloneData(board.theme),
      selection: this.captureSelection(board),
      viewport: cloneData(board.viewport),
    };
  }

  private captureSelection(board: PlaitBoard): PlaitCanvasSelection {
    const ids = this.readSelectedElements(board)
      .map(getPlaitElementId)
      .filter((id): id is string => id !== null);

    return {
      range: cloneData(board.selection),
      elementIds: [...new Set(ids)],
    };
  }

  private readSelectedElements(board: PlaitBoard): PlaitElement[] {
    try {
      return this.helpers.getSelectedElements(board) ?? [];
    } catch {
      return [];
    }
  }

  private requireBoard(): PlaitBoard {
    if (!this.board) {
      throw new Error('PlaitCanvasAdapter is not attached to a board.');
    }
    return this.board;
  }

  private assertNotDisposed(): void {
    if (this._disposed) {
      throw new Error('PlaitCanvasAdapter has been disposed.');
    }
  }
}

export const createPlaitCanvasAdapterPlugin = (adapter: PlaitCanvasAdapter): PlaitPlugin =>
  adapter.asPlugin();

/** Alias following Plait's conventional `with*` plugin naming. */
export const withMagicPlaitAdapter = (adapter: PlaitCanvasAdapter): PlaitPlugin =>
  adapter.asPlugin();

/** Returns the stable string identity used by selection and ID lookups. */
export const getPlaitElementId = (element: unknown): string | null => {
  if (!isRecord(element)) {
    return null;
  }

  const directId = toElementId(element.id);
  if (directId !== null) {
    return directId;
  }

  for (const key of ['elementId', 'elementID', '_id', 'key']) {
    const candidate = toElementId(element[key]);
    if (candidate !== null) {
      return candidate;
    }
  }

  for (const key of ['data', 'meta', 'metadata', 'properties']) {
    const container = element[key];
    if (!isRecord(container)) {
      continue;
    }
    const candidate = toElementId(container.id) ?? toElementId(container.elementId);
    if (candidate !== null) {
      return candidate;
    }
  }

  return null;
};

const toElementId = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return value.length > 0 ? value : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  return null;
};

const visitElements = (
  elements: readonly PlaitElement[],
  visitor: (element: PlaitElement) => void
): void => {
  const visited = new Set<object>();
  const pending = [...elements];

  while (pending.length > 0) {
    const element = pending.shift();
    if (!element || visited.has(element)) {
      continue;
    }
    visited.add(element);
    visitor(element);

    if (Array.isArray(element.children)) {
      for (const child of element.children) {
        if (isRecord(child)) {
          pending.push(child as PlaitElement);
        }
      }
    }
  }
};

const normalizeRectangle = (rectangle: RectangleClient): RectangleClient | null => {
  const values = [rectangle?.x, rectangle?.y, rectangle?.width, rectangle?.height];
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return null;
  }
  return {
    x: rectangle.x,
    y: rectangle.y,
    width: rectangle.width,
    height: rectangle.height,
  };
};

const getFallbackBounds = (
  board: PlaitBoard,
  elements: readonly PlaitElement[]
): RectangleClient | null => {
  const rectangles = elements
    .map((element) => board.getRectangle?.(element))
    .map((rectangle) => (rectangle ? normalizeRectangle(rectangle) : null))
    .filter((rectangle): rectangle is RectangleClient => rectangle !== null);

  if (rectangles.length === 0) {
    return null;
  }

  const left = Math.min(...rectangles.map((rectangle) => rectangle.x));
  const top = Math.min(...rectangles.map((rectangle) => rectangle.y));
  const right = Math.max(...rectangles.map((rectangle) => rectangle.x + rectangle.width));
  const bottom = Math.max(...rectangles.map((rectangle) => rectangle.y + rectangle.height));

  return { x: left, y: top, width: right - left, height: bottom - top };
};

const hasOperation = (operations: readonly PlaitOperation[], type: string): boolean =>
  operations.some((operation) => operation.type === type);

const hasDocumentOperation = (operations: readonly PlaitOperation[]): boolean =>
  operations.some(
    (operation) => operation.type !== 'set_selection' && operation.type !== 'set_viewport'
  );

const getChangedElementIds = (
  board: PlaitBoard,
  operations: readonly PlaitOperation[]
): readonly string[] => {
  const ids = new Set<string>();
  for (const operation of operations) {
    if (operation.type === 'insert_node' || operation.type === 'remove_node') {
      const id = getPlaitElementId(operation.node);
      if (id) ids.add(id);
      continue;
    }
    if (operation.type === 'set_node') {
      const id = getPlaitElementId(getElementAtPath(board.children, operation.path));
      if (id) ids.add(id);
      continue;
    }
    if (operation.type === 'move_node') {
      const id = getPlaitElementId(getElementAtPath(board.children, operation.newPath));
      if (id) ids.add(id);
    }
  }
  return [...ids];
};

const getElementAtPath = (
  elements: readonly PlaitElement[],
  path: readonly number[]
): PlaitElement | undefined => {
  let children = elements;
  let current: PlaitElement | undefined;
  for (const index of path) {
    current = children[index];
    if (!current) return undefined;
    children = Array.isArray(current.children) ? current.children : [];
  }
  return current;
};

const isEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== typeof right || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => isEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(right, key) && isEqual(left[key], right[key])
  );
};

const cloneData = <T>(value: T): T => cloneDataInternal(value, new WeakMap());

const cloneDataInternal = <T>(value: T, seen: WeakMap<object, unknown>): T => {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const existing = seen.get(value);
  if (existing) {
    return existing as T;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const item of value) {
      clone.push(cloneDataInternal(item, seen));
    }
    return clone as T;
  }

  const clone: Record<PropertyKey, unknown> = {};
  seen.set(value, clone);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable) {
      clone[key] = cloneDataInternal((value as Record<PropertyKey, unknown>)[key], seen);
    }
  }
  return clone as T;
};

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === 'object' && value !== null;
