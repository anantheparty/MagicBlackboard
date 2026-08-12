import type {
  CanvasBounds,
  CanvasPoint,
  MagicCanvasAdapter,
  MagicCanvasEventMap,
  MagicCanvasSelection,
  MagicCanvasSnapshot,
  MagicActor,
} from '@magic-blackboard/core';
import { describe, expect, it, vi } from 'vitest';
import { createMagicRuntime, MagicRuntimeCleanupError } from './runtime';

class TestCanvas implements MagicCanvasAdapter<string> {
  readonly #listeners = new Map<
    keyof MagicCanvasEventMap,
    (event: MagicCanvasEventMap[keyof MagicCanvasEventMap]) => void
  >();
  isAttached = true;
  disposed = false;
  throwOnDispose = false;
  readonly detach = vi.fn(() => {
    this.isAttached = false;
  });
  readonly dispose = vi.fn(() => {
    this.disposed = true;
    this.isAttached = false;
    if (this.throwOnDispose) {
      throw new Error('canvas dispose failed');
    }
  });

  attach(): void {
    this.isAttached = true;
  }

  getSnapshot(): MagicCanvasSnapshot {
    return { elements: [], selection: this.getSelection(), viewport: null };
  }

  getSelection(): MagicCanvasSelection {
    return { range: null, elementIds: [] };
  }

  getElementsByIds(): readonly unknown[] {
    return [];
  }

  getSelectionBounds(): CanvasBounds | null {
    return null;
  }

  worldToScreen(point: CanvasPoint): CanvasPoint {
    return point;
  }

  screenToWorld(point: CanvasPoint): CanvasPoint {
    return point;
  }

  subscribe<Type extends keyof MagicCanvasEventMap>(
    type: Type,
    listener: (event: MagicCanvasEventMap[Type]) => void
  ): () => void {
    this.#listeners.set(
      type,
      listener as (event: MagicCanvasEventMap[keyof MagicCanvasEventMap]) => void
    );
    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      this.#listeners.delete(type);
    };
  }

  emitDocument(): void {
    const snapshot = this.getSnapshot();
    this.#listeners.get('document')?.({
      type: 'document',
      previous: { revision: 0, changedElementIds: [] },
      current: { revision: 1, changedElementIds: [] },
      snapshot,
    });
  }

  get subscriptionCount(): number {
    return this.#listeners.size;
  }
}

class FailingSubscriptionCanvas extends TestCanvas {
  #subscriptionAttempts = 0;

  override subscribe<Type extends keyof MagicCanvasEventMap>(
    type: Type,
    listener: (event: MagicCanvasEventMap[Type]) => void
  ): () => void {
    this.#subscriptionAttempts += 1;
    if (this.#subscriptionAttempts === 2) {
      throw new Error('subscription failed');
    }
    return super.subscribe(type, listener);
  }
}

