import { MagicConsole, type MagicConsoleState } from '@magic-blackboard/console';
import { Drawnix, type DrawnixToolState, type Language } from '@drawnix/drawnix';
import { PlaitCanvasAdapter } from '@magic-blackboard/plait';
import { createMagicRuntime, type MagicRuntime } from '@magic-blackboard/runtime';
import type { BoardChangeData } from '@plait-board/react-board';
import type { PlaitElement, PlaitPlugin, PlaitTheme, Viewport } from '@plait/core';
import {
  ArrowLineMarkerType,
  ArrowLineShape,
  BasicShapes,
  FlowchartSymbols,
  GEOMETRY_WITH_MULTIPLE_TEXT,
  GEOMETRY_WITHOUT_TEXT,
  SwimlaneSymbols,
  UMLSymbols,
  VectorLineShape,
} from '@plait/draw';
import { Component, useCallback, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { createMagicStores, LocalForageSettingsStore, type MagicStores } from './storage';
import './app.scss';

export type ExplicitBoardContext = {
  sessionMode: 'unknown' | 'teaching' | 'learning' | 'collaboration';
  subject: 'unknown' | 'math' | 'physics' | 'language' | 'other';
};

type MagicAppBoundaryProps = {
  readonly children: ReactNode;
};

type MagicAppBoundaryState = {
  readonly error: Error | null;
};

type BoardState = {
  schemaVersion: typeof BOARD_DOCUMENT_SCHEMA_VERSION;
  children: PlaitElement[];
  viewport?: Viewport;
  theme?: PlaitTheme;
};

type Preferences = {
  language: Language;
  copyTransparent: boolean;
  exportTransparent: boolean;
  context: ExplicitBoardContext;
};

type LoadedState = {
  board: BoardState;
  toolState?: Partial<DrawnixToolState>;
  preferences: Preferences;
  consoleState?: Partial<MagicConsoleState>;
  recoveryWarnings: readonly string[];
  recoveryLocks: readonly StorageSlot[];
};

type StorageSlot = 'board.document' | 'board.tool-state' | 'preferences.current' | 'console.layout';

type AppSession = {
  readonly stores: MagicStores;
  readonly adapter: PlaitCanvasAdapter;
  readonly runtime: MagicRuntime<PlaitCanvasAdapter>;
  readonly additionalPlugins: readonly PlaitPlugin[];
  readonly pendingPersistence: Map<StorageSlot, PendingPersistence>;
  latestBoard: BoardState | null;
};

type PendingPersistence = {
  readonly timer: ReturnType<typeof setTimeout>;
  readonly flush: () => void;
};

type ReadyState = {
  readonly session: AppSession;
  readonly loaded: LoadedState;
  readonly tutorial: boolean;
};

export type MagicBlackboardSessionDependencies = {
  readonly createStores?: typeof createMagicStores;
  readonly createAdapter?: () => PlaitCanvasAdapter;
  readonly createRuntime?: (settings: LocalForageSettingsStore) => MagicRuntime<PlaitCanvasAdapter>;
};

const DEFAULT_SESSION_DEPENDENCIES: MagicBlackboardSessionDependencies = {};

const DEFAULT_PREFERENCES: Preferences = {
  language: 'zh',
  copyTransparent: false,
  exportTransparent: false,
  context: {
    sessionMode: 'unknown',
    subject: 'unknown',
  },
};

const BOARD_DOCUMENT_SCHEMA_VERSION = 1 as const;
const MAX_BOARD_VALUE_DEPTH = 128;
const MAX_BOARD_VALUE_COUNT = 1_000_000;

const TOP_LEVEL_ELEMENT_TYPES = new Set<string>([
  'geometry',
  'arrow-line',
  'line',
  'vector-line',
  'image',
  'table',
  'swimlane',
  'group',
  'mind',
  'mindmap',
  'freehand',
]);
const GEOMETRY_SHAPES = new Set<string>([
  ...Object.values(BasicShapes),
  ...Object.values(FlowchartSymbols),
  ...Object.values(UMLSymbols),
]);
const GEOMETRY_WITHOUT_TEXT_SHAPES = new Set<string>(GEOMETRY_WITHOUT_TEXT);
const GEOMETRY_WITH_MULTIPLE_TEXT_SHAPES = new Set<string>(GEOMETRY_WITH_MULTIPLE_TEXT);
const GEOMETRY_WITH_TABLE_DATA_SHAPES = new Set<string>([UMLSymbols.class, UMLSymbols.interface]);
const ARROW_LINE_SHAPES = new Set<string>(Object.values(ArrowLineShape));
const ARROW_LINE_MARKERS = new Set<string>(Object.values(ArrowLineMarkerType));
const VECTOR_LINE_SHAPES = new Set<string>(Object.values(VectorLineShape));
const SWIMLANE_SHAPES = new Set<string>(Object.values(SwimlaneSymbols));
const FREEHAND_SHAPES = new Set<string>([
  'eraser',
  'nibPen',
  'feltTipPen',
  'artisticBrush',
  'markerHighlight',
]);
const SHAPE_TOOL_POINTERS = new Set<string>([
  BasicShapes.rectangle,
  BasicShapes.ellipse,
  BasicShapes.triangle,
  BasicShapes.roundRectangle,
  BasicShapes.diamond,
  BasicShapes.parallelogram,
  FlowchartSymbols.terminal,
  FlowchartSymbols.noteCurlyRight,
  FlowchartSymbols.noteCurlyLeft,
]);
const ARROW_TOOL_POINTERS = new Set<string>(Object.values(ArrowLineShape));
const FREEHAND_TOOL_POINTERS = new Set<string>(['feltTipPen', 'eraser']);
const DRAWNIX_TOOL_POINTERS = new Set<string>([
  'hand',
  'selection',
  'mind',
  BasicShapes.text,
  ...SHAPE_TOOL_POINTERS,
  ...ARROW_TOOL_POINTERS,
  ...FREEHAND_TOOL_POINTERS,
]);
const DEFAULT_FREEHAND_PRESET_COUNT = 3;
const MAX_FREEHAND_PRESET_COUNT = 3;
const MIN_FREEHAND_STROKE_WIDTH = 1;
const MAX_FREEHAND_STROKE_WIDTH = 24;

const BOARD_KEY = 'document';
const TOOL_STATE_KEY = 'tool-state';
const PREFERENCES_KEY = 'current';
const CONSOLE_KEY = 'layout';

const FEATURE_DEFINITIONS = [
  {
    id: 'magic.ink-diagnostics',
    title: 'Ink diagnostics',
    description: 'Placeholder only; it does not change input or ink behavior.',
    defaultEnabled: false,
    available: false,
  },
  {
    id: 'magic.actor',
    title: 'Actor',
    description: 'Placeholder only; no Actor or model is implemented.',
    defaultEnabled: false,
    available: false,
  },
] as const;

export class MagicAppBoundary extends Component<MagicAppBoundaryProps, MagicAppBoundaryState> {
  state: MagicAppBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): MagicAppBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Magic Blackboard session failed', error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="magic-startup magic-startup--error" role="alert">
          <span className="magic-startup__mark">M</span>
          <strong>Magic Blackboard 暂时无法启动</strong>
          <p>本地数据不会在此错误状态下被覆盖。请刷新后重试。</p>
          <button type="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

export function MagicBlackboardSession({
  dependencies = DEFAULT_SESSION_DEPENDENCIES,
}: {
  readonly dependencies?: MagicBlackboardSessionDependencies;
} = {}) {
  const [ready, setReady] = useState<ReadyState | null>(null);
  const [startupError, setStartupError] = useState<Error | null>(null);
  const createStoresDependency = dependencies.createStores;
  const createAdapterDependency = dependencies.createAdapter;
  const createRuntimeDependency = dependencies.createRuntime;

  useEffect(() => {
    let active = true;
    let adapter: PlaitCanvasAdapter | undefined;
    let runtime: MagicRuntime<PlaitCanvasAdapter> | undefined;
    let session: AppSession;
    try {
      const stores = (createStoresDependency ?? createMagicStores)();
      adapter = (createAdapterDependency ?? (() => new PlaitCanvasAdapter()))();
      const settings = new LocalForageSettingsStore(stores.features);
      runtime = createRuntimeDependency
        ? createRuntimeDependency(settings)
        : createMagicRuntime<PlaitCanvasAdapter>({
            boardId: 'main',
            settings,
            ownsSettings: false,
            eventHistoryCapacity: 200,
          });
      session = {
        stores,
        adapter,
        runtime,
        additionalPlugins: [adapter.asPlugin()],
        pendingPersistence: new Map(),
        latestBoard: null,
      };
    } catch (error) {
      disposePartialSession(runtime, adapter);
      setStartupError(toError(error));
      return;
    }
    const { stores } = session;
    const flushSessionPersistence = () => flushPendingPersistence(session);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushSessionPersistence();
      }
    };
    const handlePageHide = () => flushSessionPersistence();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    setStartupError(null);
    setReady(null);

    void loadState(stores)
      .then((state) => {
        if (!active) {
          return;
        }
        session.latestBoard = state.board;
        setReady({ session, loaded: state, tutorial: state.board.children.length === 0 });
      })
      .catch((error: unknown) => {
        // loadState isolates individual storage failures. This catch protects
        // against programmer errors without leaving the app on a blank screen.
        if (!active) {
          return;
        }
        console.error('Magic Blackboard state initialization failed', error);
        const fallback = defaultLoadedState([
          '本地状态初始化失败，已使用安全默认值；原存储未修改。',
        ]);
        session.latestBoard = fallback.board;
        setReady({
          session,
          loaded: fallback,
          tutorial: true,
        });
      });

    void runtime.features.registerMany(FEATURE_DEFINITIONS).catch((error: unknown) => {
      if (!runtime.disposed) {
        console.error('Magic feature initialization failed', error);
      }
    });

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      flushSessionPersistence();
      try {
        runtime.dispose();
      } catch (error) {
        console.error('Magic runtime cleanup failed', error);
      }
      try {
        adapter.dispose();
      } catch (error) {
        console.error('Magic adapter cleanup failed', error);
      }
    };
  }, [createAdapterDependency, createRuntimeDependency, createStoresDependency]);

  const updatePreferences = useCallback(
    (patch: Partial<Preferences>) => {
      setReady((current) => {
        if (!current || current.session !== ready?.session) {
          return current;
        }
        const preferences = { ...current.loaded.preferences, ...patch };
        persistItemUnlessLocked(
          current.loaded.recoveryLocks,
          'preferences.current',
          current.session.stores.preferences,
          PREFERENCES_KEY,
          preferences
        );
        return { ...current, loaded: { ...current.loaded, preferences } };
      });
    },
    [ready?.session]
  );

  const updateExplicitContext = useCallback(
    (patch: Partial<ExplicitBoardContext>) => {
      setReady((current) => {
        if (!current || current.session !== ready?.session) {
          return current;
        }
        const preferences = {
          ...current.loaded.preferences,
          context: { ...current.loaded.preferences.context, ...patch },
        };
        persistItemUnlessLocked(
          current.loaded.recoveryLocks,
          'preferences.current',
          current.session.stores.preferences,
          PREFERENCES_KEY,
          preferences
        );
        return { ...current, loaded: { ...current.loaded, preferences } };
      });
    },
    [ready?.session]
  );

  const updateConsoleState = useCallback(
    (nextConsoleState: MagicConsoleState) => {
      const session = ready?.session;
      const recoveryLocks = ready?.loaded.recoveryLocks;
      if (!session || !recoveryLocks) {
        return;
      }
      schedulePersistItem(
        session,
        recoveryLocks,
        'console.layout',
        session.stores.console,
        CONSOLE_KEY,
        nextConsoleState,
        150
      );
    },
    [ready?.loaded.recoveryLocks, ready?.session]
  );

  if (startupError) {
    return <StartupFailure />;
  }

  if (!ready) {
    return (
      <main className="magic-startup" aria-label="Loading Magic Blackboard">
        <span className="magic-startup__mark">M</span>
        <strong>Magic Blackboard</strong>
        <small>正在恢复本地黑板…</small>
      </main>
    );
  }

  const { session, loaded, tutorial } = ready;
  const { stores, adapter, runtime, additionalPlugins } = session;
  const { board, preferences, toolState, consoleState, recoveryWarnings } = loaded;
  const currentBoard = session.latestBoard ?? board;
  const consoleAvailable = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_CONSOLE === '1';

  return (
    <main className="magic-app">
      <Drawnix
        value={currentBoard.children}
        viewport={currentBoard.viewport}
        theme={currentBoard.theme}
        initialToolState={toolState}
        initialLanguage={preferences.language}
        initialPreference={{
          copyTransparent: preferences.copyTransparent,
          exportTransparent: preferences.exportTransparent,
        }}
        additionalPlugins={additionalPlugins}
        afterInit={(plaitBoard) => {
          try {
            adapter.attach(plaitBoard);
            runtime.attachCanvas(adapter);
          } catch (error) {
            try {
              runtime.dispose();
            } catch (cleanupError) {
              console.error('Magic runtime cleanup failed after board attachment', cleanupError);
            }
            try {
              adapter.dispose();
            } catch (cleanupError) {
              console.error('Magic adapter cleanup failed after board attachment', cleanupError);
            }
            throw error;
          }
        }}
        renderOverlay={() => (
          <ProductOverlay
            context={preferences.context}
            language={preferences.language}
            recoveryWarnings={recoveryWarnings}
            onContextChange={updateExplicitContext}
          />
        )}
        onChange={(change) => {
          const nextBoard = toBoardState(change);
          // Keep Drawnix's controlled value reference aligned without a React
          // state update for every high-frequency set_node operation.
          session.latestBoard = nextBoard;
          if (tutorial && nextBoard.children.length > 0) {
            setReady((current) =>
              current?.session === session && current.tutorial
                ? { ...current, tutorial: false }
                : current
            );
          }
          if (change.operations.some(shouldPersistDocumentImmediately)) {
            persistItemNow(
              session,
              loaded.recoveryLocks,
              'board.document',
              stores.board,
              BOARD_KEY,
              nextBoard
            );
          } else if (shouldScheduleDocumentPersistence(change.operations)) {
            schedulePersistItem(
              session,
              loaded.recoveryLocks,
              'board.document',
              stores.board,
              BOARD_KEY,
              nextBoard,
              200
            );
          }
        }}
        onToolStateChange={(nextToolState) => {
          persistItemUnlessLocked(
            loaded.recoveryLocks,
            'board.tool-state',
            stores.board,
            TOOL_STATE_KEY,
            nextToolState
          );
        }}
        onLanguageChange={(language) => updatePreferences({ language })}
        onPreferenceChange={(preference) => updatePreferences(preference)}
        tutorial={tutorial}
      />
      <MagicConsole
        runtime={runtime}
        available={consoleAvailable}
        initialState={consoleState}
        onStateChange={updateConsoleState}
      />
    </main>
  );
}

