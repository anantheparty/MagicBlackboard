# @magic-blackboard/core

Framework-agnostic contracts and deterministic primitives for Magic Blackboard.

- `MagicEventBus<Events>` is synchronous, disposable, and retains only a bounded event history.
- `MagicFeatureRegistry` hydrates and persists feature state through `MagicSettingsStore`.
- `MagicCanvasAdapter` defines the board boundary without depending on React or Plait.
- `MagicInkDiagnosticsStore` keeps compact, session-only ink capability summaries in a fixed-capacity
  ring buffer.
- Context, intent, rule, recognizer, and actor types are interfaces only. No model or AI SDK is included.

Context signals and intents carry `observedAt`, `version`, confidence, and typed provenance. In particular,
`explicit-user`, `board-derived`, `rule-derived`, and `model-inferred` evidence remain distinguishable
instead of being flattened into an unexplained context value.

Feature definitions may be marked `available: false`. Unavailable features cannot be enabled, and
any stale persisted `true` value is forced to `false`. Availability can later be changed explicitly
through `setAvailable()` when a real implementation has been installed.

Every registered feature also exposes a `settingsStatus`: `ready`, `invalid`, `read-error`, or
`write-error`. A missing setting is initialized from `defaultEnabled`. In contrast, malformed or
unreadable settings are never overwritten: the feature is still registered for observability, but
it is unavailable and disabled until the storage problem is repaired. A failed initialization
write follows the same fail-closed behavior, so consumers do not remain stuck waiting for feature
registration. A later toggle or availability write that fails also locks the in-memory feature off
with `write-error` without replacing the recoverable persisted value.

## Settings

`MagicSettingsStore` is deliberately asynchronous so browser-backed implementations can use
IndexedDB/localForage. `MemoryMagicSettingsStore` is suitable for isolated runtimes and tests.

## Event payloads

The event bus does not deep-clone payloads. Treat emitted payloads as immutable so history remains a
trustworthy diagnostic record. Pass `{ retainPayload: false }` for large or high-volume values:
listeners still receive the typed payload, while history retains only sequence, type, and timestamp.
All listeners are attempted; synchronous failures are reported together as `MagicEventDispatchError`.

## Ink diagnostics

`MagicInkDiagnosticsStore` exposes a read-only `MagicInkDiagnostics` contract and the separate
`MagicInkDiagnosticsWriter` contract. Producers call `record()` with one already-aggregated batch;
readers use `getSnapshot()` and `subscribe()`. Listener failures are isolated so an optional
diagnostics UI cannot interrupt drawing.

The entry schema contains capability states, strategy, sample counts, interval summaries, and
optional end reasons. It intentionally has no coordinates, DOM `PointerEvent`, device identifier,
or raw sample array. `record()` projects the allowed fields into an immutable value, so extra input
properties are not retained. The ring buffer defaults to 256 entries; aggregate session counters
remain scalar and reset with `clear()` or `dispose()`.

Constructing the store does not enable collection. Product wiring must gate its writer with the
default-off diagnostics feature; the reader remains safe to expose for an empty session.
