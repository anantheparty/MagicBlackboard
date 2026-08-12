import { MagicConsole, type MagicConsoleState } from '@magic-blackboard/console';
import {
  Drawnix,
  isValidFreehandInkData,
  MAX_FREEHAND_INK_SAMPLES,
  MAX_LEGACY_FREEHAND_POINTS,
  type DrawnixToolState,
  type Language,
} from '@drawnix/drawnix';
import { PlaitCanvasAdapter } from '@magic-blackboard/plait';
import { createMagicRuntime, type MagicRuntime } from '@magic-blackboard/runtime';
import type { BoardChangeData } from '@plait-board/react-board';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  type PlaitElement,
  type PlaitPlugin,
  type PlaitTheme,
  type Viewport,
} from '@plait/core';
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
import { createMagicInkFeatureDefinitions, MagicInkController } from './ink';
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
  readonly inkController: MagicInkController;
  readonly additionalPlugins: readonly PlaitPlugin[];
  readonly pendingPersistence: Map<StorageSlot, PendingPersistence>;
  readonly persistenceLocks: Set<StorageSlot>;
  readonly writeFailureLocks: Set<StorageSlot>;
  readonly onPersistenceFailure: (slot: StorageSlot, key: string, error: unknown) => void;
  readonly onPersistenceValidationFailure: (slot: StorageSlot, warning: string) => void;
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
  readonly createInkController?: (runtime: MagicRuntime<PlaitCanvasAdapter>) => MagicInkController;
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
// Keep product-owned recovery and write-side validation aligned with the
// reusable Drawnix import envelope. This admits multiple creator-valid
// pressure strokes while still bounding local restoration work.
const MAX_BOARD_VALUE_COUNT = 2_000_000;
const BOARD_INK_PRIVACY_WARNING =
  'board document contains raw input or device metadata; automatic saving is paused.';
const BOARD_ELEMENT_SCHEMA_WARNING =
  'board document contains unsupported element or ink data; automatic saving is paused.';
