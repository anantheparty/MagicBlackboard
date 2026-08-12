import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBoardContainer: vi.fn(),
}));

vi.mock('@plait/core', () => ({
  PlaitBoard: {
    getBoardContainer: mocks.getBoardContainer,
  },
}));

vi.mock('laser-pen', () => ({
  drainPoints: (points: unknown[]) => points,
  drawLaserPen: vi.fn(),
  setColor: vi.fn(),
  setDelay: vi.fn(),
  setMaxWidth: vi.fn(),
  setMinWidth: vi.fn(),
  setOpacity: vi.fn(),
  setRoundCap: vi.fn(),
}));

import { LaserPointer, LASER_POINTER_CLASS_NAME } from './laser-pointer';

beforeEach(() => {
  mocks.getBoardContainer.mockReset();
});

describe('LaserPointer lifecycle', () => {
  it('replaces an existing attachment and removes every listener exactly once', () => {
    const drawnix = document.createElement('div');
    drawnix.className = 'drawnix';
    const boardContainer = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.className = LASER_POINTER_CLASS_NAME;
    drawnix.append(boardContainer, canvas);
    document.body.append(drawnix);
    mocks.getBoardContainer.mockReturnValue(boardContainer);
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      scale: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const containerAdd = vi.spyOn(drawnix, 'addEventListener');
    const containerRemove = vi.spyOn(drawnix, 'removeEventListener');
    const windowAdd = vi.spyOn(window, 'addEventListener');
    const windowRemove = vi.spyOn(window, 'removeEventListener');
    const pointer = new LaserPointer();

    pointer.init({} as never);
    const firstPointerHandler = containerAdd.mock.calls.find(
      ([type]) => type === 'pointermove'
    )?.[1];
    const firstResizeHandler = windowAdd.mock.calls.find(([type]) => type === 'resize')?.[1];
    pointer.init({} as never);
    const pointerAdds = containerAdd.mock.calls.filter(([type]) => type === 'pointermove');
    const resizeAdds = windowAdd.mock.calls.filter(([type]) => type === 'resize');

    expect(pointerAdds).toHaveLength(2);
    expect(resizeAdds).toHaveLength(2);
    expect(containerRemove).toHaveBeenCalledWith('pointermove', firstPointerHandler);
    expect(windowRemove).toHaveBeenCalledWith('resize', firstResizeHandler);

    pointer.destroy();
    pointer.destroy();

    expect(
      containerRemove.mock.calls.filter(
        ([type, handler]) => type === 'pointermove' && handler === pointerAdds[1][1]
      )
    ).toHaveLength(1);
    expect(
      windowRemove.mock.calls.filter(
        ([type, handler]) => type === 'resize' && handler === resizeAdds[1][1]
      )
    ).toHaveLength(1);
  });
});
