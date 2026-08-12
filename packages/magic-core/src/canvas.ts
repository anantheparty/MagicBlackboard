import type { MagicDisposer, MagicDisposable } from './disposable';

export type CanvasPoint = readonly [number, number];

export interface CanvasBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MagicCanvasSelection<Selection = unknown> {
  readonly range: Selection | null;
  readonly elementIds: readonly string[];
}

export interface MagicCanvasSnapshot<
  Element = unknown,
  Selection = unknown,
  Viewport = unknown,
  Theme = unknown,
> {
  readonly elements: readonly Element[];
  readonly selection: MagicCanvasSelection<Selection>;
  readonly viewport: Viewport;
  readonly theme?: Theme;
}

export interface MagicCanvasDocument<Theme = unknown> {
  /** Monotonic adapter-local document revision; full elements are queried on demand. */
  readonly revision: number;
  readonly changedElementIds: readonly string[];
  readonly theme?: Theme;
}

export interface MagicCanvasChangeEvent<Type extends string, Value, Snapshot> {
  readonly type: Type;
  readonly previous: Value;
  readonly current: Value;
  /** Optional by design: consumers query the adapter when a full snapshot is needed. */
  readonly snapshot?: Snapshot;
}

export type MagicCanvasEventMap<
  Element = unknown,
  Selection = unknown,
  Viewport = unknown,
  Theme = unknown,
> = {
  readonly selection: MagicCanvasChangeEvent<
    'selection',
    MagicCanvasSelection<Selection>,
    MagicCanvasSnapshot<Element, Selection, Viewport, Theme>
  >;
  readonly document: MagicCanvasChangeEvent<
    'document',
    MagicCanvasDocument<Theme>,
    MagicCanvasSnapshot<Element, Selection, Viewport, Theme>
  >;
  readonly viewport: MagicCanvasChangeEvent<
    'viewport',
    Viewport,
    MagicCanvasSnapshot<Element, Selection, Viewport, Theme>
  >;
};

export interface MagicCanvasAdapter<
  Board = unknown,
  Element = unknown,
  Selection = unknown,
  Viewport = unknown,
  Theme = unknown,
> extends MagicDisposable {
  readonly isAttached: boolean;
  attach(board: Board): void;
  detach(): void;
  getSnapshot(): MagicCanvasSnapshot<Element, Selection, Viewport, Theme>;
  getSelection(): MagicCanvasSelection<Selection>;
  getElementsByIds(ids: readonly string[]): readonly Element[];
  getSelectionBounds(): CanvasBounds | null;
  worldToScreen(point: CanvasPoint): CanvasPoint;
  screenToWorld(point: CanvasPoint): CanvasPoint;
  subscribe<Type extends keyof MagicCanvasEventMap<Element, Selection, Viewport, Theme>>(
    type: Type,
    listener: (event: MagicCanvasEventMap<Element, Selection, Viewport, Theme>[Type]) => void
  ): MagicDisposer;
}
