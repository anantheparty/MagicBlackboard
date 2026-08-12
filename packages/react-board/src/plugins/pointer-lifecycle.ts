import type { PlaitBoard } from '@plait/core';

export type BoardPointerLifecycleEvent = {
  readonly reason:
    | 'pointer-cancel'
    | 'lost-pointer-capture'
    | 'orientation-change'
    | 'viewport-change';
  readonly pointerId?: number;
};

type BoardPointerLifecycleHandler = (event: BoardPointerLifecycleEvent) => void;

const BOARD_TO_POINTER_LIFECYCLE_HANDLER = new WeakMap<PlaitBoard, BoardPointerLifecycleHandler>();

export function setBoardPointerLifecycleHandler(
  board: PlaitBoard,
  handler: BoardPointerLifecycleHandler
): () => void {
  BOARD_TO_POINTER_LIFECYCLE_HANDLER.set(board, handler);
  return () => {
    if (BOARD_TO_POINTER_LIFECYCLE_HANDLER.get(board) === handler) {
      BOARD_TO_POINTER_LIFECYCLE_HANDLER.delete(board);
    }
  };
}

export function dispatchBoardPointerLifecycle(
  board: PlaitBoard,
  event: BoardPointerLifecycleEvent
): void {
  BOARD_TO_POINTER_LIFECYCLE_HANDLER.get(board)?.(event);
}
