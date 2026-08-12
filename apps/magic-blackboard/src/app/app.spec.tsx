import { StrictMode } from 'react';
import { getFreehandInkOutline, MAX_FREEHAND_INK_SAMPLES } from '@drawnix/drawnix';
import { PlaitCanvasAdapter } from '@magic-blackboard/plait';
import { createMagicRuntime, type MagicRuntime } from '@magic-blackboard/runtime';
import { MAX_ZOOM, MIN_ZOOM, ThemeColorMode } from '@plait/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, {
  getBoardPersistenceWarning,
  isSafeStoredBoardValue,
  MagicAppBoundary,
  MagicBlackboardSession,
} from './app';
import { STORAGE_NAMESPACES } from './storage';

const localForageState = new Map<string, Map<string, unknown>>();
const rejectedReads = new Set<string>();
const rejectedWrites = new Set<string>();
const setItemCalls: Array<{ name: string; key: string; value: unknown }> = [];
let latestDrawnixValue: unknown[] = [];

vi.mock('localforage', () => ({
  default: {
    INDEXEDDB: 'indexeddb',
    LOCALSTORAGE: 'localstorage',
    createInstance: ({ name }: { name: string }) => {
      const values = localForageState.get(name) ?? new Map<string, unknown>();
      localForageState.set(name, values);
      return {
        getItem: vi.fn(async (key: string) => {
          if (rejectedReads.has(`${name}:${key}`)) {
            throw new Error('synthetic storage rejection');
          }
          return values.get(key) ?? null;
        }),
        setItem: vi.fn(async (key: string, value: unknown) => {
          setItemCalls.push({ name, key, value });
          if (rejectedWrites.has(`${name}:${key}`)) {
            throw new Error('synthetic storage write rejection');
          }
          values.set(key, value);
          return value;
        }),
        removeItem: vi.fn(async (key: string) => values.delete(key)),
        clear: vi.fn(async () => values.clear()),
      };
    },
  },
}));