export function App() {
  return (
    <MagicAppBoundary>
      <MagicBlackboardSession />
    </MagicAppBoundary>
  );
}

function StartupFailure() {
  return (
    <main className="magic-startup magic-startup--error" role="alert">
      <span className="magic-startup__mark">M</span>
      <strong>Magic Blackboard 暂时无法启动</strong>
      <p>本地数据不会在此错误状态下被覆盖。请刷新后重试。</p>
      <button type="button" onClick={() => window.location.reload()}>
        重新加载
      </button>
    </main>
  );
}

function disposePartialSession(
  runtime: MagicRuntime<PlaitCanvasAdapter> | undefined,
  adapter: PlaitCanvasAdapter | undefined
): void {
  try {
    runtime?.dispose();
  } catch (error) {
    console.error('Magic runtime cleanup failed during initialization', error);
  }
  try {
    adapter?.dispose();
  } catch (error) {
    console.error('Magic adapter cleanup failed during initialization', error);
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function ProductOverlay({
  context,
  language,
  recoveryWarnings,
  onContextChange,
}: {
  readonly context: ExplicitBoardContext;
  readonly language: Language;
  readonly recoveryWarnings: readonly string[];
  readonly onContextChange: (patch: Partial<ExplicitBoardContext>) => void;
}) {
  const copy = PRODUCT_COPY[toProductLanguage(language)];
  return (
    <div className="magic-product-overlay">
      <div className="magic-brand" aria-label="Magic Blackboard">
        <span>M</span>
        <strong>Magic Blackboard</strong>
        <small>local-first</small>
      </div>
      <details className="magic-context">
        <summary>
          {copy.context} · {contextLabel(context, language)}
        </summary>
        <div className="magic-context__fields">
          <label>
            {copy.session}
            <select
              aria-label="Session mode"
              value={context.sessionMode}
              onChange={(event) =>
                onContextChange({
                  sessionMode: event.target.value as ExplicitBoardContext['sessionMode'],
                })
              }
            >
              <option value="unknown">{copy.unknown}</option>
              <option value="teaching">{copy.teaching}</option>
              <option value="learning">{copy.learning}</option>
              <option value="collaboration">{copy.collaboration}</option>
            </select>
          </label>
          <label>
            {copy.subject}
            <select
              aria-label="Subject"
              value={context.subject}
              onChange={(event) =>
                onContextChange({ subject: event.target.value as ExplicitBoardContext['subject'] })
              }
            >
              <option value="unknown">{copy.unknown}</option>
              <option value="math">{copy.math}</option>
              <option value="physics">{copy.physics}</option>
              <option value="language">{copy.language}</option>
              <option value="other">{copy.other}</option>
            </select>
          </label>
          <p>{copy.explicitContextNote}</p>
        </div>
      </details>
      {recoveryWarnings.length > 0 && (
        <p className="magic-recovery-warning" role="status">
          {copy.recoveryWarning(recoveryWarnings.length)}
        </p>
      )}
    </div>
  );
}

async function loadState(stores: MagicStores): Promise<LoadedState> {
  const [boardResult, toolResult, preferencesResult, consoleResult] = await Promise.all([
    recoverItem(stores.board, BOARD_KEY, 'board document', parseBoardState),
    recoverItem(stores.board, TOOL_STATE_KEY, 'tool state', parseToolState),
    recoverItem(stores.preferences, PREFERENCES_KEY, 'preferences', parseStoredPreferences),
    recoverItem(stores.console, CONSOLE_KEY, 'console layout', parseConsoleState),
  ]);
  const storedPreferences = preferencesResult.value as Partial<Preferences> | undefined;
  const context = {
    ...DEFAULT_PREFERENCES.context,
    ...parseExplicitContext(storedPreferences?.context),
  };
  return {
    board: boardResult.value ?? createEmptyBoardState(),
    toolState: toolResult.value as Partial<DrawnixToolState> | undefined,
    preferences: {
      ...DEFAULT_PREFERENCES,
      ...parsePreferences(storedPreferences),
      context,
    },
    consoleState: consoleResult.value,
    recoveryWarnings: [
      boardResult.warning,
      toolResult.warning,
      preferencesResult.warning,
      consoleResult.warning,
    ].filter((warning): warning is string => Boolean(warning)),
    recoveryLocks: [
      boardResult.locked ? 'board.document' : null,
      toolResult.locked ? 'board.tool-state' : null,
      preferencesResult.locked ? 'preferences.current' : null,
      consoleResult.locked ? 'console.layout' : null,
    ].filter((slot): slot is StorageSlot => slot !== null),
  };
}

type RecoverResult<T> = {
  readonly value?: T;
  readonly warning?: string;
  readonly locked?: boolean;
};

async function recoverItem<T>(
  store: MagicStores[keyof MagicStores],
  key: string,
  label: string,
  parse: (value: unknown) => T | undefined
): Promise<RecoverResult<T>> {
  try {
    const stored = await store.getItem<unknown>(key);
    if (stored === null) {
      return {};
    }
    const value = parse(stored);
    return value === undefined
      ? { warning: `${label} contains an unsupported value.`, locked: true }
      : { value };
  } catch {
    return { warning: `${label} could not be read.`, locked: true };
  }
}

function defaultLoadedState(recoveryWarnings: readonly string[]): LoadedState {
  return {
    board: createEmptyBoardState(),
    preferences: DEFAULT_PREFERENCES,
    recoveryWarnings,
    recoveryLocks: ['board.document', 'board.tool-state', 'preferences.current', 'console.layout'],
  };
}

function parseBoardState(value: unknown): BoardState | undefined {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== undefined && value.schemaVersion !== BOARD_DOCUMENT_SCHEMA_VERSION) ||
    !Array.isArray(value.children) ||
    !isSafeStoredBoardValue(value) ||
    !areValidPlaitElements(value.children)
  ) {
    return undefined;
  }
  const viewport = parseViewport(value.viewport);
  if (value.viewport !== undefined && !viewport) {
    return undefined;
  }
  const theme = value.theme === undefined ? undefined : parseTheme(value.theme);
  if (value.theme !== undefined && theme === undefined) {
    return undefined;
  }
  return {
    schemaVersion: BOARD_DOCUMENT_SCHEMA_VERSION,
    children: value.children as PlaitElement[],
    ...(viewport ? { viewport } : {}),
    ...(theme ? { theme } : {}),
  };
}

