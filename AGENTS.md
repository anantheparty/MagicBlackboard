# AGENTS.md

This file is the operating contract for people and coding agents working in this repository.
Its instructions apply repository-wide. A more deeply nested `AGENTS.md`, if one is added later,
may narrow these rules for that subtree but must not weaken security or attribution requirements.

## Mission and current phase

Magic Blackboard is an intent-aware, context-aware infinite blackboard for teaching and learning.
The product should eventually understand signals such as whether the user is teaching or learning
and whether the board concerns mathematics, physics, language learning, or another domain. Those
signals are uncertain evidence, not facts about a person.

The current milestone is the local-first whiteboard foundation. It includes a product app,
generic Drawnix extension seams, a per-board runtime, a Plait adapter, diagnostics, persistence,
tests, and documentation. It does **not** include model calls, intent inference, pressure-sensitive
ink, actor automation, collaboration, WebSockets, Electron, or native iPad code. Placeholder
features must remain behavior-neutral and be labelled as unavailable.

Read these before changing the repository:

1. `MagicBlackboard_CODEX_FIRST_PROMPT.md` — preserved source brief for the foundation milestone.
2. `docs/00_DECISION.md` — accepted decisions and phase gates.
3. `docs/01_ARCHITECTURE.md` — target boundaries and lifecycle.
4. `docs/05_ACCEPTANCE_CRITERIA.md` — evidence required for completion.
5. The nearest source, tests, `project.json`, and package README for the area being changed.

The next-round pressure prompt is `prompts/03_PRESSURE_INK_V2.md`. It is a future work order,
not permission to implement pressure ink during the foundation milestone.

## Repository map and dependency direction

- `apps/web`: the upstream Drawnix reference app. Keep it working and visually recognizable.
- `apps/magic-blackboard`: Magic Blackboard product composition and product-owned persistence.
- `packages/drawnix`: reusable Drawnix UI and tools. Keep Magic-specific policy out.
- `packages/magic-core`: framework-free contracts, event bus, ring buffer, and feature registry.
- `packages/magic-plait`: the only Magic package that translates Plait board details.
- `packages/magic-runtime`: per-board orchestration and lifecycle; no global runtime singleton.
- `packages/magic-console`: optional development observability; never a production dependency for
  board correctness.
- `docs`: decisions, architecture, setup, platform/model strategy, acceptance evidence.
- `prompts`: versioned future work orders. A prompt is not evidence that work was implemented.

The intended dependency flow is:

```text
apps/magic-blackboard
  -> drawnix + magic-runtime + magic-plait + magic-console
magic-console -> magic-runtime/core public contracts
magic-runtime -> magic-core and canvas/model ports
magic-plait -> magic-core contracts + Plait
magic-core -> no React, DOM, Plait, provider SDK, or product UI
```

Do not create reverse imports to make a test pass. Product-specific behavior belongs in the app or
a Magic package, not in `packages/drawnix`. Plait objects must not leak past the adapter boundary.

## Source-of-truth and upstream discipline

This repository is derived from `plait-board/drawnix` branch `develop` at baseline commit
`b0d682ce9896784dc42889afde7bda95e456aa7d`. Keep `origin` pointed at
`anantheparty/MagicBlackboard` and keep `upstream` fetch-only. Never rewrite or remove the upstream
MIT license, Drawnix/Plait attribution, or `NOTICE.md`.

Before broad changes, inspect instead of assuming:

```bash
git status --short
git branch --show-current
git remote -v
git rev-parse HEAD
cat .nvmrc
npm exec nx show projects
npm exec nx graph
```

Do not bulk-upgrade dependencies, replace the package manager, or regenerate the workspace to hide
an upstream failure. Use the versions and generator help that are actually present in this checkout.

## Working safely in a shared checkout

- Treat all pre-existing modifications and untracked files as user-owned.
- Other agents may be editing the same worktree. Re-read `git status` before and after changes,
  avoid overlapping ownership, and never discard another contributor's work.
- Do not use `git reset --hard`, destructive checkout/clean commands, force pushes, or history
  rewrites unless the repository owner explicitly requests the exact operation.
- Make small, reviewable changes. A commit should have one reason to change; tests and docs for that
  change normally travel with it.
- Do not commit build output, coverage, caches, recorded board content, device traces, screenshots
  containing personal material, or local environment files.

## Implementation workflow

1. Establish a cleanly recorded baseline. Run the real command and save failures as evidence; never
   report an unrun command as passing.
2. Locate the smallest ownership boundary that can express the change.
3. Write or update focused tests before widening the implementation.
4. Preserve public APIs by default. New Drawnix props must be optional and must leave `apps/web`
   unchanged when omitted.
5. Keep board/runtime setup and teardown symmetric. Every listener, observer, timer, worker, plugin
   attachment, and subscription needs an explicit disposal path.
