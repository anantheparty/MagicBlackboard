import { describe, expect, it, vi } from 'vitest';
import { MagicEventBus } from './event-bus';

interface TestEvents {
  readonly count: { readonly value: number };
  readonly status: string;
}

describe('MagicEventBus', () => {
  it('delivers typed events and keeps bounded history', () => {
    let time = 100;
    const bus = new MagicEventBus<TestEvents>({ historyCapacity: 2, now: () => time++ });
    const countListener = vi.fn();
    const allListener = vi.fn();
    const unsubscribe = bus.subscribe('count', countListener);
    bus.subscribeAll(allListener);

    bus.emit('count', { value: 1 });
    bus.emit('status', 'ready');
    bus.emit('count', { value: 2 });
    unsubscribe();
    bus.emit('count', { value: 3 });

    expect(countListener).toHaveBeenCalledTimes(2);
    expect(countListener.mock.calls[0][0]).toMatchObject({
      sequence: 1,
      type: 'count',
      payload: { value: 1 },
      timestamp: 100,
    });
    expect(allListener).toHaveBeenCalledTimes(4);
    expect(bus.getHistory().map((event) => event.sequence)).toEqual([3, 4]);
  });

  it('disposes listeners and retained history idempotently', () => {
    const bus = new MagicEventBus<TestEvents>();
    const listener = vi.fn();
    bus.subscribe('status', listener);
    bus.emit('status', 'before');

    bus.dispose();
    bus.dispose();
    bus.emit('status', 'after');

    expect(bus.disposed).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(bus.getHistory()).toEqual([]);
  });

  it('notifies remaining listeners and reports handler failures', () => {
    const bus = new MagicEventBus<TestEvents>();
    const failure = new Error('listener failed');
    const survivor = vi.fn();
    bus.subscribe('status', () => {
      throw failure;
    });
    bus.subscribe('status', survivor);

    expect(() => bus.emit('status', 'ready')).toThrow('1 listener failed');
    expect(survivor).toHaveBeenCalledTimes(1);
    expect(bus.getHistory()).toHaveLength(1);
  });

  it('uses an emit snapshot when one listener unsubscribes another', () => {
    const bus = new MagicEventBus<TestEvents>();
    const second = vi.fn();
    let unsubscribeSecond: () => void = () => undefined;
    bus.subscribe('status', () => unsubscribeSecond());
    unsubscribeSecond = bus.subscribe('status', second);

    bus.emit('status', 'first');
    bus.emit('status', 'second');

    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ payload: 'first' }));
  });

  it('can retain an event envelope without retaining its payload', () => {
    const bus = new MagicEventBus<TestEvents>();
    const listener = vi.fn();
    bus.subscribe('count', listener);

    bus.emit('count', { value: 42 }, { retainPayload: false });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: { value: 42 } }));
    expect(bus.getHistory()).toEqual([
      expect.objectContaining({ type: 'count', sequence: 1, timestamp: expect.any(Number) }),
    ]);
    expect(bus.getHistory()[0]).not.toHaveProperty('payload');
  });
});