function createEmptyBoardState(): BoardState {
  return { schemaVersion: BOARD_DOCUMENT_SCHEMA_VERSION, children: [] };
}

function areValidPlaitElements(values: readonly unknown[]): boolean {
  const ids = new Set<string>();
  return values.every((value) => isValidTopLevelPlaitElement(value, ids));
}

function isValidTopLevelPlaitElement(value: unknown, ids: Set<string>): boolean {
  if (!registerPlaitElementIdentity(value, ids) || !TOP_LEVEL_ELEMENT_TYPES.has(value.type)) {
    return false;
  }

  switch (value.type) {
    case 'geometry':
      return isValidGeometryElement(value);
    case 'arrow-line':
    case 'line':
      return isValidArrowLineElement(value);
    case 'vector-line':
      return isValidVectorLineElement(value);
    case 'image':
      return isValidImageElement(value);
    case 'table':
      return hasNoPlaitChildren(value) && isValidTableData(value);
    case 'swimlane':
      return (
        hasNoPlaitChildren(value) &&
        typeof value.shape === 'string' &&
        SWIMLANE_SHAPES.has(value.shape) &&
        (value.header === undefined || typeof value.header === 'boolean') &&
        isValidTableData(value)
      );
    case 'group':
      return hasNoPlaitChildren(value);
    case 'mind':
    case 'mindmap':
      return isValidMindElement(value, ids, true, 0);
    case 'freehand':
      return (
        hasNoPlaitChildren(value) &&
        typeof value.shape === 'string' &&
        FREEHAND_SHAPES.has(value.shape) &&
        hasValidPoints(value, 1)
      );
    default:
      return false;
  }
}

