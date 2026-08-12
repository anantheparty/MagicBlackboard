import { render, screen } from '@testing-library/react';
import type { PlaitBoard, PlaitPlugin } from '@plait/core';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Drawnix } from './drawnix';

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

describe('Drawnix', () => {
  it('keeps the default API renderable', () => {
    const { container } = render(<Drawnix value={[]} />);

    expect(container.querySelector('.drawnix')).toBeTruthy();
  });

  it('appends product plugins and renders an overlay after initialization', async () => {
    const additionalPlugin = vi.fn((board: PlaitBoard) => board) as PlaitPlugin;
    const renderOverlay = vi.fn((board: PlaitBoard) => (
      <div data-testid="product-overlay" data-board-ready={String(Boolean(board))} />
    ));

    render(
      <Drawnix value={[]} additionalPlugins={[additionalPlugin]} renderOverlay={renderOverlay} />
    );

    expect((await screen.findByTestId('product-overlay')).getAttribute('data-board-ready')).toBe(
      'true'
    );
    expect(additionalPlugin).toHaveBeenCalledOnce();
    expect(renderOverlay).toHaveBeenCalled();
  });
});