const PERSISTENCE_WRITE_WARNINGS: Readonly<Record<StorageSlot, string>> = {
  'board.document': 'board document could not be saved; automatic saving is paused.',
  'board.tool-state': 'board tool state could not be saved; automatic saving is paused.',
  'preferences.current': 'preferences could not be saved; automatic saving is paused.',
  'console.layout': 'console layout could not be saved; automatic saving is paused.',
};
const PERSISTABLE_FREEHAND_FIELDS = new Set([
  'angle',
  'fill',
  'fillStyle',
  'groupId',
  'id',
  'ink',
  'opacity',
  'points',
  'shape',
  'strokeColor',
  'strokeStyle',
  'strokeWidth',
  'type',
]);
const PERSISTABLE_FREEHAND_STROKE_STYLES = new Set(['solid', 'dashed', 'dotted']);
const PERSISTABLE_FREEHAND_FILL_STYLES = new Set([
  'solid',
  'hachure',
  'zigzag',
  'cross-hatch',
  'dots',
  'dashed',
  'zigzag-line',
]);
const PERSISTABLE_GEOMETRY_FIELDS = new Set([
  'angle',
  'autoSize',
  'cells',
  'columns',
  'fill',
  'fillStyle',
  'groupId',
  'id',
  'opacity',
  'points',
  'rows',
  'shape',
  'strokeColor',
  'strokeStyle',
  'strokeWidth',
  'text',
  'texts',
  'type',
]);
const PERSISTABLE_ARROW_LINE_FIELDS = new Set([
  'groupId',
  'id',
  'opacity',
  'points',
  'shape',
  'source',
  'strokeColor',
  'strokeStyle',
  'strokeWidth',
  'target',
  'texts',
  'type',
]);
const PERSISTABLE_VECTOR_LINE_FIELDS = new Set([
  'angle',
  'fill',
  'groupId',
  'id',
  'opacity',
  'points',
  'shape',
  'strokeColor',
  'strokeStyle',
  'strokeWidth',
  'type',
]);
const PERSISTABLE_IMAGE_FIELDS = new Set(['angle', 'groupId', 'id', 'points', 'type', 'url']);
const PERSISTABLE_TABLE_FIELDS = new Set([
  'angle',
  'cells',
  'columns',
  'groupId',
  'header',
  'id',
  'points',
  'rows',
  'shape',
  'strokeColor',
  'strokeStyle',
  'type',
]);
const PERSISTABLE_GROUP_FIELDS = new Set(['groupId', 'id', 'type']);
const PERSISTABLE_MIND_FIELDS = new Set([
  'angle',
  'branchColor',
  'branchShape',
  'branchWidth',
  'children',
  'data',
  'end',
  'fill',
  'groupId',
  'id',
  'isCollapsed',
  'layout',
  'manualWidth',
  'points',
  'rightNodeCount',
  'shape',
  'start',
  'strokeColor',
  'strokeStyle',
  'strokeWidth',
  'type',
]);
const PERSISTABLE_SLATE_ELEMENT_FIELDS = new Set(['align', 'children', 'direction', 'type', 'url']);
const PERSISTABLE_SLATE_TEXT_FIELDS = new Set([
  'bold',
  'code',
  'color',
  'font-size',
  'italic',
  'strike',
  'text',
  'underlined',
]);
const PERSISTABLE_ARROW_HANDLE_FIELDS = new Set(['boundId', 'connection', 'marker']);
const PERSISTABLE_DRAW_TEXT_FIELDS = new Set(['id', 'position', 'text']);
const PERSISTABLE_TABLE_ROW_FIELDS = new Set(['height', 'id']);
const PERSISTABLE_TABLE_COLUMN_FIELDS = new Set(['id', 'width']);
const PERSISTABLE_TABLE_CELL_FIELDS = new Set([
  'columnId',
  'colspan',
  'fill',
  'id',
  'rowId',
  'rowspan',
  'text',
]);
const PERSISTABLE_MIND_DATA_FIELDS = new Set(['emojis', 'image', 'topic']);
const PERSISTABLE_MIND_EMOJI_FIELDS = new Set(['name']);
const PERSISTABLE_MIND_IMAGE_FIELDS = new Set(['height', 'url', 'width']);
const FORBIDDEN_PERSISTED_INK_KEYS = new Set([
  'altkey',
  'altitude',
  'azimuth',
  'button',
  'buttons',
  'capturedat',
  'capabilities',
  'capabilityfingerprint',
  'clientx',
  'clienty',
  'coalescedevents',
  'contactheight',
  'contactwidth',
  'ctrlkey',
  'deviceid',
  'deviceidentifier',
  'diagnostic',
  'diagnostics',
  'driverfingerprint',
  'event',
  'events',
  'height',
  'isprimary',
  'movementx',
  'movementy',
  'metakey',
  'offsetx',
  'offsety',
  'pagex',
  'pagey',
  'altitudeangle',
  'azimuthangle',
  'observedat',
  'pointerevent',
  'pointerevents',
  'pointerid',
  'pointertype',
  'pointerrawupdate',
  'predictedevents',
  'pressure',
  'pressurehistory',
  'pressures',
  'rawcoordinates',
  'rawpointerevent',
  'rawpointerevents',
  'rawpoints',
  'rawpressure',
  'rawpressures',
  'rawsample',
  'rawsamples',
  'sample',
  'samples',
  'samplepressure',
  'screenx',
  'screeny',
  'shiftkey',
  'stylusid',
  'tilt',
  'tiltx',
  'tilty',
  'timestamp',
  'timestamps',
  'time',
  'tangentialpressure',
  'twist',
  'width',
]);
const FORBIDDEN_PERSISTED_INK_KEY_PREFIXES = [
  'altitude',
  'azimuth',
  'capabilityfingerprint',
  'capturedat',
  'contactheight',
  'contactwidth',
  'deviceid',
  'diagnostic',
  'driverfingerprint',
  'force',
  'observedat',
  'pointerevent',
  'pointertype',
  'pressure',
  'rawcoordinate',
  'rawpointerevent',
  'rawpressure',
  'rawsample',
  'reading',
  'sample',
  'tangentialpressure',
  'sampletimestamp',
  'stylusid',
  'sensor',
  'tilt',
  'timestamp',
  'twist',
  'wallclock',
] as const;

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
  ...createMagicInkFeatureDefinitions(import.meta.env.DEV),
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
  const createInkControllerDependency = dependencies.createInkController;

  useEffect(() => {
    let active = true;
    let adapter: PlaitCanvasAdapter | undefined;
    let runtime: MagicRuntime<PlaitCanvasAdapter> | undefined;
    let inkController: MagicInkController | undefined;
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
            featureSettingsKeyPrefix: 'main.features',
          });
      inkController = createInkControllerDependency
        ? createInkControllerDependency(runtime)
        : new MagicInkController(runtime);
      session = {
        stores,
        adapter,
        runtime,
        inkController,
        additionalPlugins: [adapter.asPlugin(), inkController.asPlugin()],
        pendingPersistence: new Map(),
        persistenceLocks: new Set(),
        writeFailureLocks: new Set(),
        onPersistenceFailure: (slot, key, error) => {
          console.warn(`Magic Blackboard could not persist "${key}".`, error);
          cancelPendingPersistence(session, slot);
          session.persistenceLocks.add(slot);
          session.writeFailureLocks.add(slot);
          if (!active) {
            return;
          }
          const warning = PERSISTENCE_WRITE_WARNINGS[slot];
          setReady((current) => {
            if (!current || current.session !== session) {
              return current;
            }
            const hasWarning = current.loaded.recoveryWarnings.includes(warning);
            const hasLock = current.loaded.recoveryLocks.includes(slot);
            if (hasWarning && hasLock) {
              return current;
            }
            return {
              ...current,
              loaded: {
                ...current.loaded,
                recoveryWarnings: hasWarning
                  ? current.loaded.recoveryWarnings
                  : [...current.loaded.recoveryWarnings, warning],
                recoveryLocks: hasLock
                  ? current.loaded.recoveryLocks
                  : [...current.loaded.recoveryLocks, slot],
              },
            };
          });
        },
        onPersistenceValidationFailure: (slot, warning) => {
          cancelPendingPersistence(session, slot);
          session.persistenceLocks.add(slot);
          if (!active) {
            return;
          }
          setReady((current) => {
            if (!current || current.session !== session) {
              return current;
            }
            const hasWarning = current.loaded.recoveryWarnings.includes(warning);
            const hasLock = current.loaded.recoveryLocks.includes(slot);
            if (hasWarning && hasLock) {
              return current;
            }
            return {
              ...current,
              loaded: {
                ...current.loaded,
                recoveryWarnings: hasWarning
                  ? current.loaded.recoveryWarnings
                  : [...current.loaded.recoveryWarnings, warning],
                recoveryLocks: hasLock
                  ? current.loaded.recoveryLocks
                  : [...current.loaded.recoveryLocks, slot],
              },
            };
          });
        },
        latestBoard: null,
      };
    } catch (error) {
      disposePartialSession(runtime, adapter, inkController);
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
        replacePersistenceLocks(session, state.recoveryLocks);
        session.latestBoard = state.board;
        setReady({
          session,
          loaded: state,
          tutorial: state.board.children.length === 0,
        });
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
        replacePersistenceLocks(session, fallback.recoveryLocks);
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
      try {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      } catch (error) {
        console.error('Magic visibility listener cleanup failed', error);
      }
      try {
        window.removeEventListener('pagehide', handlePageHide);
      } catch (error) {
        console.error('Magic page lifecycle cleanup failed', error);
      }
      try {
        flushSessionPersistence();
      } catch (error) {
        console.error('Magic persistence cleanup failed', error);
      }
      disposePartialSession(runtime, adapter, inkController, 'session');
    };
  }, [
    createAdapterDependency,
    createInkControllerDependency,
    createRuntimeDependency,
    createStoresDependency,
  ]);

  const updatePreferences = useCallback(
    (patch: Partial<Preferences>) => {
      setReady((current) => {
        if (!current || current.session !== ready?.session) {
          return current;
        }
        const preferences = { ...current.loaded.preferences, ...patch };
        persistItemUnlessLocked(
          current.session,
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
          current.session,
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
      if (!session) {
        return;
      }
      schedulePersistItem(
        session,
        'console.layout',
        session.stores.console,
        CONSOLE_KEY,
        nextConsoleState,
        150
      );
    },
    [ready?.session]
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
          const previousBoard = session.latestBoard;
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
          const persistImmediately =
            change.source === 'document-replace' ||
            change.operations.some(shouldPersistDocumentImmediately);
          const schedulePersistence = shouldScheduleDocumentPersistence(change.operations);
          if (!persistImmediately && !schedulePersistence) {
            return;
          }
          const persistenceWarning =
            change.source === 'document-replace'
              ? getBoardPersistenceWarning(nextBoard)
              : !session.persistenceLocks.has('board.document')
                ? getIncrementalBoardPersistenceWarning(change, previousBoard, nextBoard)
                : undefined;
          if (persistenceWarning) {
            cancelPendingPersistence(session, 'board.document');
            if (!session.persistenceLocks.has('board.document')) {
              session.persistenceLocks.add('board.document');
              setReady((current) => {
                if (!current || current.session !== session) {
                  return current;
                }
                return {
                  ...current,
                  loaded: {
                    ...current.loaded,
                    recoveryWarnings: current.loaded.recoveryWarnings.includes(persistenceWarning)
                      ? current.loaded.recoveryWarnings
                      : [...current.loaded.recoveryWarnings, persistenceWarning],
                    recoveryLocks: current.loaded.recoveryLocks.includes('board.document')
                      ? current.loaded.recoveryLocks
                      : [...current.loaded.recoveryLocks, 'board.document'],
                  },
                };
              });
            }
            return;
          }
          if (
            change.source === 'document-replace' &&
            !session.writeFailureLocks.has('board.document') &&
            session.persistenceLocks.delete('board.document')
          ) {
            setReady((current) => {
              if (!current || current.session !== session) {
                return current;
              }
              return {
                ...current,
                loaded: {
                  ...current.loaded,
                  recoveryWarnings: current.loaded.recoveryWarnings.filter(
                    (warning) => !isBoardRecoveryWarning(warning)
                  ),
                  recoveryLocks: current.loaded.recoveryLocks.filter(
                    (lock) => lock !== 'board.document'
                  ),
                },
              };
            });
          }
          if (persistImmediately) {
            persistItemNow(session, 'board.document', stores.board, BOARD_KEY, nextBoard);
          } else if (schedulePersistence) {
            schedulePersistItem(session, 'board.document', stores.board, BOARD_KEY, nextBoard, 200);
          }
        }}
        onToolStateChange={(nextToolState) => {
          persistItemUnlessLocked(
            session,
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
  adapter: PlaitCanvasAdapter | undefined,
  inkController?: MagicInkController,
  phase: 'initialization' | 'session' = 'initialization'
): void {
  const phaseLabel = phase === 'initialization' ? ' during initialization' : '';
  try {
    inkController?.dispose();
  } catch (error) {
    console.error(`Magic ink input cleanup failed${phaseLabel}`, error);
  }
  try {
    runtime?.dispose();
  } catch (error) {
    console.error(`Magic runtime cleanup failed${phaseLabel}`, error);
  }
  try {
    adapter?.dispose();
  } catch (error) {
    console.error(`Magic adapter cleanup failed${phaseLabel}`, error);
  }
}

function replacePersistenceLocks(session: AppSession, locks: readonly StorageSlot[]): void {
  session.persistenceLocks.clear();
  for (const lock of locks) {
    session.persistenceLocks.add(lock);
  }
}

function isBoardRecoveryWarning(warning: string): boolean {
  return warning === BOARD_INK_PRIVACY_WARNING || warning.startsWith('board document ');
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
                onContextChange({
                  subject: event.target.value as ExplicitBoardContext['subject'],
                })
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
    recoverBoardItem(stores.board),
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

async function recoverBoardItem(store: MagicStores['board']): Promise<RecoverResult<BoardState>> {
  const result = await recoverItem(store, BOARD_KEY, 'board document', parseBoardState);
  if (!result.value) {
    return result;
  }
  const warning = getBoardPersistenceWarning(result.value);
  if (!warning) {
    return result;
  }
  return {
    value: result.value,
    warning,
    locked: true,
  };
}

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
  return (
    values.every((value) => isValidTopLevelPlaitElement(value, ids)) &&
    haveValidGroupReferences(values)
  );
}

function haveValidGroupReferences(values: readonly unknown[]): boolean {
  const elements = new Map<string, Record<string, unknown>>();
  const pending = [...values];
  while (pending.length > 0) {
    const value = pending.pop();
    if (!isRecord(value) || typeof value.id !== 'string') {
      return false;
    }
    elements.set(value.id, value);
    if (
      (value.type === 'mind' || value.type === 'mindmap' || value.type === 'mind_child') &&
      Array.isArray(value.children)
    ) {
      pending.push(...value.children);
    }
  }

  for (const element of elements.values()) {
    if (typeof element.groupId !== 'string') {
      continue;
    }
    const group = elements.get(element.groupId);
    if (!group || group.type !== 'group' || group === element) {
      return false;
    }
  }

  const visited = new Set<string>();
  for (const element of elements.values()) {
    if (element.type !== 'group' || visited.has(element.id as string)) {
      continue;
    }
    const path: string[] = [];
    const pathIds = new Set<string>();
    let current: Record<string, unknown> | undefined = element;
    while (current) {
      const id = current.id as string;
      if (visited.has(id)) {
        break;
      }
      if (pathIds.has(id)) {
        return false;
      }
      path.push(id);
      pathIds.add(id);
      current = typeof current.groupId === 'string' ? elements.get(current.groupId) : undefined;
    }
    for (const id of path) {
      visited.add(id);
    }
  }
  return true;
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
      return isValidStoredFreehandElement(value);
    default:
      return false;
  }
}

function isValidStoredFreehandElement(value: Record<string, unknown>): boolean {
  if (
    !hasNoPlaitChildren(value) ||
    typeof value.shape !== 'string' ||
    !FREEHAND_SHAPES.has(value.shape) ||
    !Array.isArray(value.points)
  ) {
    return false;
  }
  const hasAlignedV1Ink = isValidFreehandInkData(value.ink, value.points.length);
  return hasValidPoints(
    value,
    1,
    hasAlignedV1Ink ? MAX_FREEHAND_INK_SAMPLES : MAX_LEGACY_FREEHAND_POINTS
  );
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

export function isSafeStoredBoardValue(value: unknown): boolean {
  const ancestors = new WeakSet<object>();
  const budget = { remaining: MAX_BOARD_VALUE_COUNT };

  const visit = (current: unknown, depth: number, allowNonFinite = false): boolean => {
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
      return allowNonFinite || Number.isFinite(current);
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
    const valid = isArray
      ? current.every((entry) => visit(entry, depth + 1, allowNonFinite))
      : Object.entries(current).every(([key, entry]) =>
          visit(entry, depth + 1, allowNonFinite || (key === 'ink' && current.type === 'freehand'))
        );
    ancestors.delete(current);
    return valid;
  };

  return visit(value, 0);
}

function containsForbiddenPersistedInputData(elements: readonly unknown[]): boolean {
  for (const element of elements) {
    if (
      isRecord(element) &&
      hasForbiddenPersistedInputValue(element, element.type === 'freehand')
    ) {
      return true;
    }
  }
  return false;
}

function containsUnsupportedPersistedElementData(elements: readonly unknown[]): boolean {
  return (
    !isSafeStoredBoardValue({
      schemaVersion: BOARD_DOCUMENT_SCHEMA_VERSION,
      children: elements,
    }) ||
    !areValidPlaitElements(elements) ||
    elements.some((element) => !isPersistableTopLevelElement(element))
  );
}

function isPersistableTopLevelElement(value: unknown): boolean {
  if (!isRecord(value) || !isValidTopLevelPlaitElement(value, new Set<string>())) {
    return false;
  }
  switch (value.type) {
    case 'freehand':
      return isPersistableFreehandElement(value);
    case 'geometry':
      return (
        hasOnlyPersistableKeys(value, PERSISTABLE_GEOMETRY_FIELDS) &&
        hasPersistableCommonDrawFields(value) &&
        hasPersistableGeometryContent(value)
      );
    case 'arrow-line':
    case 'line':
      return (
        hasOnlyPersistableKeys(value, PERSISTABLE_ARROW_LINE_FIELDS) &&
        hasPersistableStrokeFields(value) &&
        isPersistableArrowHandle(value.source) &&
        isPersistableArrowHandle(value.target) &&
        isPersistableDrawTextArray(value.texts)
      );
    case 'vector-line':
      return (
        hasOnlyPersistableKeys(value, PERSISTABLE_VECTOR_LINE_FIELDS) &&
        hasPersistableCommonDrawFields(value)
      );
    case 'image':
      return (
        hasOnlyPersistableKeys(value, PERSISTABLE_IMAGE_FIELDS) &&
        (value.angle === undefined ||
          (typeof value.angle === 'number' && Number.isFinite(value.angle)))
      );
    case 'table':
      return (
        hasOnlyPersistableKeys(value, PERSISTABLE_TABLE_FIELDS) &&
        value.header === undefined &&
        value.shape === undefined &&
        hasPersistableTableStrokeFields(value) &&
        isPersistableTableAxes(value.rows, 'height') &&
        isPersistableTableAxes(value.columns, 'width') &&
        isPersistableTableCells(value.cells)
      );
    case 'swimlane':
      return (
        hasOnlyPersistableKeys(value, PERSISTABLE_TABLE_FIELDS) &&
        (value.header === undefined || typeof value.header === 'boolean') &&
        hasPersistableTableStrokeFields(value) &&
        isPersistableTableAxes(value.rows, 'height') &&
        isPersistableTableAxes(value.columns, 'width') &&
        isPersistableTableCells(value.cells)
      );
    case 'group':
      return hasOnlyPersistableKeys(value, PERSISTABLE_GROUP_FIELDS);
    case 'mind':
    case 'mindmap':
      return isPersistableMindElement(value, true);
    default:
      return false;
  }
}

function hasPersistableGeometryContent(value: Record<string, unknown>): boolean {
  if (typeof value.shape !== 'string') {
    return false;
  }
  if (GEOMETRY_WITH_TABLE_DATA_SHAPES.has(value.shape)) {
    return (
      value.text === undefined &&
      value.texts === undefined &&
      value.autoSize === undefined &&
      isPersistableTableAxes(value.rows, 'height') &&
      isPersistableTableAxes(value.columns, 'width') &&
      isPersistableTableCells(value.cells)
    );
  }
  if (GEOMETRY_WITH_MULTIPLE_TEXT_SHAPES.has(value.shape)) {
    return (
      value.text === undefined &&
      value.rows === undefined &&
      value.columns === undefined &&
      value.cells === undefined &&
      value.autoSize === undefined &&
      isPersistableDrawTextArray(value.texts)
    );
  }
  if (GEOMETRY_WITHOUT_TEXT_SHAPES.has(value.shape)) {
    return (
      value.text === undefined &&
      value.texts === undefined &&
      value.rows === undefined &&
      value.columns === undefined &&
      value.cells === undefined &&
      value.autoSize === undefined
    );
  }
  return (
    value.texts === undefined &&
    value.rows === undefined &&
    value.columns === undefined &&
    value.cells === undefined &&
    isPersistableSlateElement(value.text) &&
    (value.shape === BasicShapes.text
      ? typeof value.autoSize === 'boolean'
      : value.autoSize === undefined)
  );
}

function isPersistableFreehandElement(value: Record<string, unknown>): boolean {
  if (Object.keys(value).some((key) => !PERSISTABLE_FREEHAND_FIELDS.has(key))) {
    return false;
  }
  if (
    typeof value.id !== 'string' ||
    value.id.trim().length === 0 ||
    value.type !== 'freehand' ||
    typeof value.shape !== 'string' ||
    !FREEHAND_SHAPES.has(value.shape) ||
    !Array.isArray(value.points) ||
    value.points.length === 0 ||
    !value.points.every(isPoint)
  ) {
    return false;
  }
  return Object.entries(value).every(([key, entry]) =>
    isPersistableFreehandField(key, entry, value)
  );
}

function isPersistableFreehandField(
  key: string,
  value: unknown,
  element: Record<string, unknown>
): boolean {
  switch (key) {
    case 'id':
      return typeof value === 'string' && value.trim().length > 0;
    case 'type':
      return value === 'freehand';
    case 'shape':
      return typeof value === 'string' && FREEHAND_SHAPES.has(value);
    case 'points':
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.length <=
          (isValidFreehandInkData(element.ink, value.length)
            ? MAX_FREEHAND_INK_SAMPLES
            : MAX_LEGACY_FREEHAND_POINTS) &&
        value.every(isPoint)
      );
    case 'groupId':
      return value === undefined || (typeof value === 'string' && value.trim().length > 0);
    case 'angle':
      return value === undefined || (typeof value === 'number' && Number.isFinite(value));
    case 'fill':
    case 'strokeColor':
      return value === undefined || value === null || typeof value === 'string';
    case 'strokeWidth':
      return (
        value === undefined || (typeof value === 'number' && Number.isFinite(value) && value > 0)
      );
    case 'strokeStyle':
      return (
        value === undefined ||
        (typeof value === 'string' && PERSISTABLE_FREEHAND_STROKE_STYLES.has(value))
      );
    case 'fillStyle':
      return (
        value === undefined ||
        (typeof value === 'string' && PERSISTABLE_FREEHAND_FILL_STYLES.has(value))
      );
    case 'opacity':
      return (
        value === undefined ||
        (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)
      );
    case 'ink':
      return Array.isArray(element.points) && isValidFreehandInkData(value, element.points.length);
    default:
      return false;
  }
}

function hasOnlyPersistableKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasPersistableStrokeFields(value: Record<string, unknown>): boolean {
  return (
    (value.strokeColor === undefined ||
      value.strokeColor === null ||
      typeof value.strokeColor === 'string') &&
    (value.strokeWidth === undefined ||
      (typeof value.strokeWidth === 'number' &&
        Number.isFinite(value.strokeWidth) &&
        value.strokeWidth > 0)) &&
    (value.strokeStyle === undefined ||
      (typeof value.strokeStyle === 'string' &&
        PERSISTABLE_FREEHAND_STROKE_STYLES.has(value.strokeStyle))) &&
    (value.opacity === undefined ||
      (typeof value.opacity === 'number' &&
        Number.isFinite(value.opacity) &&
        value.opacity >= 0 &&
        value.opacity <= 1))
  );
}

function hasPersistableCommonDrawFields(value: Record<string, unknown>): boolean {
  return (
    hasPersistableStrokeFields(value) &&
    (value.fill === undefined || value.fill === null || typeof value.fill === 'string') &&
    (value.fillStyle === undefined ||
      (typeof value.fillStyle === 'string' &&
        PERSISTABLE_FREEHAND_FILL_STYLES.has(value.fillStyle))) &&
    (value.angle === undefined || (typeof value.angle === 'number' && Number.isFinite(value.angle)))
  );
}

function isPersistableArrowHandle(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyPersistableKeys(value, PERSISTABLE_ARROW_HANDLE_FIELDS) &&
    typeof value.marker === 'string' &&
    ARROW_LINE_MARKERS.has(value.marker) &&
    (value.boundId === undefined ||
      (typeof value.boundId === 'string' && value.boundId.trim().length > 0)) &&
    (value.connection === undefined || isPoint(value.connection))
  );
}

function isPersistableDrawTextArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        hasOnlyPersistableKeys(item, PERSISTABLE_DRAW_TEXT_FIELDS) &&
        (item.id === undefined || (typeof item.id === 'string' && item.id.trim().length > 0)) &&
        (item.position === undefined ||
          (typeof item.position === 'number' &&
            Number.isFinite(item.position) &&
            item.position >= 0 &&
            item.position <= 1)) &&
        isPersistableSlateElement(item.text)
    )
  );
}