function registerPlaitElementIdentity(
  value: unknown,
  ids: Set<string>
): value is Record<string, unknown> & { id: string; type: string } {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id.trim().length === 0 ||
    ids.has(value.id) ||
    typeof value.type !== 'string' ||
    value.type.trim().length === 0 ||
    (value.groupId !== undefined &&
      (typeof value.groupId !== 'string' || value.groupId.trim().length === 0))
  ) {
    return false;
  }
  ids.add(value.id);
  return true;
}

function isValidGeometryElement(value: Record<string, unknown>): boolean {
  if (
    !hasNoPlaitChildren(value) ||
    typeof value.shape !== 'string' ||
    !GEOMETRY_SHAPES.has(value.shape) ||
    !hasValidPoints(value, 2, 2)
  ) {
    return false;
  }

  if (GEOMETRY_WITH_TABLE_DATA_SHAPES.has(value.shape)) {
    return isValidTableData(value);
  }
  if (GEOMETRY_WITH_MULTIPLE_TEXT_SHAPES.has(value.shape)) {
    return isValidDrawTextArray(value.texts);
  }
  if (GEOMETRY_WITHOUT_TEXT_SHAPES.has(value.shape)) {
    return true;
  }
  return (
    isValidSlateElement(value.text) &&
    (value.shape !== BasicShapes.text || typeof value.autoSize === 'boolean')
  );
}

