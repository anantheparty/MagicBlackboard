import {
  BOARD_TO_MOVING_POINT_IN_BOARD,
  BoardTransforms,
  createBoard,
  withHotkey,
  type PlaitBoard,
} from '@plait/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDrawnixHotkeyPlugin } from './with-hotkey';

const mocks = vi.hoisted(() => ({
  fitViewport: vi.fn(),
}));

vi.mock('../components/toolbar/fit-viewport', () => ({
  fitViewportWithinZoomBounds: mocks.fitViewport,
}));

afterEach(() => {
  mocks.fitViewport.mockReset();
  vi.restoreAllMocks();
});

describe('Drawnix fit hotkey', () => {
  it('intercepts the raw Plait fit shortcut and uses the bounded helper', () => {
    const board = withHotkey(createBoard([]));
    const rawFit = vi.spyOn(BoardTransforms, 'fitViewport').mockImplementation(() => undefined);
    BOARD_TO_MOVING_POINT_IN_BOARD.set(board, [10, 10]);
    buildDrawnixHotkeyPlugin(vi.fn())(board);
    const usesMeta = /Mac|iPod|iPhone|iPad/.test(window.navigator.platform);
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: '=',
      shiftKey: true,
      ...(usesMeta ? { metaKey: true } : { ctrlKey: true }),
    });

    board.globalKeyDown(event);

    expect(event.defaultPrevented).toBe(true);
    expect(mocks.fitViewport).toHaveBeenCalledOnce();
    expect(mocks.fitViewport).toHaveBeenCalledWith(board as PlaitBoard);
    expect(rawFit).not.toHaveBeenCalled();
  });
});
