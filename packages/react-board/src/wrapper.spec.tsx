import { act, render } from '@testing-library/react';
import { ElementFlavour, type PlaitBoard, type PlaitPlugin } from '@plait/core';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { Board } from './board';
import { registerBoardDisposer } from './plugins/board-disposer';
import { Wrapper } from './wrapper';

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

describe('Wrapper board ownership', () => {
  it('disposes generic per-board resources once across unmount and remount', async () => {
    const boards: PlaitBoard[] = [];
    const disposers: Array<ReturnType<typeof vi.fn>> = [];
    const plugin = ((board: PlaitBoard) => {
      const dispose = vi.fn();
      boards.push(board);
      disposers.push(dispose);
      registerBoardDisposer(board, dispose);
      return board;
    }) as PlaitPlugin;

    const first = render(
      <Wrapper value={[]} options={{}} plugins={[plugin]}>
        <Board />
      </Wrapper>
    );

    expect(disposers).toHaveLength(1);
    first.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    first.unmount();
    expect(disposers[0]).toHaveBeenCalledOnce();

    const second = render(
      <Wrapper value={[]} options={{}} plugins={[plugin]}>
        <Board />
      </Wrapper>
    );

    expect(disposers).toHaveLength(2);
    expect(boards[1]).not.toBe(boards[0]);
    expect(disposers[1]).not.toHaveBeenCalled();

    second.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(disposers[1]).toHaveBeenCalledOnce();
  });

  it('disposes every discarded StrictMode board and keeps only the live board until unmount', () => {
    const boards: PlaitBoard[] = [];
    const boardDisposers = new Map<PlaitBoard, ReturnType<typeof vi.fn>>();
    const plugin = ((board: PlaitBoard) => {
      const dispose = vi.fn();
      boards.push(board);
      boardDisposers.set(board, dispose);
      registerBoardDisposer(board, dispose);
      return board;
    }) as PlaitPlugin;
    let liveBoard: PlaitBoard | null = null;

    const view = render(
      <StrictMode>
        <Wrapper value={[]} options={{}} plugins={[plugin]}>
          <Board afterInit={(board) => (liveBoard = board)} />
        </Wrapper>
      </StrictMode>
    );
    expect(boards).toHaveLength(2);
    expect(boards[0]).not.toBe(boards[1]);
    expect(liveBoard).toBe(boards[1]);
    expect(liveBoard).not.toBeNull();
    expect(boardDisposers.get(boards[0])).toHaveBeenCalledOnce();
    expect(boardDisposers.get(liveBoard!)).not.toHaveBeenCalled();

    view.unmount();
    view.unmount();
    expect(boardDisposers.get(boards[0])).toHaveBeenCalledOnce();
    expect(boardDisposers.get(liveBoard!)).toHaveBeenCalledOnce();
  });

  it('destroys active component listeners before board disposers and remounts independently', () => {
    const cleanupOrder: string[] = [];
    const componentDestroys = vi.fn();
    const activeKeydowns = vi.fn();
    class ActiveTextComponent extends ElementFlavour {
      private readonly keydown = () => activeKeydowns();

      override initialize(): void {
        super.initialize();
        document.addEventListener('keydown', this.keydown);
      }

      override destroy(): void {
        cleanupOrder.push('list-render');
        componentDestroys();
        document.removeEventListener('keydown', this.keydown);
        super.destroy();
      }
    }
    const plugin = ((board: PlaitBoard) => {
      board.drawElement = () => ActiveTextComponent;
      registerBoardDisposer(board, () => cleanupOrder.push('board-disposer'));
      return board;
    }) as PlaitPlugin;

    const first = render(
      <Wrapper value={[{ id: 'text-1', type: 'active-text' }]} options={{}} plugins={[plugin]}>
        <Board />
      </Wrapper>
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(activeKeydowns).toHaveBeenCalledOnce();

    first.unmount();
    first.unmount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));

    expect(componentDestroys).toHaveBeenCalledOnce();
    expect(activeKeydowns).toHaveBeenCalledOnce();
    expect(cleanupOrder).toEqual(['list-render', 'board-disposer']);

    const second = render(
      <Wrapper value={[{ id: 'text-2', type: 'active-text' }]} options={{}} plugins={[plugin]}>
        <Board />
      </Wrapper>
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
    expect(activeKeydowns).toHaveBeenCalledTimes(2);
    second.unmount();
    expect(componentDestroys).toHaveBeenCalledTimes(2);
  });
});
