import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZoomToolbar } from './zoom-toolbar';

const mocks = vi.hoisted(() => ({
  board: { viewport: { zoom: 1 } },
  fitViewport: vi.fn(),
  updateZoom: vi.fn(),
}));

vi.mock('@plait-board/react-board', () => ({
  useBoard: () => mocks.board,
}));

vi.mock('@plait/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plait/core')>();
  return {
    ...actual,
    BoardTransforms: {
      ...actual.BoardTransforms,
      updateZoom: mocks.updateZoom,
    },
    PlaitBoard: {
      ...actual.PlaitBoard,
      getBoardContainer: () => document.body,
    },
  };
});

vi.mock('../../i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('./fit-viewport', () => ({
  fitViewportWithinZoomBounds: mocks.fitViewport,
}));

beforeEach(() => {
  mocks.board.viewport.zoom = 1;
  mocks.fitViewport.mockReset();
  mocks.updateZoom.mockReset();
});

describe('ZoomToolbar', () => {
  it('routes Fit to Screen through the bounded viewport helper', async () => {
    render(<ZoomToolbar />);

    fireEvent.pointerUp(screen.getByLabelText('zoom.fit'));
    fireEvent.click(await screen.findByRole('button', { name: 'zoom.fit' }));

    expect(mocks.fitViewport).toHaveBeenCalledOnce();
    expect(mocks.fitViewport).toHaveBeenCalledWith(mocks.board);
  });
});
