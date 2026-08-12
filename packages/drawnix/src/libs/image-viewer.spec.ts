import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageViewer } from './image-viewer';

afterEach(() => {
  document.head.querySelectorAll('style').forEach((style) => {
    if (style.textContent?.includes('.image-viewer-control-btn')) {
      style.remove();
    }
  });
  document.body.innerHTML = '';
  document.body.style.overflow = '';
  vi.restoreAllMocks();
});

describe('ImageViewer lifecycle', () => {
  it('unconditionally removes constructor listeners and styles exactly once', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const viewer = new ImageViewer();
    const style = [...document.head.querySelectorAll('style')].find((candidate) =>
      candidate.textContent?.includes('.image-viewer-control-btn')
    );
    const keydownHandler = addEventListener.mock.calls.find(([type]) => type === 'keydown')?.[1];
    const wheelHandler = addEventListener.mock.calls.find(([type]) => type === 'wheel')?.[1];

    expect(style).not.toBeNull();
    expect(keydownHandler).toBeDefined();
    expect(wheelHandler).toBeDefined();

    viewer.destroy();
    viewer.destroy();

    expect(style?.isConnected).toBe(false);
    expect(
      removeEventListener.mock.calls.filter(
        ([type, handler]) => type === 'keydown' && handler === keydownHandler
      )
    ).toHaveLength(1);
    expect(
      removeEventListener.mock.calls.filter(
        ([type, handler]) => type === 'wheel' && handler === wheelHandler
      )
    ).toHaveLength(1);
  });
});