function isValidArrowLineElement(value: Record<string, unknown>): boolean {
  return (
    hasNoPlaitChildren(value) &&
    typeof value.shape === 'string' &&
    ARROW_LINE_SHAPES.has(value.shape) &&
    hasValidPoints(value, 2) &&
    isValidArrowLineHandle(value.source) &&
    isValidArrowLineHandle(value.target) &&
    Array.isArray(value.texts) &&
    value.texts.every(
      (text) =>
        isRecord(text) &&
        isValidSlateElement(text.text) &&
        typeof text.position === 'number' &&
        Number.isFinite(text.position) &&
        text.position >= 0 &&
        text.position <= 1
    )
  );
}

function isValidArrowLineHandle(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.marker === 'string' &&
    ARROW_LINE_MARKERS.has(value.marker) &&
    (value.boundId === undefined ||
      (typeof value.boundId === 'string' && value.boundId.trim().length > 0)) &&
    (value.connection === undefined || isPoint(value.connection))
  );
}

function isValidVectorLineElement(value: Record<string, unknown>): boolean {
  return (
    hasNoPlaitChildren(value) &&
    typeof value.shape === 'string' &&
    VECTOR_LINE_SHAPES.has(value.shape) &&
    hasValidPoints(value, 2)
  );
}

function isValidImageElement(value: Record<string, unknown>): boolean {
  return (
    hasNoPlaitChildren(value) &&
    hasValidPoints(value, 2, 2) &&
    typeof value.url === 'string' &&
    value.url.trim().length > 0
  );
}

function isValidTableData(value: Record<string, unknown>): boolean {
  if (
    !hasValidPoints(value, 2, 2) ||
    !Array.isArray(value.rows) ||
    value.rows.length === 0 ||
    !Array.isArray(value.columns) ||
    value.columns.length === 0 ||
    !Array.isArray(value.cells) ||
    value.cells.length === 0
  ) {
    return false;
  }

  const rowIds = readUniqueTableAxisIds(value.rows, 'height');
  const columnIds = readUniqueTableAxisIds(value.columns, 'width');
  if (!rowIds || !columnIds) {
    return false;
  }
  const cellIds = new Set<string>();
  const coordinates = new Set<string>();
  return value.cells.every((cell) => {
    if (
      !isRecord(cell) ||
      typeof cell.id !== 'string' ||
      cell.id.trim().length === 0 ||
      cellIds.has(cell.id) ||
      typeof cell.rowId !== 'string' ||
      !rowIds.has(cell.rowId) ||
      typeof cell.columnId !== 'string' ||
      !columnIds.has(cell.columnId) ||
      (cell.text !== undefined && !isValidSlateElement(cell.text)) ||
      !isOptionalPositiveInteger(cell.colspan) ||
      !isOptionalPositiveInteger(cell.rowspan)
    ) {
      return false;
    }
    const coordinate = `${cell.rowId}\u0000${cell.columnId}`;
    if (coordinates.has(coordinate)) {
      return false;
    }
    cellIds.add(cell.id);
    coordinates.add(coordinate);
    return true;
  });
}