function isPersistableTableAxes(value: unknown, sizeKey: 'height' | 'width'): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (axis) =>
        isRecord(axis) &&
        hasOnlyPersistableKeys(
          axis,
          sizeKey === 'height' ? PERSISTABLE_TABLE_ROW_FIELDS : PERSISTABLE_TABLE_COLUMN_FIELDS
        ) &&
        typeof axis.id === 'string' &&
        axis.id.trim().length > 0 &&
        (axis[sizeKey] === undefined ||
          (typeof axis[sizeKey] === 'number' &&
            Number.isFinite(axis[sizeKey]) &&
            axis[sizeKey] > 0))
    )
  );
}

function isPersistableTableCells(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (cell) =>
        isRecord(cell) &&
        hasOnlyPersistableKeys(cell, PERSISTABLE_TABLE_CELL_FIELDS) &&
        (cell.fill === undefined || cell.fill === null || typeof cell.fill === 'string') &&
        (cell.text === undefined || isPersistableSlateElement(cell.text))
    )
  );
}

function hasPersistableTableStrokeFields(value: Record<string, unknown>): boolean {
  return (
    (value.angle === undefined ||
      (typeof value.angle === 'number' && Number.isFinite(value.angle))) &&
    (value.strokeColor === undefined ||
      value.strokeColor === null ||
      typeof value.strokeColor === 'string') &&
    (value.strokeStyle === undefined ||
      (typeof value.strokeStyle === 'string' &&
        PERSISTABLE_FREEHAND_STROKE_STYLES.has(value.strokeStyle)))
  );
}