vi.mock('@drawnix/drawnix', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@drawnix/drawnix')>()),
  Drawnix: ({
    afterInit,
    renderOverlay,
    additionalPlugins,
    initialLanguage,
    initialToolState,
    value,
    onChange,
    onToolStateChange,
  }: {
    afterInit: (board: unknown) => void;
    renderOverlay: (board: unknown) => unknown;
    additionalPlugins: readonly ((board: unknown) => unknown)[];
    initialLanguage: string;
    initialToolState?: Record<string, unknown>;
    value: unknown[];
    onChange: (change: {
      children: unknown[];
      operations: unknown[];
      viewport: { zoom: number };
      theme: { themeColorMode: string };
      source?: 'document-replace';
    }) => void;
    onToolStateChange: (state: { pointer: string }) => void;
  }) => {
    latestDrawnixValue = value;
    const pluginOptions = new Map<string, unknown>();
    const board = {
      children: value,
      selection: null,
      viewport: { zoom: 1 },
      theme: { themeColorMode: 'default' },
      operations: [],
      onChange: vi.fn(),
      getPluginOptions: (key: string) => pluginOptions.get(key),
      setPluginOptions: (key: string, options: unknown) => pluginOptions.set(key, options),
    };
    for (const plugin of additionalPlugins) {
      plugin(board);
    }
    afterInit(board);
    return (
      <div
        data-testid="drawnix"
        data-language={initialLanguage}
        data-child-count={value.length}
        data-board-value={JSON.stringify(value)}
        data-tool-state={JSON.stringify(initialToolState)}
      >
        {renderOverlay(board) as never}
        <button
          type="button"
          data-testid="emit-board-change"
          onClick={() =>
            onChange({
              operations: [
                {
                  type: 'set_node',
                  path: [0],
                  properties: {},
                  newProperties: {},
                },
              ],
              children: [
                {
                  id: 'synthetic',
                  type: 'geometry',
                  shape: 'rectangle',
                  points: [
                    [0, 0],
                    [100, 100],
                  ],
                  text: { type: 'paragraph', children: [{ text: '' }] },
                },
              ],
              viewport: { zoom: 1 },
              theme: { themeColorMode: 'default' },
            })
          }
        />
        <button
          type="button"
          data-testid="emit-latest-board-change"
          onClick={() =>
            onChange({
              operations: [],
              children: [
                {
                  id: 'synthetic-latest',
                  type: 'geometry',
                  shape: 'rectangle',
                  points: [
                    [10, 10],
                    [120, 120],
                  ],
                  text: { type: 'paragraph', children: [{ text: 'latest' }] },
                },
              ],
              viewport: { zoom: 2 },
              theme: { themeColorMode: 'dark' },
            })
          }
        />
        <button
          type="button"
          data-testid="emit-document-mutation"
          onClick={() => {
            const node = {
              id: 'synthetic-mutation',
              type: 'freehand',
              shape: 'feltTipPen',
              points: [
                [0, 0],
                [10, 10],
              ],
            };
            onChange({
              operations: [{ type: 'insert_node', path: [0], node }],
              children: [node],
              viewport: { zoom: 1 },
              theme: { themeColorMode: 'default' },
            });
          }}
        />
        <button
          type="button"
          data-testid="emit-crafted-freehand-insert"
          onClick={() => {
            const node = {
              id: 'crafted-clipboard-freehand',
              type: 'freehand',
              shape: 'feltTipPen',
              points: [
                [0, 0],
                [10, 10],
              ],
              strokeColor: '#123456',
              strokeWidth: 4,
              forceReadings: [0.2, 0.8],
              sensorReadings: [
                { force: 0.2, t: 1 },
                { force: 0.8, t: 2 },
              ],
            };
            onChange({
              operations: [{ type: 'insert_node', path: [0], node }],
              children: [node],
              viewport: { zoom: 1 },
              theme: { themeColorMode: 'default' },
            });
          }}
        />
        <button
          type="button"
          data-testid="emit-document-replacement"
          onClick={() => {
            const node = {
              id: 'imported-pressure-ink',
              type: 'freehand',
              shape: 'feltTipPen',
              points: [
                [0, 0],
                [20, 10],
              ],
              strokeWidth: 4,
              ink: { version: 1, widths: [2, 6] },
            };
            onChange({
              source: 'document-replace',
              operations: [],
              children: [node],
              viewport: { zoom: 1.5 },
              theme: { themeColorMode: 'dark' },
            });
          }}
        />
        <button
          type="button"
          data-testid="emit-private-document-replacement"
          onClick={() => {
            const node = {
              id: 'imported-private-ink',
              type: 'freehand',
              shape: 'feltTipPen',
              points: [
                [0, 0],
                [20, 10],
              ],
              ink: {
                version: 2,
                widths: [2, 6],
                rawSamples: [{ rawPressure: 0.8, timestamp: 42 }],
                deviceId: 'synthetic-device',
                event: { type: 'pointermove' },
                diagnostics: { receivedSamples: 1 },
              },
            };
            onChange({
              source: 'document-replace',
              operations: [],
              children: [node],
              viewport: { zoom: 1.5 },
              theme: { themeColorMode: 'dark' },
            });
          }}
        />
        <button
          type="button"
          data-testid="emit-private-metadata-replacement"
          onClick={() => {
            const node = {
              id: 'imported-safe-geometry',
              type: 'geometry',
              shape: 'rectangle',
              points: [
                [0, 0],
                [20, 10],
              ],
              text: { type: 'paragraph', children: [{ text: '' }] },
            };
            onChange({
              source: 'document-replace',
              operations: [],
              children: [node],
              viewport: {
                zoom: 1.5,
                eventHistory: [[10, 20, 0.8, 42]],
              } as never,
              theme: {
                themeColorMode: 'default',
                inputHistory: [[10, 20, 0.8, 42]],
              } as never,
            });
          }}
        />
        <button
          type="button"
          data-testid="emit-set-node"
          onClick={() => {
            const node = {
              id: 'synthetic-set-node',
              type: 'geometry',
              shape: 'rectangle',
              points: [
                [20, 20],
                [140, 140],
              ],
              text: { type: 'paragraph', children: [{ text: 'moved' }] },
            };
            onChange({
              operations: [
                {
                  type: 'set_node',
                  path: [0],
                  properties: {},
                  newProperties: node,
                },
              ],
              children: [node],
              viewport: { zoom: 1 },
              theme: { themeColorMode: 'default' },
            });
          }}
        />
        <button
          type="button"
          data-testid="emit-mind-theme-reset"
          onClick={() => {
            const child = {
              id: 'mind-child',
              type: 'mind_child',
              data: {
                topic: { type: 'paragraph', children: [{ text: 'Child' }] },
              },
              children: [],
              layout: null,
            };
            const node = {
              id: 'mind',
              type: 'mind',
              points: [[300, 100]],
              data: {
                topic: { type: 'paragraph', children: [{ text: 'Root' }] },
              },
              children: [child],
              fill: null,
              strokeColor: null,
              branchColor: null,
            };
            onChange({
              operations: [
                {
                  type: 'set_node',
                  path: [0],
                  properties: {},
                  newProperties: {
                    fill: null,
                    strokeColor: null,
                    branchColor: null,
                  },
                },
                {
                  type: 'set_node',
                  path: [0, 0],
                  properties: {},
                  newProperties: { layout: null },
                },
              ],
              children: [node],
              viewport: { zoom: 1 },
              theme: { themeColorMode: 'default' },
            });
          }}
        />
        <button
          type="button"
          data-testid="emit-table-stroke-change"
          onClick={() => {
            const node = {
              id: 'table',
              type: 'table',
              points: [
                [0, 0],
                [100, 100],
              ],
              rows: [{ id: 'table-row', height: 40 }],
              columns: [{ id: 'table-column', width: 80 }],
              cells: [
                {
                  id: 'table-cell',
                  rowId: 'table-row',
                  columnId: 'table-column',
                },
              ],
              strokeColor: '#123456',
              strokeStyle: 'dashed',
            };
            onChange({
              operations: [
                {
                  type: 'set_node',
                  path: [0],
                  properties: {},
                  newProperties: {
                    strokeColor: '#123456',
                    strokeStyle: 'dashed',
                  },
                },
              ],
              children: [node],
              viewport: { zoom: 1 },
              theme: { themeColorMode: 'default' },
            });
          }}
        />
        <button
          type="button"
          data-testid="emit-numeric-font-size-change"
          onClick={() => {
            const node = {
              id: 'font-sized-geometry',
              type: 'geometry',
              shape: 'rectangle',
              points: [
                [0, 0],
                [100, 100],
              ],
              text: {
                type: 'paragraph',
                children: [{ text: 'Sized text', 'font-size': 18 }],
              },
            };
            onChange({
              operations: [
                {
                  type: 'set_node',
                  path: [0],
                  properties: {},
                  newProperties: { text: node.text },
                },
              ],
              children: [node],
              viewport: { zoom: 1 },
              theme: { themeColorMode: 'default' },
            });
          }}
        />
        <button
          type="button"
          data-testid="emit-grouped-document-change"
          onClick={() => {
            const member = {
              id: 'grouped-shape',
              type: 'geometry',
              shape: 'rectangle',
              groupId: 'created-group',
              points: [
                [0, 0],
                [100, 100],
              ],
              text: { type: 'paragraph', children: [{ text: '' }] },
            };
            const group = { id: 'created-group', type: 'group' };
            onChange({
              operations: [
                {
                  type: 'set_node',
                  path: [0],
                  properties: {},
                  newProperties: { groupId: 'created-group' },
                },
                { type: 'insert_node', path: [1], node: group },
              ],
              children: [member, group],
              viewport: { zoom: 1 },
              theme: { themeColorMode: 'default' },
            });
          }}
        />
        <button
          type="button"
          data-testid="emit-rotatable-elements-change"
          onClick={() => {
            const tableData = {
              rows: [{ id: 'row', height: 40 }],
              columns: [{ id: 'column', width: 80 }],
              cells: [{ id: 'cell', rowId: 'row', columnId: 'column' }],
            };
            const children = [
              {
                id: 'rotated-vector',
                type: 'vector-line',
                shape: 'curve',
                points: [
                  [0, 0],
                  [30, 40],
                ],
                angle: 15,
              },
              {
                id: 'rotated-table',
                type: 'table',
                points: [
                  [100, 0],
                  [200, 100],
                ],
                angle: 30,
                ...tableData,
              },
              {
                id: 'rotated-swimlane',
                type: 'swimlane',
                shape: 'swimlaneVertical',
                points: [
                  [220, 0],
                  [420, 200],
                ],
                angle: 45,
                ...tableData,
              },
            ];
            onChange({
              operations: children.map((node, index) => ({
                type: 'set_node',
                path: [index],
                properties: {},
                newProperties: { points: node.points, angle: node.angle },
              })),
              children,
              viewport: { zoom: 1 },
              theme: { themeColorMode: 'default' },
            });
          }}
        />
        <button
          type="button"
          data-testid="emit-selection-change"
          onClick={() =>
            onChange({
              operations: [
                {
                  type: 'set_selection',
                  properties: null,
                  newProperties: null,
                },
              ],
              children: value,
              viewport: { zoom: 1 },
              theme: { themeColorMode: 'default' },
            })
          }
        />
        <button
          type="button"
          data-testid="emit-restored-board-change"
          onClick={() =>
            onChange({
              operations: [
                {
                  type: 'set_node',
                  path: [0],
                  properties: {},
                  newProperties: {},
                },
              ],
              children: value,
              viewport: { zoom: 1 },
              theme: { themeColorMode: 'default' },
            })
          }
        />
        <button
          type="button"
          data-testid="emit-tool-change"
          onClick={() => onToolStateChange({ pointer: 'selection' })}
        />
      </div>
    );
  },
}));

