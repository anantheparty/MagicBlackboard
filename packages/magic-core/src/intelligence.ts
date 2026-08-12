import type { MagicCanvasSnapshot } from './canvas';
import type { MagicDisposable, MagicMaybePromise } from './disposable';

export type MagicSessionMode = 'teaching' | 'learning' | 'practice' | 'collaboration' | 'unknown';

export type MagicProvenanceKind =
  | 'explicit-user'
  | 'board-derived'
  | 'rule-derived'
  | 'model-inferred'
  | 'system';

export interface MagicProvenance {
  readonly kind: MagicProvenanceKind;
  readonly source: string;
  readonly observedAt: number;
  readonly confidence: number;
  readonly version: string;
}

export interface MagicContextSignal<Value = unknown> extends MagicProvenance {
  readonly value: Value;
}

/** Extensible context shared by rules, recognizers, and actors. */
export interface MagicBoardContext<Attributes extends object = Readonly<Record<string, unknown>>> {
  readonly boardId: string;
  readonly sessionMode: MagicSessionMode;
  readonly observedAt: number;
  readonly confidence: number;
  readonly version: string;
  readonly provenance: readonly MagicProvenance[];
  readonly subject?: string;
  readonly locale?: string;
  readonly signals?: readonly MagicContextSignal[];
  readonly attributes: Attributes;
}

export interface MagicContextRequest<Input = unknown, Context extends object = MagicBoardContext> {
  readonly input: Input;
  readonly previousContext?: Context;
  readonly canvas?: MagicCanvasSnapshot;
}

export interface MagicContextResolver<
  Input = unknown,
  Context extends object = MagicBoardContext,
> extends Partial<MagicDisposable> {
  readonly id: string;
  resolve(request: MagicContextRequest<Input, Context>): MagicMaybePromise<Context>;
}

export interface MagicIntent<
  Type extends string = string,
  Parameters extends object = Readonly<Record<string, unknown>>,
> {
  readonly type: Type;
  readonly confidence: number;
  readonly observedAt: number;
  readonly version: string;
  readonly provenance: readonly MagicProvenance[];
  readonly parameters: Parameters;
  readonly evidence?: readonly MagicContextSignal[];
}

export interface MagicIntentRequest<Input = unknown, Context extends object = MagicBoardContext> {
  readonly input: Input;
  readonly context: Context;
  readonly canvas?: MagicCanvasSnapshot;
}

export interface MagicIntentRecognizer<
  Input = unknown,
  Context extends object = MagicBoardContext,
  Intent extends MagicIntent = MagicIntent,
> extends Partial<MagicDisposable> {
  readonly id: string;
  recognize(request: MagicIntentRequest<Input, Context>): MagicMaybePromise<readonly Intent[]>;
}

/** A pure rule contract that can be composed or replaced by deterministic mocks. */
export interface MagicIntentRule<
  Input = unknown,
  Context extends object = MagicBoardContext,
  Intent extends MagicIntent = MagicIntent,
> {
  readonly id: string;
  readonly priority?: number;
  match(
    request: MagicIntentRequest<Input, Context>
  ): MagicMaybePromise<Intent | readonly Intent[] | null>;
}

export interface MagicActorRequest<
  Intent extends MagicIntent = MagicIntent,
  Context extends object = MagicBoardContext,
> {
  readonly intent: Intent;
  readonly context: Context;
  readonly canvas?: MagicCanvasSnapshot;
}

export interface MagicActorResult<Output = unknown> {
  readonly handled: boolean;
  readonly output?: Output;
}

export interface MagicActor<
  Intent extends MagicIntent = MagicIntent,
  Context extends object = MagicBoardContext,
  Output = unknown,
> extends Partial<MagicDisposable> {
  readonly id: string;
  canHandle(request: MagicActorRequest<Intent, Context>): MagicMaybePromise<boolean>;
  act(request: MagicActorRequest<Intent, Context>): MagicMaybePromise<MagicActorResult<Output>>;
}