function isPersistableMindElement(value: Record<string, unknown>, root: boolean): boolean {
  return (
    hasOnlyPersistableKeys(value, PERSISTABLE_MIND_FIELDS) &&
    (root ? value.type === 'mind' || value.type === 'mindmap' : value.type === 'mind_child') &&
    isPersistableMindData(value.data) &&
    Array.isArray(value.children) &&
    value.children.every((child) => isRecord(child) && isPersistableMindElement(child, false)) &&
    hasPersistableStrokeFields(value) &&
    (value.angle === undefined ||
      (typeof value.angle === 'number' && Number.isFinite(value.angle))) &&
    (value.fill === undefined || value.fill === null || typeof value.fill === 'string') &&
    (value.manualWidth === undefined ||
      (typeof value.manualWidth === 'number' &&
        Number.isFinite(value.manualWidth) &&
        value.manualWidth > 0)) &&
    (value.branchWidth === undefined ||
      (typeof value.branchWidth === 'number' &&
        Number.isFinite(value.branchWidth) &&
        value.branchWidth > 0)) &&
    (value.rightNodeCount === undefined ||
      (Number.isInteger(value.rightNodeCount) && (value.rightNodeCount as number) >= 0)) &&
    (value.start === undefined ||
      (typeof value.start === 'number' && Number.isFinite(value.start))) &&
    (value.end === undefined || (typeof value.end === 'number' && Number.isFinite(value.end))) &&
    (value.isCollapsed === undefined || typeof value.isCollapsed === 'boolean') &&
    (value.branchColor === undefined ||
      value.branchColor === null ||
      typeof value.branchColor === 'string') &&
    (value.branchShape === undefined || typeof value.branchShape === 'string') &&
    (value.layout === undefined || value.layout === null || typeof value.layout === 'string') &&
    (value.shape === undefined || typeof value.shape === 'string')
  );
}

