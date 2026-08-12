# @magic-blackboard/runtime

`createMagicRuntime()` creates one isolated owner for a board session. Each runtime has a unique
runtime ID and its own event bus, feature registry, default in-memory settings store, and optional
canvas adapter.

Canvas document, selection, and viewport changes are bridged into the runtime event bus as
`canvas:document`, `canvas:selection`, and `canvas:viewport` events. The bridge is unsubscribed when
the canvas is replaced, detached, or disposed.

The runtime accepts context resolvers, intent recognizers, and actors only through the interfaces in
`@magic-blackboard/core`. It does not install a model, make network requests, or pretend that an AI
implementation exists.

## Lifecycle

`attachCanvas(adapter)` transfers adapter ownership to the runtime. Replacing an owned adapter
disposes the previous one. `detachCanvas()` detaches and returns the adapter without disposing it.
`dispose()` is idempotent and releases all runtime-owned collaborators.

Cleanup is best-effort: one failing listener or owned resource does not prevent the remaining
resources from being released. After all cleanup attempts, failures are reported together as
`MagicRuntimeCleanupError`.

An injected settings store is owned by default. Pass `ownsSettings: false` when sharing a store with
another runtime; feature and event registries remain runtime-local either way.

Canvas events deliver their typed values to live subscribers but retain only compact envelopes in
the bounded history, avoiding a history full of cloned board snapshots.