describe('Magic Blackboard App', () => {
  it('budgets the exact full board envelope before persistence', () => {
    const sharedPoint: [number, number] = [0, 0];
    const pointCounts = [100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 66_653];
    const children = pointCounts.map((count, index) => ({
      id: `legacy-budget-${index}`,
      type: 'freehand' as const,
      shape: 'feltTipPen' as const,
      points: Array(count).fill(sharedPoint),
    }));
    const childrenOnlyEnvelope = { schemaVersion: 1 as const, children };
    const fullBoard = {
      ...childrenOnlyEnvelope,
      viewport: { zoom: 1 },
      theme: { themeColorMode: ThemeColorMode.default },
    };

    expect(isSafeStoredBoardValue(childrenOnlyEnvelope)).toBe(true);
    expect(isSafeStoredBoardValue(fullBoard)).toBe(false);
    expect(getBoardPersistenceWarning(fullBoard)).toBeTruthy();
  });

  beforeEach(() => {
    localForageState.clear();
    rejectedReads.clear();
    rejectedWrites.clear();
    setItemCalls.length = 0;
    latestDrawnixValue = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('mounts the board and persists explicit user context', async () => {
    render(<App />);

    expect(await screen.findByTestId('drawnix')).toBeTruthy();
    expect(screen.getByText('Magic Blackboard')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Session mode'), {
      target: { value: 'teaching' },
    });
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'physics' },
    });

    await waitFor(() => {
      const preferences = localForageState.get(STORAGE_NAMESPACES.preferences)?.get('current') as {
        context?: { sessionMode?: string; subject?: string };
      };
      expect(preferences.context).toEqual({
        sessionMode: 'teaching',
        subject: 'physics',
      });
    });
  });

  it('disposes a partially created adapter when runtime construction fails', async () => {
    const adapter = {
      dispose: vi.fn(),
      asPlugin: vi.fn(() => (board: unknown) => board),
    };

    render(
      <MagicAppBoundary>
        <MagicBlackboardSession
          dependencies={{
            createAdapter: () => adapter as never,
            createRuntime: () => {
              throw new Error('synthetic runtime construction failure');
            },
          }}
        />
      </MagicAppBoundary>
    );

    expect((await screen.findByRole('alert')).textContent).toContain('暂时无法启动');
    expect(adapter.dispose).toHaveBeenCalledOnce();
    expect(setItemCalls).toEqual([]);
  });

  it('disposes the runtime when board attachment fails and shows a safe fallback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtime = {
      id: 'synthetic-runtime',
      boardId: 'main',
      disposed: false,
      features: { registerMany: vi.fn(async () => []), subscribe: vi.fn() },
      events: { subscribeAll: vi.fn(), getHistory: vi.fn(() => []) },
      canvas: null,
      attachCanvas: vi.fn(),
      dispose: vi.fn(function (this: { disposed: boolean }) {
        this.disposed = true;
      }),
    };
    const adapter = {
      asPlugin: vi.fn(() => (board: unknown) => board),
      attach: vi.fn(() => {
        throw new Error('synthetic board attachment failure');
      }),
      dispose: vi.fn(),
    };

    render(
      <MagicAppBoundary>
        <MagicBlackboardSession
          dependencies={{
            createAdapter: () => adapter as never,
            createRuntime: () => runtime as never,
          }}
        />
      </MagicAppBoundary>
    );

    expect((await screen.findByRole('alert')).textContent).toContain('暂时无法启动');
    // React may replay a render that throws before handing control to the boundary.
    expect(adapter.attach).toHaveBeenCalled();
    expect(runtime.dispose).toHaveBeenCalled();
    expect(setItemCalls).toEqual([]);
  });

  it('disposes the session when a board plugin fails before afterInit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtime = {
      id: 'synthetic-runtime',
      boardId: 'main',
      disposed: false,
      features: { registerMany: vi.fn(async () => []), subscribe: vi.fn() },
      events: { subscribeAll: vi.fn(), getHistory: vi.fn(() => []) },
      canvas: null,
      attachCanvas: vi.fn(),
      dispose: vi.fn(function (this: { disposed: boolean }) {
        this.disposed = true;
      }),
    };
    const adapter = {
      asPlugin: vi.fn(() => () => {
        throw new Error('synthetic board plugin failure');
      }),
      attach: vi.fn(),
      dispose: vi.fn(),
    };

    render(
      <MagicAppBoundary>
        <MagicBlackboardSession
          dependencies={{
            createAdapter: () => adapter as never,
            createRuntime: () => runtime as never,
          }}
        />
      </MagicAppBoundary>
    );

    expect((await screen.findByRole('alert')).textContent).toContain('暂时无法启动');
    expect(adapter.attach).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(runtime.dispose).toHaveBeenCalled();
      expect(adapter.dispose).toHaveBeenCalled();
    });
    expect(setItemCalls).toEqual([]);
  });

  it('continues partial-session cleanup when ink input disposal throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let runtime: MagicRuntime<PlaitCanvasAdapter> | undefined;
    let adapter: PlaitCanvasAdapter | undefined;
    const inkDispose = vi.fn(() => {
      throw new Error('synthetic ink cleanup failure');
    });

    render(
      <MagicAppBoundary>
        <MagicBlackboardSession
          dependencies={{
            createAdapter: () => {
              adapter = new PlaitCanvasAdapter();
              return adapter;
            },
            createRuntime: (settings) => {
              runtime = createMagicRuntime<PlaitCanvasAdapter>({
                boardId: 'partial-cleanup-test',
                settings,
                ownsSettings: false,
              });
              return runtime;
            },
            createInkController: () =>
              ({
                asPlugin: () => {
                  throw new Error('synthetic ink plugin failure');
                },
                dispose: inkDispose,
              }) as never,
          }}
        />
      </MagicAppBoundary>
    );

    expect((await screen.findByRole('alert')).textContent).toContain('暂时无法启动');
    expect(inkDispose).toHaveBeenCalledOnce();
    expect(runtime?.disposed).toBe(true);
    expect(adapter?.disposed).toBe(true);
    expect(setItemCalls).toEqual([]);
  });

  it('continues effect cleanup when ink input disposal throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let runtime: MagicRuntime<PlaitCanvasAdapter> | undefined;
    let adapter: PlaitCanvasAdapter | undefined;
    const inkDispose = vi.fn(() => {
      throw new Error('synthetic ink cleanup failure');
    });
    const view = render(
      <MagicBlackboardSession
        dependencies={{
          createAdapter: () => {
            adapter = new PlaitCanvasAdapter();
            return adapter;
          },
          createRuntime: (settings) => {
            runtime = createMagicRuntime<PlaitCanvasAdapter>({
              boardId: 'effect-cleanup-test',
              settings,
              ownsSettings: false,
            });
            return runtime;
          },
          createInkController: () =>
            ({
              asPlugin: () => (board: unknown) => board,
              dispose: inkDispose,
            }) as never,
        }}
      />
    );

    expect(await screen.findByTestId('drawnix')).toBeTruthy();
    view.unmount();

    expect(inkDispose).toHaveBeenCalledOnce();
    expect(runtime?.disposed).toBe(true);
    expect(adapter?.disposed).toBe(true);
  });

  it('restores the stored language and context before mounting Drawnix', async () => {
    localForageState.set(
      STORAGE_NAMESPACES.preferences,
      new Map([
        [
          'current',
          {
            language: 'en',
            context: { sessionMode: 'learning', subject: 'math' },
          },
        ],
      ])
    );

    render(<App />);

    expect((await screen.findByTestId('drawnix')).getAttribute('data-language')).toBe('en');
    expect(screen.getByDisplayValue('Learning')).toBeTruthy();
    expect(screen.getByDisplayValue('Math')).toBeTruthy();
    expect(screen.getByText(/Context · Learning \/ Math/)).toBeTruthy();
  });

  it('mounts with safe defaults when one namespace rejects without overwriting it', async () => {
    const storedPreferences = {
      language: 'en',
      context: { sessionMode: 'teaching', subject: 'physics' },
    };
    localForageState.set(STORAGE_NAMESPACES.preferences, new Map([['current', storedPreferences]]));
    rejectedReads.add(`${STORAGE_NAMESPACES.preferences}:current`);

    render(<App />);

    expect((await screen.findByTestId('drawnix')).getAttribute('data-language')).toBe('zh');
    expect(screen.getByRole('status').textContent).toContain('自动保存已暂停');
    expect(localForageState.get(STORAGE_NAMESPACES.preferences)?.get('current')).toBe(
      storedPreferences
    );

    fireEvent.change(screen.getByLabelText('Session mode'), {
      target: { value: 'learning' },
    });
    expect(
      setItemCalls.some(
        ({ name, key }) => name === STORAGE_NAMESPACES.preferences && key === 'current'
      )
    ).toBe(false);
    expect(localForageState.get(STORAGE_NAMESPACES.preferences)?.get('current')).toBe(
      storedPreferences
    );
  });

  it('does not replace a malformed board value during recovery', async () => {
    const malformedBoard = { children: 'not-an-element-array' };
    localForageState.set(STORAGE_NAMESPACES.board, new Map([['document', malformedBoard]]));

    render(<App />);

    expect(await screen.findByTestId('drawnix')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('1 项');
    fireEvent.click(screen.getByTestId('emit-board-change'));
    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toBe(malformedBoard);
    expect(
      setItemCalls.some(({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document')
    ).toBe(false);
  });

  it('lets an explicit safe document replacement unlock and replace a recovered board value', async () => {
    const malformedBoard = { children: 'not-an-element-array' };
    localForageState.set(STORAGE_NAMESPACES.board, new Map([['document', malformedBoard]]));

    render(<App />);

    expect(await screen.findByTestId('drawnix')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();

    fireEvent.click(screen.getByTestId('emit-document-replacement'));

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toMatchObject({
      schemaVersion: 1,
      children: [{ id: 'imported-pressure-ink', ink: { version: 1, widths: [2, 6] } }],
    });
    expect(
      setItemCalls.filter(
        ({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document'
      )
    ).toHaveLength(1);
  });

  it.each([
    ['a record-shaped corrupt child', { schemaVersion: 1, children: [{}] }],
    [
      'a recursively corrupt child',
      {
        schemaVersion: 1,
        children: [
          {
            id: 'parent',
            type: 'mind',
            points: [[0, 0]],
            data: {
              topic: { type: 'paragraph', children: [{ text: 'Root' }] },
            },
            children: [{}],
          },
        ],
      },
    ],
    [
      'an unknown top-level element type',
      { schemaVersion: 1, children: [{ id: 'unknown', type: 'garbage' }] },
    ],
    [
      'a known geometry missing its required shape and points',
      {
        schemaVersion: 1,
        children: [
          {
            id: 'broken-geometry',
            type: 'geometry',
            text: { type: 'paragraph', children: [{ text: 'unsafe' }] },
          },
        ],
      },
    ],
    [
      'a self-referencing group',
      {
        schemaVersion: 1,
        children: [
          {
            id: 'self-grouped-shape',
            type: 'geometry',
            shape: 'rectangle',
            groupId: 'self-grouped-shape',
            points: [
              [0, 0],
              [100, 100],
            ],
            text: { type: 'paragraph', children: [{ text: '' }] },
          },
        ],
      },
    ],
    [
      'a cyclic group graph',
      {
        schemaVersion: 1,
        children: [
          { id: 'group-a', type: 'group', groupId: 'group-b' },
          { id: 'group-b', type: 'group', groupId: 'group-a' },
        ],
      },
    ],
    [
      'a non-finite element value',
      {
        schemaVersion: 1,
        children: [
          {
            id: 'shape',
            type: 'geometry',
            shape: 'rectangle',
            points: [
              [0, Number.POSITIVE_INFINITY],
              [100, 100],
            ],
            text: { type: 'paragraph', children: [{ text: '' }] },
          },
        ],
      },
    ],
    ['an unsupported document version', { schemaVersion: 2, children: [] }],
  ])('rejects %s and keeps board autosave locked', async (_caseName, malformedBoard) => {
    localForageState.set(STORAGE_NAMESPACES.board, new Map([['document', malformedBoard]]));

    render(<App />);

    expect(await screen.findByTestId('drawnix')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('1 项');
    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId('emit-board-change'));
    vi.runAllTimers();

    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toBe(malformedBoard);
    expect(
      setItemCalls.some(({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document')
    ).toBe(false);
  });

  it.each([
    ['below Plait minimum zoom', MIN_ZOOM / 2],
    ['above Plait maximum zoom', MAX_ZOOM + 0.1],
  ])('rejects a stored viewport %s and locks board autosave', async (_caseName, zoom) => {
    const storedBoard = {
      schemaVersion: 1,
      children: [
        {
          id: 'stored-shape',
          type: 'geometry',
          shape: 'rectangle',
          points: [
            [0, 0],
            [100, 100],
          ],
          text: { type: 'paragraph', children: [{ text: '' }] },
        },
      ],
      viewport: { zoom },
    };
    localForageState.set(STORAGE_NAMESPACES.board, new Map([['document', storedBoard]]));

    render(<App />);

    expect((await screen.findByTestId('drawnix')).getAttribute('data-child-count')).toBe('0');
    expect(screen.getByRole('status').textContent).toContain('自动保存已暂停');
    fireEvent.click(screen.getByTestId('emit-document-mutation'));

    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toBe(storedBoard);
    expect(
      setItemCalls.some(({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document')
    ).toBe(false);
  });

  it.each([MIN_ZOOM, MAX_ZOOM])('restores the inclusive Plait zoom boundary %s', async (zoom) => {
    const storedBoard = {
      schemaVersion: 1,
      children: [],
      viewport: { zoom },
    };
    localForageState.set(STORAGE_NAMESPACES.board, new Map([['document', storedBoard]]));

    render(<App />);

    expect(await screen.findByTestId('drawnix')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toBe(storedBoard);
  });

  it('flushes the latest debounced board and console values before unmount', async () => {
    const view = render(<App />);
    expect(await screen.findByTestId('drawnix')).toBeTruthy();
    vi.useFakeTimers();

    fireEvent.click(screen.getByTestId('emit-board-change'));
    fireEvent.click(screen.getByTestId('emit-latest-board-change'));
    fireEvent.keyDown(window, { key: 'd', metaKey: true, shiftKey: true });

    expect(
      setItemCalls.some(
        ({ name, key }) =>
          (name === STORAGE_NAMESPACES.board && key === 'document') ||
          (name === STORAGE_NAMESPACES.console && key === 'layout')
      )
    ).toBe(false);

    view.unmount();

    const boardWrite = setItemCalls.find(
      ({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document'
    );
    expect(boardWrite?.value).toMatchObject({
      schemaVersion: 1,
      children: [{ id: 'synthetic-latest', type: 'geometry' }],
      viewport: { zoom: 2 },
      theme: { themeColorMode: 'dark' },
    });
    const consoleWrite = setItemCalls.find(
      ({ name, key }) => name === STORAGE_NAMESPACES.console && key === 'layout'
    );
    expect(consoleWrite?.value).toMatchObject({ open: true });
  });

  it('persists document mutations immediately and cancels an older pending board write', async () => {
    render(<App />);
    expect(await screen.findByTestId('drawnix')).toBeTruthy();
    vi.useFakeTimers();

    fireEvent.click(screen.getByTestId('emit-board-change'));
    fireEvent.click(screen.getByTestId('emit-document-mutation'));

    const boardWrites = () =>
      setItemCalls.filter(
        ({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document'
      );
    expect(boardWrites()).toHaveLength(1);
    expect(boardWrites()[0]?.value).toMatchObject({
      children: [{ id: 'synthetic-mutation', type: 'freehand' }],
    });

    vi.runAllTimers();
    expect(boardWrites()).toHaveLength(1);
  });

  it('surfaces an async board write failure and keeps that storage slot fail-closed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    rejectedWrites.add(`${STORAGE_NAMESPACES.board}:document`);
    render(<App />);
    expect(await screen.findByTestId('drawnix')).toBeTruthy();

    fireEvent.click(screen.getByTestId('emit-document-mutation'));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('本次更改可能未保存');
    });
    const boardWrites = () =>
      setItemCalls.filter(
        ({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document'
      );
    expect(boardWrites()).toHaveLength(1);
    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toBeUndefined();

    rejectedWrites.delete(`${STORAGE_NAMESPACES.board}:document`);
    fireEvent.click(screen.getByTestId('emit-document-mutation'));
    fireEvent.click(screen.getByTestId('emit-document-replacement'));

    expect(boardWrites()).toHaveLength(1);
    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toBeUndefined();
    expect(screen.getByRole('status').textContent).toContain('自动保存已暂停');
  });

  it('keeps a crafted clipboard freehand in memory but does not persist unknown sensor fields', async () => {
    render(<App />);
    expect(await screen.findByTestId('drawnix')).toBeTruthy();

    fireEvent.click(screen.getByTestId('emit-crafted-freehand-insert'));

    await waitFor(() => {
      expect(screen.getByTestId('drawnix').getAttribute('data-child-count')).toBe('1');
      expect(screen.getByRole('status').textContent).toContain('自动保存已暂停');
    });
    expect((latestDrawnixValue[0] as Record<string, unknown>).forceReadings).toEqual([0.2, 0.8]);
    expect((latestDrawnixValue[0] as Record<string, unknown>).sensorReadings).toEqual([
      { force: 0.2, t: 1 },
      { force: 0.8, t: 2 },
    ]);
    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toBeUndefined();
    expect(
      setItemCalls.some(({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document')
    ).toBe(false);
  });

  it('persists an imported variable-ink document before a product rerender', async () => {
    render(<App />);
    const drawnix = await screen.findByTestId('drawnix');

    fireEvent.click(screen.getByTestId('emit-document-replacement'));
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'math' },
    });

    expect(drawnix.getAttribute('data-child-count')).toBe('1');
    const persisted = localForageState.get(STORAGE_NAMESPACES.board)?.get('document');
    expect(persisted).toMatchObject({
      schemaVersion: 1,
      children: [
        {
          id: 'imported-pressure-ink',
          ink: { version: 1, widths: [2, 6] },
        },
      ],
      viewport: { zoom: 1.5 },
      theme: { themeColorMode: 'dark' },
    });
    expect(
      setItemCalls.filter(
        ({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document'
      )
    ).toHaveLength(1);
  });

  it('keeps the latest document when product context causes a parent rerender', async () => {
    render(<App />);
    const drawnix = await screen.findByTestId('drawnix');
    expect(drawnix.getAttribute('data-child-count')).toBe('0');

    fireEvent.click(screen.getByTestId('emit-document-mutation'));
    await waitFor(() => expect(drawnix.getAttribute('data-child-count')).toBe('1'));
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'math' },
    });

    expect(drawnix.getAttribute('data-child-count')).toBe('1');
    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toMatchObject({
      children: [{ id: 'synthetic-mutation', type: 'freehand' }],
    });
  });

  it('debounces hot set_node changes and skips selection-only persistence', async () => {
    render(<App />);
    expect(await screen.findByTestId('drawnix')).toBeTruthy();
    vi.useFakeTimers();

    fireEvent.click(screen.getByTestId('emit-set-node'));
    fireEvent.click(screen.getByTestId('emit-set-node'));
    fireEvent.click(screen.getByTestId('emit-selection-change'));

    const boardWrites = () =>
      setItemCalls.filter(
        ({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document'
      );
    expect(boardWrites()).toHaveLength(0);
    vi.advanceTimersByTime(199);
    expect(boardWrites()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(boardWrites()).toHaveLength(1);
    expect(boardWrites()[0]?.value).toMatchObject({
      children: [{ id: 'synthetic-set-node', type: 'geometry' }],
    });
  });

  it('registers and removes page lifecycle persistence listeners symmetrically', async () => {
    const documentAdd = vi.spyOn(document, 'addEventListener');
    const documentRemove = vi.spyOn(document, 'removeEventListener');
    const windowAdd = vi.spyOn(window, 'addEventListener');
    const windowRemove = vi.spyOn(window, 'removeEventListener');

    const view = render(<App />);
    expect(await screen.findByTestId('drawnix')).toBeTruthy();

    const visibilityCalls = documentAdd.mock.calls.filter(([type]) => type === 'visibilitychange');
    const pageHideCalls = windowAdd.mock.calls.filter(([type]) => type === 'pagehide');
    const visibilityListener = visibilityCalls[visibilityCalls.length - 1]?.[1];
    const pageHideListener = pageHideCalls[pageHideCalls.length - 1]?.[1];
    expect(visibilityListener).toBeTypeOf('function');
    expect(pageHideListener).toBeTypeOf('function');

    view.unmount();

    expect(documentRemove).toHaveBeenCalledWith('visibilitychange', visibilityListener);
    expect(windowRemove).toHaveBeenCalledWith('pagehide', pageHideListener);
  });

  it.each([['visibilitychange'], ['pagehide']] as const)(
    'flushes the latest pending values once on %s',
    async (eventName) => {
      const view = render(<App />);
      expect(await screen.findByTestId('drawnix')).toBeTruthy();
      vi.useFakeTimers();

      fireEvent.click(screen.getByTestId('emit-board-change'));
      fireEvent.click(screen.getByTestId('emit-latest-board-change'));
      fireEvent.keyDown(window, { key: 'd', metaKey: true, shiftKey: true });

      if (eventName === 'visibilitychange') {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event(eventName));
        document.dispatchEvent(new Event(eventName));
      } else {
        window.dispatchEvent(new Event(eventName));
        window.dispatchEvent(new Event(eventName));
      }

      const writesFor = (name: string, key: string) =>
        setItemCalls.filter((call) => call.name === name && call.key === key);
      expect(writesFor(STORAGE_NAMESPACES.board, 'document')).toHaveLength(1);
      expect(writesFor(STORAGE_NAMESPACES.board, 'document')[0]?.value).toMatchObject({
        schemaVersion: 1,
        children: [{ id: 'synthetic-latest', type: 'geometry' }],
      });
      expect(writesFor(STORAGE_NAMESPACES.console, 'layout')).toHaveLength(1);

      vi.runAllTimers();
      view.unmount();

      expect(writesFor(STORAGE_NAMESPACES.board, 'document')).toHaveLength(1);
      expect(writesFor(STORAGE_NAMESPACES.console, 'layout')).toHaveLength(1);
    }
  );

  it('restores supported Drawnix elements while treating Slate text children separately', async () => {
    const paragraph = (text: string) => ({
      type: 'paragraph',
      children: [{ text }],
    });
    const storedBoard = {
      schemaVersion: 1,
      children: [
        {
          id: 'geometry',
          type: 'geometry',
          shape: 'rectangle',
          points: [
            [0, 0],
            [100, 100],
          ],
          text: paragraph('Shape'),
        },
        {
          id: 'text',
          type: 'geometry',
          shape: 'text',
          autoSize: true,
          points: [
            [120, 0],
            [220, 40],
          ],
          text: paragraph('Text'),
        },
        {
          id: 'freehand',
          type: 'freehand',
          shape: 'feltTipPen',
          points: [
            [0, 120],
            [30, 140],
          ],
        },
        {
          id: 'arrow',
          type: 'arrow-line',
          shape: 'straight',
          points: [
            [120, 120],
            [220, 120],
          ],
          source: { marker: 'none' },
          target: { marker: 'arrow' },
          texts: [{ text: paragraph('Link'), position: 0.5 }],
        },
        {
          id: 'vector',
          type: 'vector-line',
          shape: 'curve',
          points: [
            [0, 180],
            [30, 200],
          ],
        },
        {
          id: 'image',
          type: 'image',
          points: [
            [120, 180],
            [220, 280],
          ],
          url: 'data:image/png;base64,c3ludGhldGlj',
        },
        { id: 'group', type: 'group' },
        {
          id: 'mind',
          type: 'mind',
          points: [[300, 100]],
          data: { topic: paragraph('Root') },
          children: [
            {
              id: 'mind-child',
              type: 'mind_child',
              data: { topic: paragraph('Child') },
              children: [],
            },
          ],
        },
        {
          id: 'table',
          type: 'table',
          points: [
            [300, 180],
            [500, 300],
          ],
          rows: [{ id: 'table-row', height: 40 }],
          columns: [{ id: 'table-column', width: 80 }],
          cells: [
            {
              id: 'table-cell',
              rowId: 'table-row',
              columnId: 'table-column',
              text: paragraph('Cell'),
            },
          ],
        },
        {
          id: 'swimlane',
          type: 'swimlane',
          shape: 'swimlaneVertical',
          points: [
            [520, 180],
            [720, 400],
          ],
          rows: [{ id: 'lane-row' }],
          columns: [{ id: 'lane-column' }],
          cells: [{ id: 'lane-cell', rowId: 'lane-row', columnId: 'lane-column' }],
        },
      ],
    };
    localForageState.set(STORAGE_NAMESPACES.board, new Map([['document', storedBoard]]));

    render(<App />);

    expect((await screen.findByTestId('drawnix')).getAttribute('data-child-count')).toBe('10');
    expect(screen.queryByRole('status')).toBeNull();
    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toBe(storedBoard);
  });

  it('persists Plait mind theme reset nulls and remains writable after reload', async () => {
    const view = render(<App />);
    expect(await screen.findByTestId('drawnix')).toBeTruthy();
    vi.useFakeTimers();

    fireEvent.click(screen.getByTestId('emit-mind-theme-reset'));
    vi.advanceTimersByTime(200);

    expect(screen.queryByRole('status')).toBeNull();
    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toMatchObject({
      children: [
        {
          id: 'mind',
          fill: null,
          strokeColor: null,
          branchColor: null,
          children: [{ id: 'mind-child', layout: null }],
        },
      ],
    });

    view.unmount();
    vi.useRealTimers();
    render(<App />);
    expect((await screen.findByTestId('drawnix')).getAttribute('data-child-count')).toBe('1');
    expect(screen.queryByRole('status')).toBeNull();

    const writesBefore = setItemCalls.length;
    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId('emit-mind-theme-reset'));
    vi.advanceTimersByTime(200);
    expect(setItemCalls.length).toBeGreaterThan(writesBefore);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('persists table stroke controls and remains writable after reload', async () => {
    const view = render(<App />);
    expect(await screen.findByTestId('drawnix')).toBeTruthy();
    vi.useFakeTimers();

    fireEvent.click(screen.getByTestId('emit-table-stroke-change'));
    vi.advanceTimersByTime(200);

    expect(screen.queryByRole('status')).toBeNull();
    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toMatchObject({
      children: [
        {
          id: 'table',
          strokeColor: '#123456',
          strokeStyle: 'dashed',
        },
      ],
    });

    view.unmount();
    vi.useRealTimers();
    render(<App />);
    expect((await screen.findByTestId('drawnix')).getAttribute('data-child-count')).toBe('1');
    expect(screen.queryByRole('status')).toBeNull();

    const writesBefore = setItemCalls.length;
    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId('emit-table-stroke-change'));
    vi.advanceTimersByTime(200);
    expect(setItemCalls.length).toBeGreaterThan(writesBefore);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('persists the numeric font-size mark produced by the Drawnix text toolbar', async () => {
    const view = render(<App />);
    expect(await screen.findByTestId('drawnix')).toBeTruthy();
    vi.useFakeTimers();

    fireEvent.click(screen.getByTestId('emit-numeric-font-size-change'));
    vi.advanceTimersByTime(200);

    expect(screen.queryByRole('status')).toBeNull();
    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toMatchObject({
      children: [
        {
          id: 'font-sized-geometry',
          text: {
            children: [{ text: 'Sized text', 'font-size': 18 }],
          },
        },
      ],
    });

    view.unmount();
    vi.useRealTimers();
    render(<App />);
    expect((await screen.findByTestId('drawnix')).getAttribute('data-child-count')).toBe('1');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('persists a grouped operation batch and restores it without locking autosave', async () => {
    const view = render(<App />);
    expect(await screen.findByTestId('drawnix')).toBeTruthy();

    fireEvent.click(screen.getByTestId('emit-grouped-document-change'));

    expect(screen.queryByRole('status')).toBeNull();
    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toMatchObject({
      children: [
        { id: 'grouped-shape', groupId: 'created-group' },
        { id: 'created-group', type: 'group' },
      ],
    });

    view.unmount();
    render(<App />);
    expect((await screen.findByTestId('drawnix')).getAttribute('data-child-count')).toBe('2');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('persists Plait rotation output for vector lines, tables, and swimlanes', async () => {
    const view = render(<App />);
    expect(await screen.findByTestId('drawnix')).toBeTruthy();
    vi.useFakeTimers();

    fireEvent.click(screen.getByTestId('emit-rotatable-elements-change'));
    vi.advanceTimersByTime(200);

    expect(screen.queryByRole('status')).toBeNull();
    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toMatchObject({
      children: [
        { id: 'rotated-vector', angle: 15 },
        { id: 'rotated-table', angle: 30 },
        { id: 'rotated-swimlane', angle: 45 },
      ],
    });

    view.unmount();
    vi.useRealTimers();
    render(<App />);
    expect((await screen.findByTestId('drawnix')).getAttribute('data-child-count')).toBe('3');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('restores all supported freehand style and transform fields without locking autosave', async () => {
    const styledFreehand = {
      id: 'styled-variable-freehand',
      type: 'freehand',
      shape: 'feltTipPen',
      points: [
        [0, 0],
        [30, 20],
      ],
      groupId: 'synthetic-group',
      angle: 15,
      fill: 'none',
      fillStyle: 'solid',
      strokeColor: '#123456',
      strokeWidth: 4,
      strokeStyle: 'dashed',
      opacity: 0.5,
      ink: { version: 1, widths: [2, 6] },
    };
    const storedGroup = { id: 'synthetic-group', type: 'group' };
    const storedBoard = {
      schemaVersion: 1,
      children: [storedGroup, styledFreehand],
    };
    localForageState.set(STORAGE_NAMESPACES.board, new Map([['document', storedBoard]]));

    render(<App />);

    expect((await screen.findByTestId('drawnix')).getAttribute('data-child-count')).toBe('2');
    expect(screen.queryByRole('status')).toBeNull();

    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId('emit-restored-board-change'));
    vi.runAllTimers();

    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toMatchObject({
      children: [storedGroup, styledFreehand],
    });
    expect(
      setItemCalls.filter(
        ({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document'
      )
    ).toHaveLength(1);
  });

  it('restores and keeps autosave writable for thirteen maximum pressure strokes', async () => {
    const points = Array.from({ length: MAX_FREEHAND_INK_SAMPLES }, (_, index) => [
      index,
      index % 13,
    ]);
    const widths = Array.from({ length: MAX_FREEHAND_INK_SAMPLES }, (_, index) =>
      index % 2 === 0 ? 2 : 6
    );
    const children = Array.from({ length: 13 }, (_, index) => ({
      id: `stored-maximum-pressure-${index}`,
      type: 'freehand',
      shape: 'feltTipPen',
      points,
      strokeWidth: 4,
      ink: { version: 1, widths },
    }));
    const storedBoard = { schemaVersion: 1, children };
    localForageState.set(STORAGE_NAMESPACES.board, new Map([['document', storedBoard]]));

    render(<App />);

    expect((await screen.findByTestId('drawnix')).getAttribute('data-child-count')).toBe('13');
    expect(screen.queryByRole('status')).toBeNull();

    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId('emit-restored-board-change'));
    vi.runAllTimers();
    expect(
      setItemCalls.filter(
        ({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document'
      )
    ).toHaveLength(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('restores a crafted freehand but locks autosave for unknown sensor fields', async () => {
    const craftedFreehand = {
      id: 'stored-crafted-freehand',
      type: 'freehand',
      shape: 'feltTipPen',
      points: [
        [0, 0],
        [30, 20],
      ],
      strokeColor: '#123456',
      strokeWidth: 4,
      forceReadings: [0.2, 0.8],
      sensorReadings: [
        { force: 0.2, t: 1 },
        { force: 0.8, t: 2 },
      ],
    };
    const storedBoard = { schemaVersion: 1, children: [craftedFreehand] };
    localForageState.set(STORAGE_NAMESPACES.board, new Map([['document', storedBoard]]));

    render(<App />);

    expect((await screen.findByTestId('drawnix')).getAttribute('data-child-count')).toBe('1');
    expect(latestDrawnixValue[0]).toBe(craftedFreehand);
    expect(screen.getByRole('status').textContent).toContain('自动保存已暂停');

    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId('emit-restored-board-change'));
    vi.runAllTimers();

    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toBe(storedBoard);
    expect(
      setItemCalls.some(({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document')
    ).toBe(false);
  });

  it.each([
    ['an unknown ink version', { version: 2, widths: [2, 3] }],
    ['an ink width length mismatch', { version: 1, widths: [2] }],
    ['an extra ink key', { version: 1, widths: [2, 3], extra: 'unsupported' }],
    ['a non-finite ink width', { version: 1, widths: [Number.NaN, Number.POSITIVE_INFINITY] }],
  ])(
    'restores freehand with legacy rendering while locking autosave for %s',
    async (_caseName, malformedInk) => {
      const storedFreehand = {
        id: 'legacy-freehand',
        type: 'freehand',
        shape: 'feltTipPen',
        points: [
          [0, 0],
          [30, 20],
        ],
        ink: malformedInk,
      };
      const storedBoard = { schemaVersion: 1, children: [storedFreehand] };
      localForageState.set(STORAGE_NAMESPACES.board, new Map([['document', storedBoard]]));

      render(<App />);

      await screen.findByTestId('drawnix');
      const renderedChildren = latestDrawnixValue as Array<Record<string, unknown>>;
      expect(renderedChildren).toHaveLength(1);
      expect(renderedChildren[0]).toMatchObject({
        id: 'legacy-freehand',
        type: 'freehand',
        shape: 'feltTipPen',
        points: [
          [0, 0],
          [30, 20],
        ],
        ink: malformedInk,
      });
      expect(getFreehandInkOutline(renderedChildren[0] as never)).toBeNull();
      expect(screen.getByRole('status').textContent).toContain('自动保存已暂停');
      expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toBe(storedBoard);
      expect(storedFreehand.ink).toBe(malformedInk);
      expect(
        setItemCalls.some(
          ({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document'
        )
      ).toBe(false);

      vi.useFakeTimers();
      fireEvent.click(screen.getByTestId('emit-restored-board-change'));
      vi.runAllTimers();

      expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toBe(storedBoard);
      expect(
        setItemCalls.some(
          ({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document'
        )
      ).toBe(false);
    }
  );

  it('restores but does not write back ink containing forbidden raw input metadata', async () => {
    const privateInk = {
      version: 2,
      widths: [2, 3],
      rawPressure: [0.2, 0.8],
      rawSamples: [{ pressure: 0.8, timestamp: 42 }],
      samples: [{ pressure: 0.8 }],
      tangentialPressure: [0, 0.2],
      pointerType: 'pen',
      buttons: 1,
      isPrimary: true,
      width: [1, 2],
      height: [1, 2],
      time: [40, 42],
      tiltX: [0, 20],
      tiltY: [2, 5],
      altitudeAngle: [0.5, 0.8],
      azimuthAngle: [1, 2],
      twist: [0, 10],
      deviceId: 'synthetic-device',
      event: { type: 'pointermove' },
      diagnostics: { acceptedSamples: 2 },
    };
    const storedFreehand = {
      id: 'private-freehand',
      type: 'freehand',
      shape: 'feltTipPen',
      points: [
        [0, 0],
        [30, 20],
      ],
      ink: privateInk,
      rawPressure: [0.2, 0.8],
    };
    const storedBoard = { schemaVersion: 1, children: [storedFreehand] };
    localForageState.set(STORAGE_NAMESPACES.board, new Map([['document', storedBoard]]));

    render(<App />);

    expect(await screen.findByTestId('drawnix')).toBeTruthy();
    const renderedChildren = latestDrawnixValue as Array<Record<string, unknown>>;
    expect(renderedChildren[0]?.ink).toBe(privateInk);
    expect(getFreehandInkOutline(renderedChildren[0] as never)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('自动保存已暂停');

    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId('emit-restored-board-change'));
    vi.runAllTimers();

    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toBe(storedBoard);
    expect(
      setItemCalls.some(({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document')
    ).toBe(false);
  });

  it.each([
    [
      'named raw samples',
      {
        rawPressure: [0.2, 0.8],
        samples: [{ pressure: 0.8, pointerType: 'pen', timestamp: 42 }],
      },
    ],
    [
      'aliased force and sensor readings',
      {
        forceReadings: [0.2, 0.8],
        sensorReadings: [{ force: 0.8, t: 42 }],
      },
    ],
    [
      'semantically encoded input history under unknown fields',
      {
        eventHistory: [[10, 20, 0.8, 42]],
        inputHistory: [[10, 20, 0.8, 42]],
      },
    ],
    ['raw input encoded under a known but inapplicable field', { autoSize: [[10, 20, 0.8, 42]] }],
    [
      'contact dimensions nested under ink',
      { ink: { version: 2, widths: [2, 3], width: [1, 2], height: [1, 2] } },
    ],
    ['otherwise valid ink attached to geometry', { ink: { version: 1, widths: [2, 3] } }],
  ])('does not persist %s hidden on a non-freehand element', async (_caseName, privateData) => {
    const storedGeometry = {
      id: 'private-geometry',
      type: 'geometry',
      shape: 'rectangle',
      points: [
        [0, 0],
        [100, 100],
      ],
      text: { type: 'paragraph', children: [{ text: '' }] },
      ...privateData,
    };
    const storedBoard = { schemaVersion: 1, children: [storedGeometry] };
    localForageState.set(STORAGE_NAMESPACES.board, new Map([['document', storedBoard]]));

    render(<App />);

    expect((await screen.findByTestId('drawnix')).getAttribute('data-child-count')).toBe('1');
    expect(screen.getByRole('status').textContent).toContain('自动保存已暂停');

    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId('emit-restored-board-change'));
    vi.runAllTimers();

    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toBe(storedBoard);
    expect(
      setItemCalls.some(({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document')
    ).toBe(false);
  });

  it('does not persist raw input encoded under an inapplicable table field', async () => {
    const storedTable = {
      id: 'private-table',
      type: 'table',
      points: [
        [0, 0],
        [100, 100],
      ],
      rows: [{ id: 'row-1' }],
      columns: [{ id: 'column-1' }],
      cells: [{ id: 'cell-1', rowId: 'row-1', columnId: 'column-1' }],
      header: [[10, 20, 0.8, 42]],
    };
    const storedBoard = { schemaVersion: 1, children: [storedTable] };
    localForageState.set(STORAGE_NAMESPACES.board, new Map([['document', storedBoard]]));

    render(<App />);

    expect((await screen.findByTestId('drawnix')).getAttribute('data-child-count')).toBe('1');
    expect(screen.getByRole('status').textContent).toContain('自动保存已暂停');
    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId('emit-restored-board-change'));
    vi.runAllTimers();
    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toBe(storedBoard);
    expect(
      setItemCalls.some(({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document')
    ).toBe(false);
  });

  it('locks board persistence when a replacement introduces forbidden raw input metadata', async () => {
    render(<App />);
    expect(await screen.findByTestId('drawnix')).toBeTruthy();

    fireEvent.click(screen.getByTestId('emit-private-document-replacement'));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('自动保存已暂停');
      expect(screen.getByTestId('drawnix').getAttribute('data-child-count')).toBe('1');
    });
    expect(
      getFreehandInkOutline((latestDrawnixValue as Array<Record<string, unknown>>)[0] as never)
    ).toBeNull();

    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId('emit-restored-board-change'));
    vi.runAllTimers();

    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toBeUndefined();
    expect(
      setItemCalls.some(({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document')
    ).toBe(false);
  });

  it('locks board persistence when replacement metadata exceeds its exact schema', async () => {
    render(<App />);
    expect(await screen.findByTestId('drawnix')).toBeTruthy();

    fireEvent.click(screen.getByTestId('emit-private-metadata-replacement'));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('自动保存已暂停');
      expect(screen.getByTestId('drawnix').getAttribute('data-child-count')).toBe('1');
    });
    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('document')).toBeUndefined();
    expect(
      setItemCalls.some(({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'document')
    ).toBe(false);
  });

  it('rejects malformed tool presets and keeps autosave locked for that slot', async () => {
    const malformedToolState = { freehandPresets: { length: 1 } };
    localForageState.set(STORAGE_NAMESPACES.board, new Map([['tool-state', malformedToolState]]));

    render(<App />);

    expect(await screen.findByTestId('drawnix')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('1 项');
    fireEvent.click(screen.getByTestId('emit-tool-change'));
    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('tool-state')).toBe(
      malformedToolState
    );
    expect(
      setItemCalls.some(
        ({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'tool-state'
      )
    ).toBe(false);
  });

  it.each([
    ['an unknown current pointer', { pointer: 'garbage' }],
    ['an unknown remembered shape', { lastShapePointer: 'star' }],
    ['an out-of-range default preset index', { activeFreehandPresetIndex: 3 }],
    [
      'an out-of-range custom preset index',
      {
        activeFreehandPresetIndex: 1,
        freehandPresets: [{ strokeWidth: 2, strokeColor: '#000000' }],
      },
    ],
    [
      'too many custom presets',
      {
        activeFreehandPresetIndex: 0,
        freehandPresets: Array.from({ length: 4 }, () => ({ strokeWidth: 2 })),
      },
    ],
    [
      'a stroke width outside the supported UI range',
      { activeFreehandPresetIndex: 0, freehandPresets: [{ strokeWidth: 25 }] },
    ],
  ])('rejects %s and keeps tool-state autosave locked', async (_caseName, malformedToolState) => {
    localForageState.set(STORAGE_NAMESPACES.board, new Map([['tool-state', malformedToolState]]));

    render(<App />);

    expect(await screen.findByTestId('drawnix')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('1 项');
    fireEvent.click(screen.getByTestId('emit-tool-change'));
    expect(localForageState.get(STORAGE_NAMESPACES.board)?.get('tool-state')).toBe(
      malformedToolState
    );
    expect(
      setItemCalls.some(
        ({ name, key }) => name === STORAGE_NAMESPACES.board && key === 'tool-state'
      )
    ).toBe(false);
  });

  it('projects recovered freehand presets onto the supported storage contract', async () => {
    localForageState.set(
      STORAGE_NAMESPACES.board,
      new Map([
        [
          'tool-state',
          {
            pointer: 'feltTipPen',
            activeFreehandPresetIndex: 0,
            freehandPresets: [
              {
                strokeWidth: 2,
                strokeColor: '#123456',
                unknownFutureField: 'drop-me',
              },
            ],
            unknownRootField: 'drop-me-too',
          },
        ],
      ])
    );

    render(<App />);

    const drawnix = await screen.findByTestId('drawnix');
    expect(JSON.parse(drawnix.getAttribute('data-tool-state') ?? '{}')).toEqual({
      pointer: 'feltTipPen',
      activeFreehandPresetIndex: 0,
      freehandPresets: [{ strokeWidth: 2, strokeColor: '#123456' }],
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('recreates a complete board session during Strict Mode effect replay', async () => {
    localForageState.set(
      STORAGE_NAMESPACES.console,
      new Map([['layout', { open: true, tab: 'Overview' }]])
    );

    render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    expect(await screen.findByText('attached')).toBeTruthy();
  });

  it('does not pretend two mounted boards are live-synchronized', async () => {
    render(
      <>
        <App />
        <App />
      </>
    );

    expect((await screen.findAllByTestId('drawnix')).length).toBe(2);
    const modes = screen.getAllByLabelText('Session mode') as HTMLSelectElement[];
    fireEvent.change(modes[0], { target: { value: 'teaching' } });

    expect(modes[0].value).toBe('teaching');
    expect(modes[1].value).toBe('unknown');

    fireEvent.change(modes[1], { target: { value: 'learning' } });
    expect(modes[0].value).toBe('teaching');
    expect(modes[1].value).toBe('learning');
    const stored = localForageState.get(STORAGE_NAMESPACES.preferences)?.get('current') as
      | PreferencesFixture
      | undefined;
    expect(stored?.context.sessionMode).toBe('learning');
  });
});

type PreferencesFixture = {
  context: { sessionMode: string };
};
