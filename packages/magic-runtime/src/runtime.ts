import {
  MagicEventBus,
  MagicFeatureRegistry,
  MemoryMagicSettingsStore,
  type MagicActor,
  type MagicBoardContext,
  type MagicCanvasAdapter,
  type MagicCanvasEventMap,
  type MagicContextResolver,
  type MagicDisposer,
  type MagicIntent,
  type MagicIntentRecognizer,
  type MagicSettingsStore,
} from '@magic-blackboard/core';

export interface MagicRuntimeEventMap {
  readonly 'canvas:document': MagicCanvasEventMap['document'];
  readonly 'canvas:selection': MagicCanvasEventMap['selection'];
  readonly 'canvas:viewport': MagicCanvasEventMap['viewport'];
  readonly 'canvas:attached': {
    readonly runtimeId: string;
    readonly boardId: string;
  };
  readonly 'canvas:detached': {
    readonly runtimeId: string;
    readonly boardId: string;
  };
  readonly 'runtime:disposing': {
    readonly runtimeId: string;
    readonly boardId: string;
  };
  readonly 'runtime:disposed': {
    readonly runtimeId: string;
    readonly boardId: string;
  };
}

export class MagicRuntimeCleanupError extends Error {
  readonly causes: readonly unknown[];

  constructor(operation: string, causes: readonly unknown[]) {
    super(`Magic runtime failed to ${operation} cleanly (${causes.length} error(s)).`);
    this.name = 'MagicRuntimeCleanupError';
    this.causes = causes;
  }
}

export interface MagicRuntimeOptions<
  Canvas extends MagicCanvasAdapter = MagicCanvasAdapter,
  Input = unknown,
  Context extends object = MagicBoardContext,
  Intent extends MagicIntent = MagicIntent,
> {
  /** A stable board identity. Runtime identity is always generated independently. */
  readonly boardId?: string;
  readonly canvas?: Canvas;
  readonly settings?: MagicSettingsStore;
  /** Defaults to true. Set false only when the caller shares the store. */
  readonly ownsSettings?: boolean;
  readonly eventHistoryCapacity?: number;
  readonly featureSettingsKeyPrefix?: string;
  readonly contextResolver?: MagicContextResolver<Input, Context> | null;
  readonly intentRecognizer?: MagicIntentRecognizer<Input, Context, Intent> | null;
  readonly actors?: readonly MagicActor<Intent, Context>[];
}

export interface MagicRuntime<
  Canvas extends MagicCanvasAdapter = MagicCanvasAdapter,
  Input = unknown,
  Context extends object = MagicBoardContext,
  Intent extends MagicIntent = MagicIntent,
> {
  readonly id: string;
  readonly boardId: string;
  readonly events: MagicEventBus<MagicRuntimeEventMap>;
  readonly features: MagicFeatureRegistry;
  readonly settings: MagicSettingsStore;
  readonly contextResolver: MagicContextResolver<Input, Context> | null;
  readonly intentRecognizer: MagicIntentRecognizer<Input, Context, Intent> | null;
  readonly actors: readonly MagicActor<Intent, Context>[];
  readonly canvas: Canvas | null;
  readonly disposed: boolean;
  /** Transfers lifecycle ownership of the adapter to this runtime. */
  attachCanvas(canvas: Canvas): void;
  /** Detaches and returns the adapter, transferring ownership back to the caller. */
  detachCanvas(): Canvas | null;
  dispose(): void;
}

let runtimeSequence = 0;

function createRuntimeId(): string {
  runtimeSequence += 1;
  const randomPart =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `magic-runtime-${Date.now().toString(36)}-${runtimeSequence.toString(36)}-${randomPart}`;
}

class DefaultMagicRuntime<
  Canvas extends MagicCanvasAdapter,
  Input,
  Context extends object,
  Intent extends MagicIntent,