6. Validate the smallest affected target while iterating, then run the milestone gates.
7. Update decisions, architecture, acceptance evidence, and manual test notes when behavior or a
   boundary changes.

Use current Nx syntax discovered from the installed version. Prefer project-scoped commands during
iteration; the foundation release gate is:

```bash
npm ci
npm run lint
npm run format:check
npm test
npm run build
```

When available, also run the dedicated Magic app build/start targets and relevant E2E tests. Record
the command, UTC/local date, commit, exit status, and any meaningful warnings in
`docs/baseline/YYYY-MM-DD.md` or the PR description. “Not run” is acceptable when explained;
invented success is not.

## Engineering invariants

- One board owns one runtime. No module-level mutable runtime, board, feature registry, or event bus.
- Core logic is deterministic and testable without React, a browser, or Plait.
- The canvas adapter presents snapshots and normalized events, not live mutable Plait internals.
- Events use stable names and typed payloads. High-frequency input goes to a bounded in-memory ring
  buffer; raw `pointermove` streams are never continuously persisted.
- Persistence is product-owned, versioned, and namespace-separated. A load failure must degrade to
  safe defaults without destroying the recoverable stored value.
- Feature flags default to no behavioral change. Unknown or unavailable features fail closed.
- The development console must not drive runtime correctness and must not create high-frequency
  React updates while closed.
- Context and intent values carry provenance, timestamp, and confidence. Keep explicit user input
  separate from board-derived or model-inferred context. Never infer sensitive personal traits.
- Suggested board mutations are previewable, attributable, reversible where practical, and require
  confirmation when destructive, broad, or low-confidence.

## Input, performance, and compatibility

Pointer input differs by browser, OS, stylus, and driver. Never equate `pointerType === "pen"` with
usable pressure, and never treat the fallback `pressure === 0.5` as hardware sensitivity. Capability
detection and real-device evidence are required before claiming Apple Pencil or tablet support.

Do not place storage, network calls, model inference, large allocations, or React state updates in a
hot pointer path. Prefer coalesced samples when explicitly implemented, bounded diagnostics, and
render-loop batching. Maintain mouse, touch, keyboard, and no-pressure fallbacks.

The first shipping surface is Web/PWA. Native iPadOS/PencilKit is a later evidence-based decision;
do not introduce Swift, Xcode projects, Capacitor, Electron, or a second renderer without an accepted
decision update in `docs/00_DECISION.md`.

## Model and data boundary

The foundation must run with zero API keys. Do not add an AI SDK or make a network model request in
this phase. Future model code must depend on a provider-neutral port and a versioned, validated
schema. Deterministic heuristics and replay fixtures come before provider integration.

Never put a provider key in client code, a `VITE_*` variable, a test snapshot, an issue, a prompt,
the repository, or browser storage. Hosted model calls require an owned server-side proxy with
authentication, authorization, input limits, timeouts, rate/cost limits, redaction, audit metadata,
and an explicit user-visible data policy. Send the smallest derived context needed; full board
documents and raw stroke histories are opt-in, not defaults.

## Public-repository security

Assume every committed byte, deleted Git object, CI log, issue, and artifact can become public.

- `.env.example` contains names and safe public defaults only. Local `.env*` files must be ignored.
- Use synthetic fixtures. Do not commit student work, names, emails, classroom recordings, access
  tokens, cookies, private URLs, production endpoints, device identifiers, or customer data.
- Client-prefixed environment variables are public configuration, never secrets.
- Give GitHub Actions the minimum permissions and pin or deliberately review third-party actions.
- Before each push, inspect `git diff --staged`, staged filenames, and suspicious secret patterns.
- If a secret appears anywhere in Git history or logs, revoke/rotate it immediately before cleanup;
  do not merely delete the latest file.
- Follow `SECURITY.md` for private vulnerability reports. Do not publish exploit details in an issue.

## Tests and review standard

At minimum, test pure contracts (event bus, ring buffer, registry, runtime isolation), adapter
translation and cleanup, React mount/unmount behavior, persistence fallback/migration, console
keyboard/listener behavior, and default Drawnix API compatibility. Add a regression test for every
bug fixed when practical.

Review for lifecycle leaks, hidden global state, mutable object escape, persistence compatibility,
render frequency, keyboard/touch accessibility, destructive actions, data minimization, and public
repo leakage—not only the happy path. UI completion requires a manual pass at useful desktop and
iPad viewport sizes; pressure support requires named physical hardware and browser/OS versions.

## Documentation and handoff

Use precise status words: **implemented**, **verified**, **planned**, **blocked**, or **not run**.
Keep research claims close to primary-source links and include the access date when compatibility
may change. If implementation diverges from an accepted decision, update the decision record in the
same change and explain the migration/compatibility effect.

A handoff must contain: outcome, architecture decisions, changed files, exact commands and results,
how to start the app, manual checks, unverified items, and a recommended commit split. Stop at the
current phase gate; do not silently continue into the next prompt.