function readUniqueTableAxisIds(values: readonly unknown[], sizeKey: 'height' | 'width') {
  const ids = new Set<string>();
  for (const value of values) {
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      value.id.trim().length === 0 ||
      ids.has(value.id) ||
      (value[sizeKey] !== undefined &&
        (typeof value[sizeKey] !== 'number' ||
          !Number.isFinite(value[sizeKey]) ||
          value[sizeKey] <= 0))
    ) {
      return undefined;
    }
    ids.add(value.id);
  }
  return ids;
}

function isOptionalPositiveInteger(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && (value as number) > 0);
}

function isValidMindElement(
  value: Record<string, unknown>,
  ids: Set<string>,
  root: boolean,
  depth: number
): boolean {
  if (
    depth > MAX_BOARD_VALUE_DEPTH ||
    (root ? !['mind', 'mindmap'].includes(value.type as string) : value.type !== 'mind_child') ||
    !isRecord(value.data) ||
    !isValidSlateElement(value.data.topic) ||
    !Array.isArray(value.children) ||
    (root && !hasValidPoints(value, 1)) ||
    (!root && value.points !== undefined && !hasValidPoints(value, 1)) ||
    !isValidMindData(value.data)
  ) {
    return false;
  }

  return value.children.every((child) => {
    if (!registerPlaitElementIdentity(child, ids) || child.type !== 'mind_child') {
      return false;
    }
    return isValidMindElement(child, ids, false, depth + 1);
  });
}

function isValidMindData(value: Record<string, unknown>): boolean {
  if (
    value.emojis !== undefined &&
    (!Array.isArray(value.emojis) ||
      !value.emojis.every(
        (emoji) => isRecord(emoji) && typeof emoji.name === 'string' && emoji.name.length > 0
      ))
  ) {
    return false;
  }
  if (value.image !== undefined) {
    return (
      isRecord(value.image) &&
      typeof value.image.url === 'string' &&
      value.image.url.trim().length > 0 &&
      typeof value.image.width === 'number' &&
      Number.isFinite(value.image.width) &&
      value.image.width > 0 &&
      typeof value.image.height === 'number' &&
      Number.isFinite(value.image.height) &&
      value.image.height > 0
    );
  }
  return true;
}

function isValidDrawTextArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        item.id.trim().length > 0 &&
        isValidSlateElement(item.text)
    )
  );
}

function isValidSlateElement(value: unknown, depth = 0): boolean {
  return (
    depth <= MAX_BOARD_VALUE_DEPTH &&
    isRecord(value) &&
    Array.isArray(value.children) &&
    value.children.length > 0 &&
    value.children.every((child) => isValidSlateNode(child, depth + 1))
  );
}

function isValidSlateNode(value: unknown, depth: number): boolean {
  if (depth > MAX_BOARD_VALUE_DEPTH || !isRecord(value)) {
    return false;
  }
  if (typeof value.text === 'string') {
    return value.children === undefined;
  }
  return isValidSlateElement(value, depth);
}

function hasValidPoints(
  value: Record<string, unknown>,
  minimum: number,
  maximum = Number.POSITIVE_INFINITY
): boolean {
  return (
    Array.isArray(value.points) &&
    value.points.length >= minimum &&
    value.points.length <= maximum &&
    value.points.every(isPoint)
  );
}

function isPoint(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  );
}

function hasNoPlaitChildren(value: Record<string, unknown>): boolean {
  return value.children === undefined;
}

function isSafeStoredBoardValue(value: unknown): boolean {
  const ancestors = new WeakSet<object>();
  const budget = { remaining: MAX_BOARD_VALUE_COUNT };

  const visit = (current: unknown, depth: number): boolean => {
    budget.remaining -= 1;
    if (budget.remaining < 0 || depth > MAX_BOARD_VALUE_DEPTH) {
      return false;
    }
    if (
      current === null ||
      current === undefined ||
      typeof current === 'string' ||
      typeof current === 'boolean'
    ) {
      return true;
    }
    if (typeof current === 'number') {
      return Number.isFinite(current);
    }
    if (typeof current !== 'object') {
      return false;
    }
    if (ancestors.has(current)) {
      return false;
    }

    const isArray = Array.isArray(current);
    if (isArray) {
      for (let index = 0; index < current.length; index += 1) {
        if (!(index in current)) {
          return false;
        }
      }
    } else {
      const prototype = Object.getPrototypeOf(current);
      if (!isRecord(current) || (prototype !== Object.prototype && prototype !== null)) {
        return false;
      }
    }
    ancestors.add(current);
    const values = isArray ? current : Object.values(current);
    const valid = values.every((entry) => visit(entry, depth + 1));
    ancestors.delete(current);
    return valid;
  };

  return visit(value, 0);
}

function parseViewport(value: unknown): Viewport | undefined {
  if (
    !isRecord(value) ||
    typeof value.zoom !== 'number' ||
    !Number.isFinite(value.zoom) ||
    value.zoom <= 0
  ) {
    return undefined;
  }
  if (
    value.origination !== undefined &&
    (!Array.isArray(value.origination) ||
      value.origination.length !== 2 ||
      !value.origination.every(
        (coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)
      ))
  ) {
    return undefined;
  }
  return value as Viewport;
}