function isPersistableMindData(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyPersistableKeys(value, PERSISTABLE_MIND_DATA_FIELDS) &&
    isPersistableSlateElement(value.topic) &&
    (value.emojis === undefined ||
      (Array.isArray(value.emojis) &&
        value.emojis.every(
          (emoji) =>
            isRecord(emoji) &&
            hasOnlyPersistableKeys(emoji, PERSISTABLE_MIND_EMOJI_FIELDS) &&
            typeof emoji.name === 'string'
        ))) &&
    (value.image === undefined ||
      (isRecord(value.image) &&
        hasOnlyPersistableKeys(value.image, PERSISTABLE_MIND_IMAGE_FIELDS) &&
        typeof value.image.url === 'string' &&
        typeof value.image.width === 'number' &&
        Number.isFinite(value.image.width) &&
        value.image.width > 0 &&
        typeof value.image.height === 'number' &&
        Number.isFinite(value.image.height) &&
        value.image.height > 0))
  );
}

function isPersistableSlateElement(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyPersistableKeys(value, PERSISTABLE_SLATE_ELEMENT_FIELDS)) {
    return false;
  }
  if (value.type !== undefined && value.type !== 'paragraph' && value.type !== 'link') {
    return false;
  }
  if (value.type === 'link' && typeof value.url !== 'string') {
    return false;
  }
  if (value.type !== 'link' && value.url !== undefined) {
    return false;
  }
  if (
    value.align !== undefined &&
    value.align !== 'left' &&
    value.align !== 'center' &&
    value.align !== 'right'
  ) {
    return false;
  }
  if (
    value.direction !== undefined &&
    value.direction !== 'horizontal' &&
    value.direction !== 'vertical'
  ) {
    return false;
  }
  return Array.isArray(value.children) && value.children.every(isPersistableSlateNode);
}

