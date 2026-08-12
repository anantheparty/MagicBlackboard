import type { PlaitOperation, Viewport } from '@plait/core';
import { BoardTransforms, MIN_ZOOM, type PlaitBoard } from '@plait/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fitViewportWithinZoomBounds } from './fit-viewport';

const geometry = vi.hoisted(() => ({
  containerWidth: 100,
  containerHeight: 100,
  elementWidth: 10_000,
  elementHeight: 10_000,
}));

vi.mock('@plait/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plait/core')>();
  return {
    ...actual,
    PlaitBoard: {
      ...actual.PlaitBoard,
      getBoardContainer: () => ({
        getBoundingClientRect: () => ({
          bottom: geometry.containerHeight,
          height: geometry.containerHeight,
          left: 0,
          right: geometry.containerWidth,
          top: 0,
          width: geometry.containerWidth,
          x: 0,
          y: 0,
        }),
      }),
    },
    getRealScrollBarWidth: () => 0,
    getRectangleByElements: () => ({
      height: geometry.elementHeight,
      width: geometry.elementWidth,
      x: 0,
      y: 0,
    }),
    getViewBoxCenterPoint: () => [geometry.elementWidth / 2, geometry.elementHeight / 2],
  };
});

beforeEach(() => {
  geometry.containerWidth = 100;
  geometry.containerHeight = 100;
  geometry.elementWidth = 10_000;
  geometry.elementHeight = 10_000;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fitViewportWithinZoomBounds', () => {
  it.each([
    ['an oversized document', 100],
    ['a container smaller than the fit padding', 20],
  ])('emits one bounded viewport operation for %s', (_name, containerSize) => {
    geometry.containerWidth = containerSize;
    geometry.containerHeight = containerSize;
    const operations: PlaitOperation[] = [];
    const board = {
      children: [],
      viewport: { zoom: 1 },
      apply: (operation: PlaitOperation) => {
        operations.push(operation);
        if (operation.type === 'set_viewport') {
          board.viewport = operation.newProperties as Viewport;
        }
      },
    } as unknown as PlaitBoard;
    const rawFit = vi.spyOn(BoardTransforms, 'fitViewport');

    fitViewportWithinZoomBounds(board);

    expect(rawFit).not.toHaveBeenCalled();
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      type: 'set_viewport',
      newProperties: { zoom: MIN_ZOOM },
    });
    expect(
      operations.every(
        (operation) =>
          operation.type !== 'set_viewport' ||
          (operation.newProperties.zoom ?? MIN_ZOOM) >= MIN_ZOOM
      )
    ).toBe(true);
    expect(board.viewport.zoom).toBe(MIN_ZOOM);
  });
});