function parseTheme(value: unknown): PlaitTheme | undefined {
  const modes = ['default', 'colorful', 'soft', 'retro', 'dark', 'starry'];
  return isRecord(value) &&
    typeof value.themeColorMode === 'string' &&
    modes.includes(value.themeColorMode)
    ? (value as unknown as PlaitTheme)
    : undefined;
}

function parsePreferences(value: Partial<Preferences> | undefined): Partial<Preferences> {
  if (!value) {
    return {};
  }
  return {
    ...(['zh', 'en', 'ru', 'ar', 'vi'].includes(value.language ?? '')
      ? { language: value.language }
      : {}),
    ...(typeof value.copyTransparent === 'boolean'
      ? { copyTransparent: value.copyTransparent }
      : {}),
    ...(typeof value.exportTransparent === 'boolean'
      ? { exportTransparent: value.exportTransparent }
      : {}),
  };
}

function parseStoredPreferences(value: unknown): Partial<Preferences> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const languages: readonly string[] = ['zh', 'en', 'ru', 'ar', 'vi'];
  if (value.language !== undefined && !languages.includes(value.language as string)) {
    return undefined;
  }
  if (
    (value.copyTransparent !== undefined && typeof value.copyTransparent !== 'boolean') ||
    (value.exportTransparent !== undefined && typeof value.exportTransparent !== 'boolean')
  ) {
    return undefined;
  }
  if (value.context !== undefined) {
    if (!isRecord(value.context)) {
      return undefined;
    }
    const modes: readonly string[] = ['unknown', 'teaching', 'learning', 'collaboration'];
    const subjects: readonly string[] = ['unknown', 'math', 'physics', 'language', 'other'];
    if (
      (value.context.sessionMode !== undefined &&
        !modes.includes(value.context.sessionMode as string)) ||
      (value.context.subject !== undefined && !subjects.includes(value.context.subject as string))
    ) {
      return undefined;
    }
  }
  return value as Partial<Preferences>;
}

function parseToolState(value: unknown): Partial<DrawnixToolState> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    !isOptionalAllowedToolPointer(value.pointer, DRAWNIX_TOOL_POINTERS) ||
    !isOptionalAllowedToolPointer(value.lastShapePointer, SHAPE_TOOL_POINTERS) ||
    !isOptionalAllowedToolPointer(value.lastArrowPointer, ARROW_TOOL_POINTERS) ||
    !isOptionalAllowedToolPointer(value.lastFreehandPointer, FREEHAND_TOOL_POINTERS)
  ) {
    return undefined;
  }
  const parsedPresets = parseFreehandPresets(value.freehandPresets);
  if (value.freehandPresets !== undefined && parsedPresets === undefined) {
    return undefined;
  }
  const presetCount = parsedPresets?.length || DEFAULT_FREEHAND_PRESET_COUNT;
  if (
    value.activeFreehandPresetIndex !== undefined &&
    (!Number.isInteger(value.activeFreehandPresetIndex) ||
      (value.activeFreehandPresetIndex as number) < 0 ||
      (value.activeFreehandPresetIndex as number) >= presetCount)
  ) {
    return undefined;
  }
  return {
    ...(value.pointer === undefined ? {} : { pointer: value.pointer }),
    ...(value.lastShapePointer === undefined ? {} : { lastShapePointer: value.lastShapePointer }),
    ...(value.lastArrowPointer === undefined ? {} : { lastArrowPointer: value.lastArrowPointer }),
    ...(value.lastFreehandPointer === undefined
      ? {}
      : { lastFreehandPointer: value.lastFreehandPointer }),
    ...(value.activeFreehandPresetIndex === undefined
      ? {}
      : { activeFreehandPresetIndex: value.activeFreehandPresetIndex }),
    ...(parsedPresets === undefined ? {} : { freehandPresets: parsedPresets }),
  } as Partial<DrawnixToolState>;
}

function isOptionalAllowedToolPointer(value: unknown, allowed: ReadonlySet<string>): boolean {
  return value === undefined || (typeof value === 'string' && allowed.has(value));
}

function parseFreehandPresets(
  value: unknown
): Array<{ strokeWidth: number; strokeColor?: string }> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_FREEHAND_PRESET_COUNT ||
    !value.every(
      (preset) =>
        isRecord(preset) &&
        typeof preset.strokeWidth === 'number' &&
        Number.isFinite(preset.strokeWidth) &&
        preset.strokeWidth >= MIN_FREEHAND_STROKE_WIDTH &&
        preset.strokeWidth <= MAX_FREEHAND_STROKE_WIDTH &&
        (preset.strokeColor === undefined ||
          (typeof preset.strokeColor === 'string' && preset.strokeColor.length <= 128))
    )
  ) {
    return undefined;
  }
  return value.map((preset) => ({
    strokeWidth: preset.strokeWidth as number,
    ...(typeof preset.strokeColor === 'string' ? { strokeColor: preset.strokeColor } : {}),
  }));
}

function parseExplicitContext(value: unknown): Partial<ExplicitBoardContext> {
  if (!isRecord(value)) {
    return {};
  }
  const sessionModes = ['unknown', 'teaching', 'learning', 'collaboration'] as const;
  const subjects = ['unknown', 'math', 'physics', 'language', 'other'] as const;
  return {
    ...(sessionModes.includes(value.sessionMode as ExplicitBoardContext['sessionMode'])
      ? { sessionMode: value.sessionMode as ExplicitBoardContext['sessionMode'] }
      : {}),
    ...(subjects.includes(value.subject as ExplicitBoardContext['subject'])
      ? { subject: value.subject as ExplicitBoardContext['subject'] }
      : {}),
  };
}