describe('createMagicRuntime', () => {
  it('isolates board state, events, features, and canvas ownership', async () => {
    const firstCanvas = new TestCanvas();
    const secondCanvas = new TestCanvas();
    const first = createMagicRuntime({ boardId: 'board-a', canvas: firstCanvas });
    const second = createMagicRuntime({ boardId: 'board-b', canvas: secondCanvas });
    const firstEvents = vi.fn();
    const secondEvents = vi.fn();
    first.events.subscribeAll(firstEvents);
    second.events.subscribeAll(secondEvents);

    expect(first.id).not.toBe(second.id);
    expect(first.boardId).toBe('board-a');
    expect(second.boardId).toBe('board-b');
    expect(first.actors).toEqual([]);
    expect(first.intentRecognizer).toBeNull();
    expect(firstCanvas.subscriptionCount).toBe(3);
    expect(secondCanvas.subscriptionCount).toBe(3);

    await first.features.register({ id: 'magic.actor', defaultEnabled: false });
    await second.features.register({ id: 'magic.actor', defaultEnabled: false });
    await first.features.setEnabled('magic.actor', true);
    await first.settings.set('board.value', 'first');
    await second.settings.set('board.value', 'second');
    first.events.emit('canvas:attached', { runtimeId: first.id, boardId: first.boardId });

    expect(first.features.isEnabled('magic.actor')).toBe(true);
    expect(second.features.isEnabled('magic.actor')).toBe(false);
    expect(await first.settings.get('board.value')).toBe('first');
    expect(await second.settings.get('board.value')).toBe('second');
    expect(firstEvents).toHaveBeenCalledTimes(1);
    expect(secondEvents).not.toHaveBeenCalled();

    firstCanvas.emitDocument();
    expect(firstEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'canvas:document' })
    );
    expect(secondEvents).not.toHaveBeenCalled();
    const firstHistory = first.events.getHistory();
    expect(firstHistory[firstHistory.length - 1]).not.toHaveProperty('payload');

    first.dispose();
    first.dispose();

    expect(first.disposed).toBe(true);
    expect(first.canvas).toBeNull();
    expect(firstCanvas.dispose).toHaveBeenCalledTimes(1);
    expect(firstCanvas.subscriptionCount).toBe(0);
    expect(second.disposed).toBe(false);
    expect(second.canvas).toBe(secondCanvas);
    expect(secondCanvas.dispose).not.toHaveBeenCalled();

    second.dispose();
    expect(secondCanvas.subscriptionCount).toBe(0);
    expect(secondCanvas.dispose).toHaveBeenCalledTimes(1);
  });

  it('can release a canvas without disposing it', () => {
    const canvas = new TestCanvas();
    const runtime = createMagicRuntime({ canvas });

    expect(runtime.detachCanvas()).toBe(canvas);
    expect(canvas.detach).toHaveBeenCalledTimes(1);
    expect(canvas.dispose).not.toHaveBeenCalled();
    expect(canvas.subscriptionCount).toBe(0);

    runtime.dispose();
    expect(canvas.dispose).not.toHaveBeenCalled();
  });

  it('unsubscribes from a replaced canvas before disposing it', () => {
    const previous = new TestCanvas();
    const replacement = new TestCanvas();
    const runtime = createMagicRuntime({ canvas: previous });
    const listener = vi.fn();
    runtime.events.subscribe('canvas:document', listener);

    runtime.attachCanvas(replacement);
    previous.emitDocument();
    replacement.emitDocument();

    expect(previous.subscriptionCount).toBe(0);
    expect(previous.dispose).toHaveBeenCalledTimes(1);
    expect(replacement.subscriptionCount).toBe(3);
    expect(listener).toHaveBeenCalledTimes(1);

    runtime.dispose();
  });

  it('continues teardown after owned resources throw', () => {
    const canvas = new TestCanvas();
    canvas.throwOnDispose = true;
    const actorDispose = vi.fn(() => {
      throw new Error('actor dispose failed');
    });
    const actor: MagicActor = {
      id: 'throwing-actor',
      canHandle: () => false,
      act: () => ({ handled: false }),
      dispose: actorDispose,
    };
    const runtime = createMagicRuntime({ canvas, actors: [actor] });
    runtime.events.subscribe('runtime:disposing', () => {
      throw new Error('listener failed');
    });

    expect(() => runtime.dispose()).toThrow(MagicRuntimeCleanupError);

    expect(canvas.dispose).toHaveBeenCalledTimes(1);
    expect(canvas.subscriptionCount).toBe(0);
    expect(actorDispose).toHaveBeenCalledTimes(1);
    expect(runtime.features.disposed).toBe(true);
    expect(runtime.events.disposed).toBe(true);
    expect(runtime.disposed).toBe(true);
    expect(() => runtime.dispose()).not.toThrow();
  });

  it('cleans partial construction after canvas subscription failure', () => {
    const canvas = new FailingSubscriptionCanvas();

    expect(() => createMagicRuntime({ canvas })).toThrow(MagicRuntimeCleanupError);
    expect(canvas.subscriptionCount).toBe(0);
    expect(canvas.dispose).toHaveBeenCalledTimes(1);
  });
});
