import { createMagicRuntime } from '@magic-blackboard/runtime';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMagicConsoleShortcut, MagicConsole } from './magic-console';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MagicConsole', () => {
  it('recognizes the cross-platform development shortcut', () => {
    expect(
      isMagicConsoleShortcut({ key: 'd', shiftKey: true, metaKey: true, ctrlKey: false })
    ).toBe(true);
    expect(
      isMagicConsoleShortcut({ key: 'D', shiftKey: true, metaKey: false, ctrlKey: true })
    ).toBe(true);
    expect(
      isMagicConsoleShortcut({ key: 'd', shiftKey: false, metaKey: true, ctrlKey: false })
    ).toBe(false);
  });

  it('does not steal the shortcut from editable controls', () => {
    const runtime = createMagicRuntime();
    render(
      <div>
        <input aria-label="Editor" />
        <MagicConsole runtime={runtime} />
      </div>
    );

    fireEvent.keyDown(screen.getByLabelText('Editor'), {
      key: 'd',
      shiftKey: true,
      metaKey: true,
    });
    expect(screen.queryByRole('complementary')).toBeNull();
    runtime.dispose();
  });

  it('subscribes only while open and cleans up listeners on close/unmount', async () => {
    const runtime = createMagicRuntime();
    await runtime.features.register({
      id: 'magic.actor',
      title: 'Actor',
      defaultEnabled: false,
    });
    const subscribeAll = vi.spyOn(runtime.events, 'subscribeAll');
    const subscribeFeatures = vi.spyOn(runtime.features, 'subscribe');
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const onStateChange = vi.fn();
    const view = render(<MagicConsole runtime={runtime} onStateChange={onStateChange} />);

    expect(screen.queryByRole('complementary')).toBeNull();
    expect(subscribeAll).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'D', shiftKey: true, metaKey: true });
    expect(await screen.findByRole('complementary')).toBeTruthy();
    expect(subscribeAll).toHaveBeenCalledOnce();
    expect(subscribeFeatures).toHaveBeenCalledOnce();
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ open: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Close console' }));
    expect(screen.queryByRole('complementary')).toBeNull();

    view.unmount();
    expect(removeWindowListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    runtime.dispose();
  });

  it('shows unavailable placeholder features without enabling them', async () => {
    const runtime = createMagicRuntime();
    await runtime.features.register({
      id: 'magic.actor',
      title: 'Actor',
      description: 'No implementation is connected.',
      defaultEnabled: false,
      available: false,
    });

    render(<MagicConsole runtime={runtime} initialState={{ open: true, tab: 'Features' }} />);

    const toggle = screen.getByRole('checkbox', { name: 'Actor feature' });
    expect(toggle.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/Unavailable in this milestone/)).toBeTruthy();
    runtime.dispose();
  });

  it('does not install keyboard listeners when unavailable', () => {
    const runtime = createMagicRuntime();
    const addWindowListener = vi.spyOn(window, 'addEventListener');

    const view = render(<MagicConsole runtime={runtime} available={false} />);
    act(() => fireEvent.keyDown(window, { key: 'd', shiftKey: true, ctrlKey: true }));

    expect(view.container.innerHTML).toBe('');
    expect(addWindowListener.mock.calls.some(([type]) => type === 'keydown')).toBe(false);
    view.unmount();
    runtime.dispose();
  });
});
