export interface MagicDisposable {
  readonly disposed: boolean;
  dispose(): void;
}

export type MagicDisposer = () => void;

export type MagicMaybePromise<Value> = Value | Promise<Value>;