function isPersistableSlateNode(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.text === 'string') {
    return (
      hasOnlyPersistableKeys(value, PERSISTABLE_SLATE_TEXT_FIELDS) &&
      Object.entries(value).every(([key, entry]) => {
        if (key === 'text' || key === 'color') {
          return typeof entry === 'string';
        }
        if (key === 'font-size') {
          return (
            (typeof entry === 'string' && entry.trim().length > 0) ||
            (typeof entry === 'number' && Number.isFinite(entry) && entry > 0)
          );
        }
        return typeof entry === 'boolean';
      })
    );
  }
  return isPersistableSlateElement(value);
}

export function getBoardPersistenceWarning(board: BoardState): string | undefined {
  if (containsForbiddenPersistedInputData(board.children)) {
    return BOARD_INK_PRIVACY_WARNING;
  }
  return !isSafeStoredBoardValue(board) ||
    !isExactPersistableViewport(board.viewport) ||
    !isExactPersistableTheme(board.theme) ||
    containsUnsupportedPersistedElementData(board.children)
    ? BOARD_ELEMENT_SCHEMA_WARNING
    : undefined;
}

function hasForbiddenPersistedInputValue(value: unknown, strictInkContext = false): boolean {
  const pending: Array<{
    readonly value: unknown;
    readonly strictInkContext: boolean;
  }> = [{ value, strictInkContext }];
  const seen = new WeakSet<object>();
  let remaining = MAX_BOARD_VALUE_COUNT;
  while (pending.length > 0) {
    remaining -= 1;
    if (remaining < 0) {
      return true;
    }
    const currentItem = pending.pop();
    if (!currentItem) {
      continue;
    }
    const current = currentItem.value;
    if (current === null || typeof current !== 'object') {
      if (typeof current === 'function' || typeof current === 'symbol') {
        return true;
      }
      continue;
    }
    if (seen.has(current)) {
      return true;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        if (!(index in current)) {
          return true;
        }
        pending.push({
          value: current[index],
          strictInkContext: currentItem.strictInkContext,
        });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      return true;
    }
    for (const [key, entry] of Object.entries(current)) {
      if (
        isForbiddenPersistedInputKey(key) &&
        (currentItem.strictInkContext || !isAllowedLayoutDimensionKey(key))
      ) {
        return true;
      }
      pending.push({
        value: entry,
        strictInkContext: currentItem.strictInkContext || key === 'ink',
      });
    }
  }
  return false;
}

function normalizePersistedInkKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isForbiddenPersistedInputKey(key: string): boolean {
  const normalized = normalizePersistedInkKey(key);
  return (
    FORBIDDEN_PERSISTED_INK_KEYS.has(normalized) ||
    FORBIDDEN_PERSISTED_INK_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    normalized.endsWith('timestamp')
  );
}