function parseConsoleState(value: unknown): Partial<MagicConsoleState> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const tabs = ['Overview', 'Features', 'Board Inspector', 'Input', 'Actors', 'Events'];
  if (
    (value.open !== undefined && typeof value.open !== 'boolean') ||
    (value.width !== undefined &&
      (typeof value.width !== 'number' || !Number.isFinite(value.width))) ||
    (value.tab !== undefined && (typeof value.tab !== 'string' || !tabs.includes(value.tab)))
  ) {
    return undefined;
  }
  return {
    ...(typeof value.open === 'boolean' ? { open: value.open } : {}),
    ...(typeof value.width === 'number' && Number.isFinite(value.width)
      ? { width: value.width }
      : {}),
    ...(typeof value.tab === 'string' && tabs.includes(value.tab)
      ? { tab: value.tab as MagicConsoleState['tab'] }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function persistItem(store: MagicStores[keyof MagicStores], key: string, value: unknown): void {
  try {
    void store.setItem(key, value).catch((error: unknown) => {
      console.warn(`Magic Blackboard could not persist "${key}".`, error);
    });
  } catch (error) {
    console.warn(`Magic Blackboard could not persist "${key}".`, error);
  }
}

function persistItemUnlessLocked(
  locks: readonly StorageSlot[],
  slot: StorageSlot,
  store: MagicStores[keyof MagicStores],
  key: string,
  value: unknown
): void {
  if (!locks.includes(slot)) {
    persistItem(store, key, value);
  }
}

function persistItemNow(
  session: AppSession,
  locks: readonly StorageSlot[],
  slot: StorageSlot,
  store: MagicStores[keyof MagicStores],
  key: string,
  value: unknown
): void {
  cancelPendingPersistence(session, slot);
  persistItemUnlessLocked(locks, slot, store, key, value);
}

function cancelPendingPersistence(session: AppSession, slot: StorageSlot): void {
  const pending = session.pendingPersistence.get(slot);
  if (!pending) {
    return;
  }
  clearTimeout(pending.timer);
  session.pendingPersistence.delete(slot);
}

function shouldPersistDocumentImmediately(
  operation: BoardChangeData['operations'][number]
): boolean {
  return ['insert_node', 'remove_node', 'move_node'].includes(operation.type);
}

function shouldScheduleDocumentPersistence(operations: BoardChangeData['operations']): boolean {
  if (operations.length === 0) {
    return true;
  }
  return operations.some((operation) => operation.type !== 'set_selection');
}

function schedulePersistItem(
  session: AppSession,
  locks: readonly StorageSlot[],
  slot: StorageSlot,
  store: MagicStores[keyof MagicStores],
  key: string,
  value: unknown,
  delay: number
): void {
  if (locks.includes(slot)) {
    return;
  }
  const pending = session.pendingPersistence.get(slot);
  if (pending) {
    cancelPendingPersistence(session, slot);
  }

  let flushed = false;
  const flush = () => {
    if (flushed) {
      return;
    }
    flushed = true;
    clearTimeout(timer);
    if (session.pendingPersistence.get(slot)?.flush === flush) {
      session.pendingPersistence.delete(slot);
    }
    persistItem(store, key, value);
  };
  const timer = setTimeout(flush, delay);
  session.pendingPersistence.set(slot, { timer, flush });
}

function flushPendingPersistence(session: AppSession): void {
  for (const pending of Array.from(session.pendingPersistence.values())) {
    try {
      pending.flush();
    } catch (error) {
      console.warn('Magic Blackboard could not flush pending local state.', error);
    }
  }
}

const toBoardState = (change: BoardChangeData): BoardState => ({
  schemaVersion: BOARD_DOCUMENT_SCHEMA_VERSION,
  children: change.children,
  viewport: change.viewport,
  theme: change.theme,
});

const PRODUCT_COPY = {
  zh: {
    context: '上下文',
    session: '场景',
    subject: '学科',
    unknown: '未指定',
    teaching: '教学',
    learning: '学习',
    collaboration: '协作',
    math: '数学',
    physics: '物理',
    language: '语言',
    other: '其他',
    explicitContextNote: '显式选择优先；自动意图识别尚未接入。',
    recoveryWarning: (count: number) =>
      `${count} 项本地状态未能恢复，已使用安全默认值并暂停受影响项的自动保存；原存储未修改。`,
  },
  en: {
    context: 'Context',
    session: 'Session',
    subject: 'Subject',
    unknown: 'Not set',
    teaching: 'Teaching',
    learning: 'Learning',
    collaboration: 'Collaboration',
    math: 'Math',
    physics: 'Physics',
    language: 'Language',
    other: 'Other',
    explicitContextNote: 'Explicit choices take priority; automatic intent recognition is offline.',
    recoveryWarning: (count: number) =>
      `${count} local item(s) could not be restored. Safe defaults are active and autosave is paused for affected items; the original storage was not modified.`,
  },
} as const;

const contextLabel = (
  { sessionMode, subject }: ExplicitBoardContext,
  language: Language
): string => {
  const copy = PRODUCT_COPY[toProductLanguage(language)];
  return `${copy[sessionMode]} / ${copy[subject]}`;
};

const toProductLanguage = (language: Language): keyof typeof PRODUCT_COPY =>
  language === 'zh' ? 'zh' : 'en';

export default App;
