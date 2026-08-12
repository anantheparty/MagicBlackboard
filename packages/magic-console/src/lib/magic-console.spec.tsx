import { createMagicRuntime } from '@magic-blackboard/runtime';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { MagicInkDiagnosticsEntry } from '@magic-blackboard/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMagicConsoleShortcut, MagicConsole } from './magic-console';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const inkEntry = (observedAt: number): MagicInkDiagnosticsEntry => ({
  observedAt,
  pointerType: 'pen',
  isPrimary: true,
  button: -1,
  buttons: 1,
  source: 'coalesced',
  strategy: 'hardware-pressure',
  receivedSamples: 4,
  acceptedSamples: 3,
  coalescedSamples: 4,
  droppedSamples: 1,
  pressure: {
    capability: 'variable-observed',
    minimum: 0.1,
    maximum: 0.9,
    distinctBucketCount: 4,
  },
  apis: {
    coalescedEvents: 'available',
    predictedEvents: 'unavailable',
    pointerRawUpdate: 'unavailable',
  },
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

  it('subscribes to input diagnostics only on the visible Input tab and batches refreshes by frame', async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    });
    const cancelAnimationFrame = vi.fn((id: number) => frames.delete(id));
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);

    const runtime = createMagicRuntime();
    await runtime.features.register({
      id: 'magic.ink-diagnostics',
      title: 'Ink diagnostics',
      defaultEnabled: false,
      available: true,
    });
    await runtime.features.setEnabled('magic.ink-diagnostics', true);
    const originalSubscribe = runtime.inkDiagnostics.subscribe.bind(runtime.inkDiagnostics);
    const inputDisposers: ReturnType<typeof vi.fn>[] = [];
    const subscribe = vi
      .spyOn(runtime.inkDiagnostics, 'subscribe')
      .mockImplementation((listener) => {
        const dispose = vi.fn(originalSubscribe(listener));
        inputDisposers.push(dispose);
        return dispose;
      });
    const getSnapshot = vi.spyOn(runtime.inkDiagnostics, 'getSnapshot');

    const view = render(<MagicConsole runtime={runtime} initialState={{ tab: 'Input' }} />);
    expect(subscribe).not.toHaveBeenCalled();
    expect(getSnapshot).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'D', shiftKey: true, metaKey: true });
    expect(await screen.findByTestId('magic-input-diagnostics')).toBeTruthy();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).toHaveBeenCalledOnce();

    act(() => {
      const [id, callback] = [...frames.entries()][0];
      frames.delete(id);
      callback(1);
    });
    const snapshotsBeforeRecords = getSnapshot.mock.calls.length;

    act(() => {
      runtime.inkDiagnostics.record(inkEntry(1));
      runtime.inkDiagnostics.record(inkEntry(2));
      runtime.inkDiagnostics.record(inkEntry(3));
    });
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(getSnapshot).toHaveBeenCalledTimes(snapshotsBeforeRecords);

    act(() => {
      const [id, callback] = [...frames.entries()][0];
      frames.delete(id);
      callback(2);
    });
    expect(getSnapshot).toHaveBeenCalledTimes(snapshotsBeforeRecords + 1);
    expect(screen.getByText('hardware-pressure')).toBeTruthy();
    expect(screen.getByText('variable-observed')).toBeTruthy();
    expect(screen.getByText('9/12 accepted · 3 input dropped · 0 geometry dropped')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('3/256 batches')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(inputDisposers[0]).toHaveBeenCalledOnce();
    const requestedBeforeInactiveRecord = requestAnimationFrame.mock.calls.length;
    act(() => runtime.inkDiagnostics.record(inkEntry(4)));
    expect(requestAnimationFrame).toHaveBeenCalledTimes(requestedBeforeInactiveRecord);

    fireEvent.click(screen.getByRole('button', { name: 'Input' }));
    expect(subscribe).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Close console' }));
    expect(inputDisposers[1]).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'D', shiftKey: true, metaKey: true });
    expect(subscribe).toHaveBeenCalledTimes(3);
    const cancellationsBeforeUnmount = cancelAnimationFrame.mock.calls.length;
    view.unmount();
    expect(inputDisposers[2]).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(cancellationsBeforeUnmount + 1);
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

  it('distinguishes a recoverable settings error from milestone unavailability', async () => {
    const runtime = createMagicRuntime({
      settings: {
        async get<Value>() {
          return 'recoverable-invalid-value' as Value;
        },
        async set() {
          return undefined;
        },
        async remove() {
          return undefined;
        },
        async clear() {
          return undefined;
        },
      },
    });
    await runtime.features.register({
      id: 'magic.actor',
      title: 'Actor',
      defaultEnabled: true,
    });

    render(<MagicConsole runtime={runtime} initialState={{ open: true, tab: 'Features' }} />);

    expect(screen.getByText(/Settings invalid; locked off without replacing storage/)).toBeTruthy();
    expect(screen.queryByText(/Unavailable in this milestone/)).toBeNull();
    runtime.dispose();
  });

  it('does not install keyboard listeners when unavailable', () => {
    const runtime = createMagicRuntime();
    const addWindowListener = vi.spyOn(window, 'addEventListener');
    const subscribeInput = vi.spyOn(runtime.inkDiagnostics, 'subscribe');

    const view = render(
      <MagicConsole
        runtime={runtime}
        available={false}
        initialState={{ open: true, tab: 'Input' }}
      />
    );
    act(() => fireEvent.keyDown(window, { key: 'd', shiftKey: true, ctrlKey: true }));

    expect(view.container.innerHTML).toBe('');
    expect(addWindowListener.mock.calls.some(([type]) => type === 'keydown')).toBe(false);
    expect(subscribeInput).not.toHaveBeenCalled();
    view.unmount();
    runtime.dispose();
  });
});
