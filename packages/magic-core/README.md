# @magic-blackboard/core

Framework-agnostic contracts and deterministic primitives for Magic Blackboard.

- `MagicEventBus<Events>` is synchronous, disposable, and retains only a bounded event history.
- `MagicFeatureRegistry` hydrates and persists feature state through `MagicSettingsStore`.
- `MagicCanvasAdapter` defines the board boundary without depending on React or Plait.
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
registration.

## Settings

`MagicSettingsStore` is deliberately asynchronous so browser-backed implementations can use
IndexedDB/localForage. `MemoryMagicSettingsStore` is suitable for isolated runtimes and tests.

## Event payloads

The event bus does not deep-clone payloads. Treat emitted payloads as immutable so history remains a
trustworthy diagnostic record. Pass `{ retainPayload: false }` for large or high-volume values:
listeners still receive the typed payload, while history retains only sequence, type, and timestamp.
All listeners are attempted; synchronous failures are reported together as `MagicEventDispatchError`.