function isAllowedLayoutDimensionKey(key: string): boolean {
  const normalized = normalizePersistedInkKey(key);
  return normalized === 'width' || normalized === 'height';
}

function parseViewport(value: unknown): Viewport | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== 'zoom' && key !== 'origination') ||
    typeof value.zoom !== 'number' ||
    !Number.isFinite(value.zoom) ||
    value.zoom < MIN_ZOOM ||
    value.zoom > MAX_ZOOM
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
    Object.keys(value).length === 1 &&
    Object.prototype.hasOwnProperty.call(value, 'themeColorMode') &&
    typeof value.themeColorMode === 'string' &&
    modes.includes(value.themeColorMode)
    ? (value as unknown as PlaitTheme)
    : undefined;
}

function isExactPersistableViewport(value: unknown): boolean {
  return value === undefined || parseViewport(value) !== undefined;
}

function isExactPersistableTheme(value: unknown): boolean {
  return value === undefined || parseTheme(value) !== undefined;
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
      ? {
          sessionMode: value.sessionMode as ExplicitBoardContext['sessionMode'],
        }
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

function persistItem(
  session: AppSession,
  slot: StorageSlot,
  store: MagicStores[keyof MagicStores],
  key: string,
  value: unknown
): void {
  if (slot === 'board.document' && !isSafeStoredBoardValue(value)) {
    session.onPersistenceValidationFailure(slot, BOARD_ELEMENT_SCHEMA_WARNING);
    return;
  }
  try {
    void store.setItem(key, value).catch((error: unknown) => {
      session.onPersistenceFailure(slot, key, error);
    });
  } catch (error) {
    session.onPersistenceFailure(slot, key, error);
  }
}

function persistItemUnlessLocked(
  session: AppSession,
  slot: StorageSlot,
  store: MagicStores[keyof MagicStores],
  key: string,
  value: unknown
): void {
  if (!session.persistenceLocks.has(slot)) {
    persistItem(session, slot, store, key, value);
  }
}

function persistItemNow(
  session: AppSession,
  slot: StorageSlot,
  store: MagicStores[keyof MagicStores],
  key: string,
  value: unknown
): void {
  cancelPendingPersistence(session, slot);
  persistItemUnlessLocked(session, slot, store, key, value);
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

function getIncrementalBoardPersistenceWarning(
  change: BoardChangeData,
  previousBoard: BoardState | null,
  nextBoard: BoardState
): string | undefined {
  if (
    !isExactPersistableViewport(nextBoard.viewport) ||
    !isExactPersistableTheme(nextBoard.theme)
  ) {
    return BOARD_ELEMENT_SCHEMA_WARNING;
  }
  if (change.operations.length === 0 && previousBoard?.children !== nextBoard.children) {
    return getBoardPersistenceWarning(nextBoard);
  }
  if (changeIntroducesForbiddenInputData(change, nextBoard)) {
    return BOARD_INK_PRIVACY_WARNING;
  }
  return changeIntroducesUnsupportedElementData(change, nextBoard)
    ? BOARD_ELEMENT_SCHEMA_WARNING
    : undefined;
}

function changeIntroducesForbiddenInputData(
  change: BoardChangeData,
  nextBoard: BoardState
): boolean {
  return change.operations.some((operation) => {
    if (!isRecord(operation)) {
      return false;
    }
    const operationRecord: Record<string, unknown> = operation;
    const candidates = [operationRecord.node, operationRecord.newProperties].filter(isRecord);
    if (candidates.length === 0) {
      return false;
    }
    const path = Array.isArray(operationRecord.path) ? operationRecord.path : [];
    const topLevelIndex = path[0];
    const changedElement =
      typeof topLevelIndex === 'number' ? nextBoard.children[topLevelIndex] : undefined;
    const strictInkContext =
      candidates.some((candidate) => candidate.type === 'freehand') ||
      (isRecord(changedElement) && changedElement.type === 'freehand');
    return candidates.some((candidate) =>
      hasForbiddenPersistedElementPatch(candidate, strictInkContext)
    );
  });
}

function changeIntroducesUnsupportedElementData(
  change: BoardChangeData,
  nextBoard: BoardState
): boolean {
  if (
    change.operations.some(
      (operation) =>
        isRecord(operation) &&
        (operation.type === 'insert_node' ||
          operation.type === 'remove_node' ||
          operation.type === 'move_node' ||
          (isRecord(operation.newProperties) &&
            ['groupId', 'id', 'type'].some((key) =>
              Object.prototype.hasOwnProperty.call(operation.newProperties, key)
            )))
    )
  ) {
    return getBoardPersistenceWarning(nextBoard) !== undefined;
  }
  return change.operations.some((operation) => {
    if (!isRecord(operation)) {
      return false;
    }
    const operationRecord: Record<string, unknown> = operation;
    // Structural/group changes were validated once against the complete
    // post-operation document above. A grouped paste inserts members before
    // its group node, so validating each insert as a singleton would falsely
    // reject a final graph that is valid.
    if (isRecord(operationRecord.node)) {
      return false;
    }
    if (!isRecord(operationRecord.newProperties)) {
      return false;
    }
    const path = Array.isArray(operationRecord.path) ? operationRecord.path : [];
    const topLevelIndex = path[0];
    const changedElement =
      typeof topLevelIndex === 'number' ? nextBoard.children[topLevelIndex] : undefined;
    return hasUnsupportedPersistedFreehandPatch(operationRecord.newProperties, changedElement);
  });
}

function hasUnsupportedPersistedFreehandPatch(
  patch: Record<string, unknown>,
  changedElement: unknown
): boolean {
  const finalElement = isRecord(changedElement)
    ? changedElement
    : patch.type !== undefined
      ? patch
      : undefined;
  if (finalElement && finalElement.type !== 'freehand') {
    return hasUnsupportedPersistedElementPatch(patch, finalElement);
  }
  if (finalElement?.type === 'freehand') {
    for (const [key, value] of Object.entries(patch)) {
      if (!PERSISTABLE_FREEHAND_FIELDS.has(key)) {
        return true;
      }
      if (key === 'points') {
        if (!Array.isArray(value) || value.length === 0) {
          return true;
        }
        if (
          Object.prototype.hasOwnProperty.call(finalElement, 'ink') &&
          (!Array.isArray(finalElement.points) ||
            !isAlignedKnownFreehandInk(finalElement.ink, finalElement.points.length))
        ) {
          return true;
        }
        continue;
      }
      if (!isPersistableFreehandField(key, value, finalElement)) {
        return true;
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'ink')) {
    if (
      !finalElement ||
      finalElement.type !== 'freehand' ||
      !Array.isArray(finalElement.points) ||
      !isValidFreehandInkData(patch.ink, finalElement.points.length)
    ) {
      return true;
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, 'type') &&
    finalElement &&
    Object.prototype.hasOwnProperty.call(finalElement, 'ink') &&
    (finalElement.type !== 'freehand' ||
      !Array.isArray(finalElement.points) ||
      !isAlignedKnownFreehandInk(finalElement.ink, finalElement.points.length))
  ) {
    return true;
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, 'points') &&
    finalElement?.type === 'freehand' &&
    Object.prototype.hasOwnProperty.call(finalElement, 'ink') &&
    (!Array.isArray(finalElement.points) ||
      !isAlignedKnownFreehandInk(finalElement.ink, finalElement.points.length))
  ) {
    return true;
  }
  return false;
}

function hasUnsupportedPersistedElementPatch(
  patch: Record<string, unknown>,
  finalElement: Record<string, unknown>
): boolean {
  const allowed = getPersistableElementFields(finalElement.type);
  if (!allowed || Object.keys(patch).some((key) => !allowed.has(key))) {
    return true;
  }
  return Object.entries(patch).some(([key, value]) => {
    switch (key) {
      case 'points':
        return !Array.isArray(value) || value.length === 0 || !value.every(isPoint);
      case 'text':
        return value !== undefined && !isPersistableSlateElement(value);
      case 'texts':
        return !isPersistableDrawTextArray(value);
      case 'rows':
        return !isPersistableTableAxes(value, 'height');
      case 'columns':
        return !isPersistableTableAxes(value, 'width');
      case 'cells':
        return !isPersistableTableCells(value);
      case 'source':
      case 'target':
        return !isPersistableArrowHandle(value);
      case 'data':
        return !isPersistableMindData(value);
      case 'children':
        return (
          !Array.isArray(value) ||
          !value.every((child) => isRecord(child) && isPersistableMindElement(child, false))
        );
      case 'id':
      case 'type':
      case 'shape':
      case 'url':
      case 'groupId':
      case 'branchShape':
        return typeof value !== 'string' || value.trim().length === 0;
      case 'layout':
        return value !== null && (typeof value !== 'string' || value.trim().length === 0);
      case 'fill':
      case 'strokeColor':
      case 'branchColor':
        return value !== undefined && value !== null && typeof value !== 'string';
      case 'strokeWidth':
      case 'branchWidth':
      case 'manualWidth':
        return (
          value !== undefined &&
          (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
        );
      case 'angle':
      case 'start':
      case 'end':
      case 'rightNodeCount':
        return value !== undefined && (typeof value !== 'number' || !Number.isFinite(value));
      case 'opacity':
        return (
          value !== undefined &&
          (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
        );
      case 'strokeStyle':
        return (
          value !== undefined &&
          (typeof value !== 'string' || !PERSISTABLE_FREEHAND_STROKE_STYLES.has(value))
        );
      case 'fillStyle':
        return (
          value !== undefined &&
          (typeof value !== 'string' || !PERSISTABLE_FREEHAND_FILL_STYLES.has(value))
        );
      case 'autoSize':
      case 'header':
      case 'isCollapsed':
        return value !== undefined && typeof value !== 'boolean';
      default:
        return false;
    }
  });
}

function getPersistableElementFields(type: unknown): ReadonlySet<string> | undefined {
  switch (type) {
    case 'geometry':
      return PERSISTABLE_GEOMETRY_FIELDS;
    case 'arrow-line':
    case 'line':
      return PERSISTABLE_ARROW_LINE_FIELDS;
    case 'vector-line':
      return PERSISTABLE_VECTOR_LINE_FIELDS;
    case 'image':
      return PERSISTABLE_IMAGE_FIELDS;
    case 'table':
    case 'swimlane':
      return PERSISTABLE_TABLE_FIELDS;
    case 'group':
      return PERSISTABLE_GROUP_FIELDS;
    case 'mind':
    case 'mindmap':
    case 'mind_child':
      return PERSISTABLE_MIND_FIELDS;
    case 'freehand':
      return PERSISTABLE_FREEHAND_FIELDS;
    default:
      return undefined;
  }
}

function isAlignedKnownFreehandInk(value: unknown, expectedPointCount: number): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.includes('version') &&
    keys.includes('widths') &&
    value.version === 1 &&
    Array.isArray(value.widths) &&
    value.widths.length === expectedPointCount
  );
}

function hasForbiddenPersistedElementPatch(
  value: Record<string, unknown>,
  strictInkContext: boolean
): boolean {
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'points') {
      continue;
    }
    if (
      (isForbiddenPersistedInputKey(key) &&
        (strictInkContext || !isAllowedLayoutDimensionKey(key))) ||
      hasForbiddenPersistedInputValue(entry, strictInkContext || key === 'ink')
    ) {
      return true;
    }
  }
  return false;
}

function schedulePersistItem(
  session: AppSession,
  slot: StorageSlot,
  store: MagicStores[keyof MagicStores],
  key: string,
  value: unknown,
  delay: number
): void {
  if (session.persistenceLocks.has(slot)) {
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
    persistItem(session, slot, store, key, value);
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
      `检测到 ${count} 项本地恢复、保存或数据最小化问题；受影响项的自动保存已暂停，本次更改可能未保存，请勿依赖自动保存。`,
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
      `${count} local recovery, save, or data-minimization issue(s) detected. Autosave is paused for affected items; recent changes may be unsaved, so do not rely on autosave.`,
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
