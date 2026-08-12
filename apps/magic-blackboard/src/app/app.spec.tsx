import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { MagicAppBoundary, MagicBlackboardSession } from './app';
import { STORAGE_NAMESPACES } from './storage';

const localForageState = new Map<string, Map<string, unknown>>();
const rejectedReads = new Set<string>();
const setItemCalls: Array<{ name: string; key: string; value: unknown }> = [];

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
          values.set(key, value);
          return value;
        }),
        removeItem: vi.fn(async (key: string) => values.delete(key)),
        clear: vi.fn(async () => values.clear()),
      };
    },
  },
}));

vi.mock('@drawnix/drawnix', () => ({
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
    }) => void;
    onToolStateChange: (state: { pointer: string }) => void;
  }) => {
    const board = {
      children: value,
      selection: null,
      viewport: { zoom: 1 },
      theme: { themeColorMode: 'default' },
      operations: [],
      onChange: vi.fn(),
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
        data-tool-state={JSON.stringify(initialToolState)}
      >
        {renderOverlay(board) as never}
        <button
          type="button"
          data-testid="emit-board-change"
          onClick={() =>
            onChange({
              operations: [],
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
              operations: [{ type: 'set_node', path: [0], properties: {}, newProperties: node }],
              children: [node],
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
              operations: [{ type: 'set_selection', properties: null, newProperties: null }],
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
  beforeEach(() => {
    localForageState.clear();
    rejectedReads.clear();
    setItemCalls.length = 0;
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
    expect(screen.getByRole('status').textContent).toContain('安全默认值');
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
            data: { topic: { type: 'paragraph', children: [{ text: 'Root' }] } },
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

  it('keeps the latest document when product context causes a parent rerender', async () => {
    render(<App />);
    const drawnix = await screen.findByTestId('drawnix');
    expect(drawnix.getAttribute('data-child-count')).toBe('0');

    fireEvent.click(screen.getByTestId('emit-document-mutation'));
    await waitFor(() => expect(drawnix.getAttribute('data-child-count')).toBe('1'));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'math' } });

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
    const paragraph = (text: string) => ({ type: 'paragraph', children: [{ text }] });
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
          rows: [{ id: 'table-row' }],
          columns: [{ id: 'table-column' }],
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
              { strokeWidth: 2, strokeColor: '#123456', unknownFutureField: 'drop-me' },
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
