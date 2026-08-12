import type { PlaitBoard } from '@plait/core';
import { describe, expect, it, vi } from 'vitest';
import {
  dispatchBoardPointerLifecycle,
  setBoardPointerLifecycleHandler,
} from './pointer-lifecycle';

describe('board pointer lifecycle seam', () => {
  it('does not let a stale disposer remove a replacement handler', () => {
    const board = {} as PlaitBoard;
    const first = vi.fn();
    const second = vi.fn();
    const disposeFirst = setBoardPointerLifecycleHandler(board, first);
    const disposeSecond = setBoardPointerLifecycleHandler(board, second);

    disposeFirst();
    disposeFirst();
    dispatchBoardPointerLifecycle(board, { reason: 'orientation-change' });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();

    disposeSecond();
    disposeSecond();
    dispatchBoardPointerLifecycle(board, { reason: 'viewport-change' });
    expect(second).toHaveBeenCalledOnce();
  });

  it('isolates handlers and disposal between boards', () => {
    const firstBoard = {} as PlaitBoard;
    const secondBoard = {} as PlaitBoard;
    const first = vi.fn();
    const second = vi.fn();
    const disposeFirst = setBoardPointerLifecycleHandler(firstBoard, first);
    const disposeSecond = setBoardPointerLifecycleHandler(secondBoard, second);

    dispatchBoardPointerLifecycle(firstBoard, { reason: 'pointer-cancel', pointerId: 1 });
    expect(first).toHaveBeenCalledWith({ reason: 'pointer-cancel', pointerId: 1 });
    expect(second).not.toHaveBeenCalled();

    disposeFirst();
    dispatchBoardPointerLifecycle(firstBoard, { reason: 'orientation-change' });
    dispatchBoardPointerLifecycle(secondBoard, { reason: 'lost-pointer-capture', pointerId: 2 });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledWith({ reason: 'lost-pointer-capture', pointerId: 2 });

    disposeSecond();
  });
});
