# `@magic-blackboard/plait`

`magic-plait` is the board-scoped boundary between Plait/Drawnix and the Magic
Blackboard runtime. Its concrete adapter implements the framework-free canvas
contract from `@magic-blackboard/core`, then translates that contract to Plait.
It provides read-only snapshots and queries, coordinate conversion, and typed
board events without introducing a global runtime or writing to Plait's
exported singleton maps.

## Lifecycle

Create one adapter per board/runtime. The preferred integration installs its
listener seam as an additional Plait plugin, then activates it only after the
board is initialized:

```tsx
const canvas = new PlaitCanvasAdapter();
const additionalPlugins = [canvas.asPlugin()];

<Drawnix
  additionalPlugins={additionalPlugins}
  afterInit={(board) => canvas.attach(board)}
/>
```

If product wiring cannot install the plugin, `attach(board)` installs the same
board-local listener itself. `detach()` and `dispose()` are idempotent. A
disposed adapter cannot be reattached or resubscribed.

## Queries

- `getSnapshot()` returns cloned Plait children, viewport, theme, and selection.
- `getSelection()` returns both Plait's geometric range and IDs from Plait's
  actual selected-element cache.
- `getElementsByIds()` searches nested Plait elements in requested-ID order and
  returns clones, so inspector code cannot mutate the live document by accident.
- `getSelectionBounds()` uses Plait's rotated element-bounds helper and falls
  back to `board.getRectangle()` for DOM-free/testing boards.
- `worldToScreen()` and `screenToWorld()` use Plait's viewBox/host/client helper
  chain. “Screen” means browser client coordinates, as used by pointer events.

Queries that have a harmless empty answer return `null` or an empty collection
while detached. Snapshots and coordinate conversion throw because they have no
meaningful detached result.

## Events

Subscribe to `document`, `selection`, or `viewport`. Events contain typed
`previous`/`current` values and the Plait operations for that change. Document
events contain an adapter-local revision, changed element IDs, and theme—not
the element tree. Complete snapshots are intentionally omitted from hot event
paths; consumers call `getSnapshot()` only when they need one. Unsubscribe
functions are idempotent. Listener errors are isolated from Plait's update
lifecycle and may be observed through the adapter's `onListenerError` option.

## Workspace integration contract

The repository root maps `@magic-blackboard/plait` to
`packages/magic-plait/src/index.ts`. Drawnix exposes `additionalPlugins` for the
preferred early listener seam; attaching in `afterInit` also remains supported
when embedding the adapter elsewhere.