> implements MagicRuntime<Canvas, Input, Context, Intent> {
  readonly id = createRuntimeId();
  readonly boardId: string;
  readonly events: MagicEventBus<MagicRuntimeEventMap>;
  readonly features: MagicFeatureRegistry;
  readonly settings: MagicSettingsStore;
  readonly contextResolver: MagicContextResolver<Input, Context> | null;
  readonly intentRecognizer: MagicIntentRecognizer<Input, Context, Intent> | null;
  readonly actors: readonly MagicActor<Intent, Context>[];

  readonly #ownsSettings: boolean;
  #canvasDisposers: MagicDisposer[] = [];
  #canvas: Canvas | null;
  #disposed = false;

  constructor(options: MagicRuntimeOptions<Canvas, Input, Context, Intent>) {
    this.boardId = options.boardId?.trim() || this.id;
    this.settings = options.settings ?? new MemoryMagicSettingsStore();
    this.#ownsSettings = options.ownsSettings ?? true;
    this.events = new MagicEventBus<MagicRuntimeEventMap>({
      historyCapacity: options.eventHistoryCapacity,
    });
    this.features = new MagicFeatureRegistry(this.settings, {
      settingsKeyPrefix: options.featureSettingsKeyPrefix,
    });
    this.contextResolver = options.contextResolver ?? null;
    this.intentRecognizer = options.intentRecognizer ?? null;
    this.actors = Object.freeze([...(options.actors ?? [])]);
    this.#canvas = options.canvas ?? null;
    if (this.#canvas) {
      try {
        this.#bindCanvasEvents(this.#canvas);
      } catch (error) {
        const errors: unknown[] = [error];
        this.#disposeCollaborators(errors);
        this.#attempt(() => this.features.dispose(), errors);
        if (this.#ownsSettings) {
          this.#attempt(() => this.settings.dispose?.(), errors);
        }
        this.#attempt(() => this.events.dispose(), errors);
        throw new MagicRuntimeCleanupError('initialize', errors);
      }
    }
  }

  get canvas(): Canvas | null {
    return this.#canvas;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  attachCanvas(canvas: Canvas): void {
    this.#assertActive();
    if (this.#canvas === canvas) {
      return;
    }

    this.#unbindCanvasEvents();
    this.#canvas?.dispose();
    this.#canvas = canvas;
    this.#bindCanvasEvents(canvas);
    this.events.emit('canvas:attached', this.#eventPayload());
  }

  detachCanvas(): Canvas | null {
    if (this.#disposed || !this.#canvas) {
      return null;
    }

    const canvas = this.#canvas;
    this.#canvas = null;
    const errors: unknown[] = [];
    this.#unbindCanvasEvents(errors);
    this.#attempt(() => canvas.detach(), errors);
    this.#attempt(() => this.events.emit('canvas:detached', this.#eventPayload()), errors);
    this.#throwCleanupErrors('detach canvas', errors);
    return canvas;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const errors: unknown[] = [];
    this.#attempt(() => this.events.emit('runtime:disposing', this.#eventPayload()), errors);

    const canvas = this.#canvas;
    this.#canvas = null;
    this.#unbindCanvasEvents(errors);
    if (canvas) {
      this.#attempt(() => canvas.dispose(), errors);
    }

    this.#disposeCollaborators(errors);

    this.#attempt(() => this.features.dispose(), errors);
    if (this.#ownsSettings) {
      this.#attempt(() => this.settings.dispose?.(), errors);
    }

    this.#attempt(() => this.events.emit('runtime:disposed', this.#eventPayload()), errors);
    this.#attempt(() => this.events.dispose(), errors);
    this.#throwCleanupErrors('dispose runtime', errors);
  }

  #eventPayload(): { runtimeId: string; boardId: string } {
    return { runtimeId: this.id, boardId: this.boardId };
  }

  #bindCanvasEvents(canvas: Canvas): void {
    const disposers: MagicDisposer[] = [];
    try {
      disposers.push(
        canvas.subscribe('document', (event) =>
          this.events.emit('canvas:document', event, { retainPayload: false })
        )
      );
      disposers.push(
        canvas.subscribe('selection', (event) =>
          this.events.emit('canvas:selection', event, { retainPayload: false })
        )
      );
      disposers.push(
        canvas.subscribe('viewport', (event) =>
          this.events.emit('canvas:viewport', event, { retainPayload: false })
        )
      );
      this.#canvasDisposers = disposers;
    } catch (error) {
      const errors: unknown[] = [error];
      this.#disposeSubscriptions(disposers, errors);
      if (this.#canvas === canvas) {
        this.#canvas = null;
      }
      this.#attempt(() => canvas.dispose(), errors);
      throw new MagicRuntimeCleanupError('attach canvas', errors);
    }
  }

  #unbindCanvasEvents(errors?: unknown[]): void {
    const disposers = this.#canvasDisposers;
    this.#canvasDisposers = [];
    this.#disposeSubscriptions(disposers, errors);
  }

  #disposeSubscriptions(disposers: readonly MagicDisposer[], errors?: unknown[]): void {
    for (const dispose of disposers) {
      if (errors) {
        this.#attempt(dispose, errors);
      } else {
        dispose();
      }
    }
  }

  #attempt(action: () => void, errors: unknown[]): void {
    try {
      action();
    } catch (error) {
      errors.push(error);
    }
  }

  #disposeCollaborators(errors: unknown[]): void {
    const collaborators = new Set<object>();
    if (this.contextResolver) {
      collaborators.add(this.contextResolver);
    }
    if (this.intentRecognizer) {
      collaborators.add(this.intentRecognizer);
    }
    for (const actor of this.actors) {
      collaborators.add(actor);
    }
    for (const collaborator of collaborators) {
      const disposable = collaborator as { dispose?: () => void };
      if (disposable.dispose) {
        this.#attempt(() => disposable.dispose?.(), errors);
      }
    }
  }

  #throwCleanupErrors(operation: string, errors: readonly unknown[]): void {
    if (errors.length > 0) {
      throw new MagicRuntimeCleanupError(operation, errors);
    }
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error(`Magic runtime "${this.id}" has been disposed.`);
    }
  }
}

export function createMagicRuntime<
  Canvas extends MagicCanvasAdapter = MagicCanvasAdapter,
  Input = unknown,
  Context extends object = MagicBoardContext,
  Intent extends MagicIntent = MagicIntent,
>(
  options: MagicRuntimeOptions<Canvas, Input, Context, Intent> = {}
): MagicRuntime<Canvas, Input, Context, Intent> {
  return new DefaultMagicRuntime(options);
}
