import { act, render, screen } from '@testing-library/react';
import type { PlaitBoard, PlaitPlugin } from '@plait/core';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { Drawnix } from './drawnix';
import { buildFreehandInkPlugin } from './plugins/freehand/ink';
import { FreehandShape } from './plugins/freehand/type';

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

  it('does not retain built-in ImageViewer constructor resources across StrictMode unmount', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const stylesBefore = imageViewerStyleCount();

    const view = render(
      <StrictMode>
        <Drawnix value={[]} />
      </StrictMode>
    );

    const keydownAdds = addEventListener.mock.calls.filter(([type]) => type === 'keydown');
    const wheelAdds = addEventListener.mock.calls.filter(([type]) => type === 'wheel');
    expect(keydownAdds).toHaveLength(2);
    expect(wheelAdds).toHaveLength(2);
    expect(imageViewerStyleCount()).toBe(stylesBefore + 1);
    expect(
      removeEventListener.mock.calls.filter(
        ([type, handler]) => type === 'keydown' && handler === keydownAdds[0][1]
      )
    ).toHaveLength(1);
    expect(
      removeEventListener.mock.calls.filter(
        ([type, handler]) => type === 'keydown' && handler === keydownAdds[1][1]
      )
    ).toHaveLength(0);

    view.unmount();
    view.unmount();

    expect(imageViewerStyleCount()).toBe(stylesBefore);
    expect(
      removeEventListener.mock.calls.filter(
        ([type, handler]) => type === 'keydown' && handler === keydownAdds[1][1]
      )
    ).toHaveLength(1);
    expect(
      removeEventListener.mock.calls.filter(
        ([type, handler]) => type === 'wheel' && handler === wheelAdds[1][1]
      )
    ).toHaveLength(1);
    addEventListener.mockRestore();
    removeEventListener.mockRestore();
  });

  it('self-cleans active generic pressure input on unmount and remounts independently', async () => {
    let nextFrameId = 0;
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      nextFrameId += 1;
      frameCallbacks.set(nextFrameId, callback);
      return nextFrameId;
    });
    const cancelFrame = vi.fn((frameId: number) => frameCallbacks.delete(frameId));
    const originalRequestFrame = globalThis.requestAnimationFrame;
    const originalCancelFrame = globalThis.cancelAnimationFrame;
    Object.defineProperties(globalThis, {
      requestAnimationFrame: { configurable: true, value: requestFrame },
      cancelAnimationFrame: { configurable: true, value: cancelFrame },
    });

    const inkPlugin = buildFreehandInkPlugin({ getMode: () => 'pressure' });
    const mountedBoards: PlaitBoard[] = [];
    try {
      const first = render(
        <Drawnix
          value={[]}
          initialToolState={{ pointer: FreehandShape.feltTipPen }}
          additionalPlugins={[inkPlugin]}
          afterInit={(board) => mountedBoards.push(board)}
        />
      );
      const firstBoard = mountedBoards[0];
      const firstHost = first.container.querySelector('.board-host-svg') as SVGSVGElement;
      const setPointerCapture = vi.fn();
      const hasPointerCapture = vi.fn(() => true);
      const releasePointerCapture = vi.fn();
      Object.defineProperties(firstHost, {
        setPointerCapture: { configurable: true, value: setPointerCapture },
        hasPointerCapture: { configurable: true, value: hasPointerCapture },
        releasePointerCapture: { configurable: true, value: releasePointerCapture },
      });

      act(() => {
        firstBoard.pointerDown(pressurePointerEvent(firstHost, 7, 0, 0, 1, 0.1, 'pointerdown'));
        firstBoard.pointerMove(pressurePointerEvent(firstHost, 7, 20, 10, 10, 0.7));
      });
      const staleFrame = frameCallbacks.get(1);
      expect(requestFrame).toHaveBeenCalledOnce();
      expect(setPointerCapture).toHaveBeenCalledWith(7);

      first.unmount();
      await act(async () => {
        await Promise.resolve();
      });
      first.unmount();
      firstHost.dispatchEvent(pressureDomEvent(7, 30, 20, 20, 0.9, 'pointerdown'));
      staleFrame?.(16);

      expect(cancelFrame).toHaveBeenCalledOnce();
      expect(frameCallbacks.size).toBe(0);
      expect(hasPointerCapture).toHaveBeenCalledWith(7);
      expect(releasePointerCapture).toHaveBeenCalledOnce();
      expect(firstBoard.children).toEqual([]);
      expect(requestFrame).toHaveBeenCalledOnce();

      const second = render(
        <Drawnix
          value={[]}
          initialToolState={{ pointer: FreehandShape.feltTipPen }}
          additionalPlugins={[inkPlugin]}
          afterInit={(board) => mountedBoards.push(board)}
        />
      );
      const secondBoard = mountedBoards[1];
      expect(secondBoard).not.toBe(firstBoard);

      act(() => {
        secondBoard.pointerDown(pressurePointerEvent(null, 8, 0, 0, 100, 0.1, 'pointerdown'));
        secondBoard.pointerMove(pressurePointerEvent(null, 8, 12, 3, 110, 0.3));
        secondBoard.pointerMove(pressurePointerEvent(null, 8, 24, 6, 120, 0.6));
        secondBoard.pointerMove(pressurePointerEvent(null, 8, 40, 10, 130, 0.9));
        secondBoard.pointerUp(pressurePointerEvent(null, 8, 40, 10, 140, 0, 'pointerup'));
      });

      expect(secondBoard.children).toHaveLength(1);
      expect(secondBoard.children[0]).toMatchObject({
        type: 'freehand',
        ink: { version: 1, widths: expect.any(Array) },
      });

      second.unmount();
      await act(async () => {
        await Promise.resolve();
      });
      expect(releasePointerCapture).toHaveBeenCalledOnce();
    } finally {
      restoreAnimationFrame('requestAnimationFrame', originalRequestFrame);
      restoreAnimationFrame('cancelAnimationFrame', originalCancelFrame);
    }
  });
});

function pressurePointerEvent(
  currentTarget: EventTarget | null,
  pointerId: number,
  clientX: number,
  clientY: number,
  timeStamp: number,
  pressure: number,
  type = 'pointermove'
): PointerEvent {
  return {
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX,
    clientY,
    currentTarget,
    isPrimary: true,
    pointerId,
    pointerType: 'pen',
    pressure,
    timeStamp,
    type,
    x: clientX,
    y: clientY,
  } as unknown as PointerEvent;
}

function pressureDomEvent(
  pointerId: number,
  clientX: number,
  clientY: number,
  timeStamp: number,
  pressure: number,
  type: string
): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    buttons: { value: type === 'pointerup' ? 0 : 1 },
    clientX: { value: clientX },
    clientY: { value: clientY },
    isPrimary: { value: true },
    pointerId: { value: pointerId },
    pointerType: { value: 'pen' },
    pressure: { value: pressure },
    timeStamp: { value: timeStamp },
    x: { value: clientX },
    y: { value: clientY },
  });
  return event;
}

function restoreAnimationFrame(
  key: 'requestAnimationFrame' | 'cancelAnimationFrame',
  value: typeof requestAnimationFrame | typeof cancelAnimationFrame | undefined
): void {
  if (value) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  } else {
    Reflect.deleteProperty(globalThis, key);
  }
}

function imageViewerStyleCount(): number {
  return [...document.head.querySelectorAll('style')].filter((style) =>
    style.textContent?.includes('.image-viewer-control-btn')
  ).length;
}
