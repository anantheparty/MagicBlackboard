import type { MagicCanvasAdapter, MagicDisposer } from '@magic-blackboard/core';
import type { MagicRuntime } from '@magic-blackboard/runtime';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import './magic-console.scss';

type ConsoleTab = 'Overview' | 'Features' | 'Board Inspector' | 'Input' | 'Actors' | 'Events';

const TABS: readonly ConsoleTab[] = [
  'Overview',
  'Features',
  'Board Inspector',
  'Input',
  'Actors',
  'Events',
];

export interface MagicConsoleState {
  readonly open: boolean;
  readonly width: number;
  readonly tab: ConsoleTab;
}

export interface MagicConsoleProps {
  readonly runtime: MagicRuntime;
  readonly available?: boolean;
  readonly initialState?: Partial<MagicConsoleState>;
  readonly onStateChange?: (state: MagicConsoleState) => void;
}

const DEFAULT_STATE: MagicConsoleState = {
  open: false,
  width: 380,
  tab: 'Overview',
};

export const isMagicConsoleShortcut = (
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey'>
): boolean => event.key.toLowerCase() === 'd' && event.shiftKey && (event.metaKey || event.ctrlKey);

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT');

export function MagicConsole({
  runtime,
  available = true,
  initialState,
  onStateChange,
}: MagicConsoleProps) {
  const [state, setState] = useState<MagicConsoleState>(() => ({
    ...DEFAULT_STATE,
    ...initialState,
    width: clampWidth(initialState?.width ?? DEFAULT_STATE.width),
  }));
  const [revision, setRevision] = useState(0);
  const resizing = useRef(false);

  const updateState = useCallback(
    (patch: Partial<MagicConsoleState>) => {
      setState((current) => {
        const next = {
          ...current,
          ...patch,
          width: clampWidth(patch.width ?? current.width),
        };
        onStateChange?.(next);
        return next;
      });
    },
    [onStateChange]
  );

  useEffect(() => {
    if (!available) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isMagicConsoleShortcut(event) || isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      setState((current) => {
        const next = { ...current, open: !current.open };
        onStateChange?.(next);
        return next;
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [available, onStateChange]);

  useEffect(() => {
    if (!available || !state.open) {
      return;
    }
    const disposers: MagicDisposer[] = [
      runtime.events.subscribeAll(() => setRevision((value) => value + 1)),
      runtime.features.subscribe(() => setRevision((value) => value + 1)),
    ];
    // The board can attach before this optional console subscribes (notably
    // when a persisted console starts open), so refresh once from current state.
    setRevision((value) => value + 1);
    return () => disposers.forEach((dispose) => dispose());
  }, [available, runtime, state.open]);

  useEffect(() => {
    if (!available || !state.open) {
      return;
    }
    const onPointerMove = (event: PointerEvent) => {
      if (resizing.current) {
        updateState({ width: window.innerWidth - event.clientX });
      }
    };
    const onPointerUp = () => {
      resizing.current = false;
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [available, state.open, updateState]);

  const content = useMemo(
    () => renderTab(state.tab, runtime),
    // Revision intentionally invalidates the snapshot only while the console subscribes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revision, runtime, state.tab]
  );

  if (!available) {
    return null;
  }

  if (!state.open) {
    return <div data-testid="magic-console-closed" hidden />;
  }

  return (
    <aside
      className="magic-console"
      style={{ '--magic-console-width': `${state.width}px` } as CSSProperties}
      aria-label="Magic Blackboard development console"
    >
      <button
        className="magic-console__resize"
        aria-label="Resize development console"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          resizing.current = true;
        }}
      />
      <header className="magic-console__header">
        <div>
          <strong>Magic Console</strong>
          <small>{runtime.id}</small>
        </div>
        <button
          type="button"
          onClick={() => updateState({ open: false })}
          aria-label="Close console"
        >
          ×
        </button>
      </header>
      <nav className="magic-console__tabs" aria-label="Console sections">
        {TABS.map((tab) => (
          <button
            type="button"
            key={tab}
            className={tab === state.tab ? 'is-active' : undefined}
            onClick={() => updateState({ tab })}
          >
            {tab}
          </button>
        ))}
      </nav>
      <section className="magic-console__content">{content}</section>
    </aside>
  );
}

function renderTab(tab: ConsoleTab, runtime: MagicRuntime) {
  switch (tab) {
    case 'Overview':
      return (
        <dl>
          <Row label="Runtime" value={runtime.id} />
          <Row label="Board" value={runtime.boardId} />
          <Row label="Canvas" value={runtime.canvas?.isAttached ? 'attached' : 'waiting'} />
          <Row label="Intent" value="interface only — no model connected" />
        </dl>
      );
    case 'Features':
      return (
        <div>
          {runtime.features.list().map((feature) => (
            <label className="magic-console__feature" key={feature.id}>
              <span>
                <strong>{feature.title ?? feature.id}</strong>
                <small>
                  {feature.description}
                  {!feature.available && ' · Unavailable in this milestone.'}
                </small>
              </span>
              <input
                type="checkbox"
                checked={feature.enabled}
                disabled={!feature.available}
                aria-label={`${feature.title ?? feature.id} feature`}
                onChange={(event) =>
                  void runtime.features.setEnabled(feature.id, event.target.checked)
                }
              />
            </label>
          ))}
          {runtime.features.list().length === 0 && <Empty>Features are initializing.</Empty>}
        </div>
      );
    case 'Board Inspector': {
      const snapshot = safeSnapshot(runtime.canvas);
      return snapshot ? (
        <pre>{JSON.stringify(snapshot, null, 2)}</pre>
      ) : (
        <Empty>Board is not attached yet.</Empty>
      );
    }
    case 'Events':
      return (
        <ol className="magic-console__events">
          {[...runtime.events.getHistory()].reverse().map((event) => (
            <li key={event.sequence}>
              <strong>{event.type}</strong>
              <small>
                #{event.sequence} · {new Date(event.timestamp).toLocaleTimeString()}
              </small>
            </li>
          ))}
        </ol>
      );
    case 'Input':
      return (
        <Empty>Pointer diagnostics are intentionally deferred to the pressure-ink round.</Empty>
      );
    case 'Actors':
      return <Empty>No Actor implementation or model is connected in this foundation.</Empty>;
  }
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="magic-console__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Empty({ children }: { readonly children: string }) {
  return <p className="magic-console__empty">{children}</p>;
}

function safeSnapshot(canvas: MagicCanvasAdapter | null) {
  if (!canvas?.isAttached) {
    return null;
  }
  try {
    return canvas.getSnapshot();
  } catch {
    return null;
  }
}

const clampWidth = (width: number): number =>
  Math.round(Math.min(Math.max(width, 300), Math.max(300, window.innerWidth - 80)));
