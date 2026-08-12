import type { PlaitBoard } from '@plait/core';
import { describe, expect, it, vi } from 'vitest';
import { disposeBoardDisposers, registerBoardDisposer } from './board-disposer';

describe('board disposer registry', () => {
  it('disposes each active registration exactly once and isolates boards', () => {
    const firstBoard = {} as PlaitBoard;
    const secondBoard = {} as PlaitBoard;
    const first = vi.fn();
    const unregistered = vi.fn();
    const second = vi.fn();

    registerBoardDisposer(firstBoard, first);
    const unregister = registerBoardDisposer(firstBoard, unregistered);
    registerBoardDisposer(secondBoard, second);
    unregister();
    unregister();

    disposeBoardDisposers(firstBoard);
    disposeBoardDisposers(firstBoard);

    expect(first).toHaveBeenCalledOnce();
    expect(unregistered).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    disposeBoardDisposers(secondBoard);
    expect(second).toHaveBeenCalledOnce();
  });

  it('continues best-effort cleanup after a disposer throws', () => {
    const board = {} as PlaitBoard;
    const afterFailure = vi.fn();
    registerBoardDisposer(board, () => {
      throw new Error('synthetic cleanup failure');
    });
    registerBoardDisposer(board, afterFailure);

    expect(() => disposeBoardDisposers(board)).not.toThrow();
    expect(afterFailure).toHaveBeenCalledOnce();
  });
});
