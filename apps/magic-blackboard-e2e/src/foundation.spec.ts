import { expect, test, type Page } from '@playwright/test';

type PersistedBoard = {
  readonly children?: readonly {
    readonly type?: string;
    readonly points?: readonly unknown[];
    readonly ink?: {
      readonly version?: number;
      readonly widths?: readonly number[];
    };
  }[];
};

const readPersistedBoard = (page: Page) =>
  page.evaluate(async () => {
    return await new Promise<PersistedBoard | undefined>((resolve, reject) => {
      const request = indexedDB.open('magic_blackboard.board.v1');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('state', 'readonly');
        const documentRequest = transaction.objectStore('state').get('document');
        documentRequest.onerror = () => reject(documentRequest.error);
        documentRequest.onsuccess = () =>
          resolve(documentRequest.result as PersistedBoard | undefined);
        transaction.oncomplete = () => database.close();
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });

const validPersistedInkCount = async (page: Page) => {
  const board = await readPersistedBoard(page);
  return (
    board?.children?.filter(
      (element) =>
        element.type === 'freehand' &&
        element.ink?.version === 1 &&
        Array.isArray(element.points) &&
        Array.isArray(element.ink.widths) &&
        element.points.length === element.ink.widths.length &&
        element.ink.widths.length > 0
    ).length ?? 0
  );
};

const readFirstPersistedInkWidths = async (page: Page) => {
  const board = await readPersistedBoard(page);
  return board?.children?.find((element) => element.type === 'freehand')?.ink?.widths;
};

const hasVariablePersistedInk = async (page: Page) => {
  const widths = await readFirstPersistedInkWidths(page);
  return (
    Array.isArray(widths) && widths.length > 1 && Math.max(...widths) - Math.min(...widths) > 0.01
  );
};

test('keeps the Strict Mode board session attached and placeholders fail closed', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page).toHaveTitle(/Magic Blackboard/);
  await expect(page.locator('.drawnix .plait-board-container')).toBeVisible();

  await page.getByRole('button', { name: 'Open Dev Console' }).click();
  const consolePanel = page.getByRole('complementary', {
    name: 'Magic Blackboard development console',
  });
  await expect(consolePanel).toBeVisible();
  await expect(consolePanel.getByText('attached', { exact: true })).toBeVisible();

  await consolePanel.getByRole('button', { name: 'Features' }).click();
  const diagnosticsFeature = consolePanel.getByRole('checkbox', {
    name: 'Ink diagnostics feature',
  });
  const pressureFeature = consolePanel.getByRole('checkbox', {
    name: 'Pressure ink (experimental) feature',
  });
  await expect(diagnosticsFeature).toBeEnabled();
  await expect(diagnosticsFeature).not.toBeChecked();
  await expect(pressureFeature).toBeEnabled();
  await expect(pressureFeature).not.toBeChecked();
  await expect(consolePanel.getByRole('checkbox', { name: 'Actor feature' })).toBeDisabled();
  await expect(consolePanel.getByText(/Unavailable in this milestone/)).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

test.describe('simulated touch viewport', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36',
    viewport: { width: 390, height: 844 },
  });

  test('opens and closes the development console without a hardware keyboard', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('.drawnix')).toHaveClass(/drawnix--mobile/);
    const launcher = page.getByRole('button', { name: 'Open Dev Console' });
    await expect(launcher).toBeVisible();
    const launcherBounds = await launcher.boundingBox();
    expect(launcherBounds).not.toBeNull();
    expect(launcherBounds!.width).toBeGreaterThanOrEqual(44);
    expect(launcherBounds!.height).toBeGreaterThanOrEqual(44);

    await launcher.tap();
    const consolePanel = page.getByRole('complementary', {
      name: 'Magic Blackboard development console',
    });
    await expect(consolePanel).toBeVisible();
    await expect(consolePanel.getByText('attached', { exact: true })).toBeVisible();
    const panelBounds = await consolePanel.boundingBox();
    expect(panelBounds).not.toBeNull();
    expect(panelBounds!.x).toBeGreaterThanOrEqual(0);
    expect(panelBounds!.x + panelBounds!.width).toBeLessThanOrEqual(390);

    const close = consolePanel.getByRole('button', { name: 'Close console' });
    const closeBounds = await close.boundingBox();
    expect(closeBounds).not.toBeNull();
    expect(closeBounds!.width).toBeGreaterThanOrEqual(44);
    expect(closeBounds!.height).toBeGreaterThanOrEqual(44);
    await close.tap();
    await expect(consolePanel).toBeHidden();
    await expect(launcher).toBeVisible();
    await expect(page.locator('.drawnix .plait-board-container')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});

test('persists explicit context across a reload', async ({ page }) => {
  await page.goto('/');
  await page
    .locator('.magic-context')
    .getByText(/上下文/)
    .click();
  await page.getByLabel('Session mode').selectOption('teaching');
  await page.getByLabel('Subject').selectOption('physics');
  await expect(page.locator('.magic-context summary')).toContainText('教学 / 物理');

  await page.reload();
  await expect(page.locator('.drawnix')).toBeVisible();
  await expect(page.locator('.magic-context summary')).toContainText('教学 / 物理');
  await expect(page.getByLabel('Session mode')).toHaveValue('teaching');
  await expect(page.getByLabel('Subject')).toHaveValue('physics');
});

test('creates a freehand stroke and restores it after reload', async ({ page }) => {
  await page.goto('/');
  const board = page.locator('.plait-board-container');
  await expect(board).toBeVisible();
  const bounds = await board.boundingBox();
  expect(bounds).not.toBeNull();

  // Drawnix only handles creation hotkeys while the pointer is over the board.
  await page.mouse.move(bounds!.x + 420, bounds!.y + 320);
  await page.keyboard.press('p');
  await expect(page.getByRole('button', { name: '画笔 — P', exact: true }).first()).toHaveClass(
    /tool-icon--selected/
  );
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 470, bounds!.y + 350, { steps: 8 });
  await page.mouse.move(bounds!.x + 520, bounds!.y + 315, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByRole('button', { name: '撤销' })).toBeEnabled();
  await expect(page.locator('.element-host > *')).toHaveCount(1);
  // A product-owned context update rerenders the composition root. It must
  // not replace Drawnix's current document with the initially loaded value.
  await page
    .locator('.magic-context')
    .getByText(/上下文/)
    .click();
  await page.getByLabel('Subject').selectOption('math');
  await expect(page.locator('.element-host > *')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '撤销' })).toBeEnabled();
  // Reload immediately: pagehide/visibility flushing must preserve the newest
  // pending document instead of relying on the normal debounce window.
  await page.reload();
  await expect(page.locator('.element-host > *')).toHaveCount(1);
});

test('persists simulated variable pen pressure through a product rerender and reload', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  const board = page.locator('.plait-board-container');
  const host = board.locator('svg').first();
  await expect(host).toBeVisible();

  await page.keyboard.press('Control+Shift+D');
  const consolePanel = page.getByRole('complementary', {
    name: 'Magic Blackboard development console',
  });
  await consolePanel.getByRole('button', { name: 'Features' }).click();
  const pressureFeature = consolePanel.getByRole('checkbox', {
    name: 'Pressure ink (experimental) feature',
  });
  await pressureFeature.click();
  await expect(pressureFeature).toBeChecked();
  await consolePanel.getByRole('button', { name: 'Close console' }).click();
  await expect(consolePanel).toBeHidden();

  const bounds = await board.boundingBox();
  expect(bounds).not.toBeNull();
  const penTool = page.getByRole('button', { name: '画笔 — P', exact: true }).first();
  await penTool.click();
  await expect(penTool).toHaveClass(/tool-icon--selected/);

  await host.evaluate(
    (target, origin) => {
      const dispatchPen = (
        type: string,
        x: number,
        y: number,
        pressure: number,
        buttons: number,
        coalesced: readonly Record<string, unknown>[] = []
      ) => {
        const event = new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 91,
          pointerType: 'pen',
          isPrimary: true,
          button: 0,
          buttons,
          clientX: x,
          clientY: y,
          pressure,
        });
        if (coalesced.length > 0) {
          Object.defineProperty(event, 'getCoalescedEvents', {
            value: () => coalesced,
          });
        }
        target.dispatchEvent(event);
      };

      const startedAt = performance.now();
      dispatchPen('pointerdown', origin.x + 220, origin.y + 180, 0.12, 1);
      dispatchPen('pointermove', origin.x + 280, origin.y + 210, 0.36, 1, [
        {
          pointerId: 91,
          pointerType: 'pen',
          isPrimary: true,
          button: 0,
          buttons: 1,
          clientX: origin.x + 240,
          clientY: origin.y + 190,
          pressure: 0.2,
          timeStamp: startedAt + 4,
        },
        {
          pointerId: 91,
          pointerType: 'pen',
          isPrimary: true,
          button: 0,
          buttons: 1,
          clientX: origin.x + 280,
          clientY: origin.y + 210,
          pressure: 0.36,
          timeStamp: startedAt + 8,
        },
      ]);
      dispatchPen('pointermove', origin.x + 350, origin.y + 165, 0.78, 1, [
        {
          pointerId: 91,
          pointerType: 'pen',
          isPrimary: true,
          button: 0,
          buttons: 1,
          clientX: origin.x + 315,
          clientY: origin.y + 185,
          pressure: 0.58,
          timeStamp: startedAt + 12,
        },
        {
          pointerId: 91,
          pointerType: 'pen',
          isPrimary: true,
          button: 0,
          buttons: 1,
          clientX: origin.x + 350,
          clientY: origin.y + 165,
          pressure: 0.78,
          timeStamp: startedAt + 16,
        },
      ]);
      dispatchPen('pointerup', origin.x + 390, origin.y + 200, 0, 0);
    },
    { x: bounds!.x, y: bounds!.y }
  );

  await expect.poll(() => validPersistedInkCount(page)).toBe(1);
  await expect.poll(() => hasVariablePersistedInk(page)).toBe(true);
  const persistedWidths = await readFirstPersistedInkWidths(page);
  await expect(page.locator('.element-host > *')).toHaveCount(1);

  await page
    .locator('.magic-context')
    .getByText(/上下文/)
    .click();
  await page.getByLabel('Subject').selectOption('math');
  await expect(page.locator('.element-host > *')).toHaveCount(1);
  await expect.poll(() => readFirstPersistedInkWidths(page)).toEqual(persistedWidths);

  await page.reload();
  await expect(page.locator('.element-host > *')).toHaveCount(1);
  await expect.poll(() => readFirstPersistedInkWidths(page)).toEqual(persistedWidths);
  expect(pageErrors).toEqual([]);
});

test('imports valid v1 ink as a durable replacement document', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // browser-fs-access selects its fallback implementation at module load.
  // System Chrome's native picker cannot be automated by Playwright, so make
  // that capability absent in this isolated page and exercise the library's
  // standard <input type=file> fallback instead.
  await page.addInitScript(() => {
    let candidate: object | null = window;
    while (candidate) {
      if (Object.prototype.hasOwnProperty.call(candidate, 'showOpenFilePicker')) {
        Reflect.deleteProperty(candidate, 'showOpenFilePicker');
      }
      candidate = Object.getPrototypeOf(candidate) as object | null;
    }
  });
  await page.goto('/');
  const board = page.locator('.plait-board-container');
  const bounds = await board.boundingBox();
  expect(bounds).not.toBeNull();

  const penTool = page.getByRole('button', { name: '画笔 — P', exact: true }).first();
  await penTool.click();
  await page.mouse.move(bounds!.x + 120, bounds!.y + 120);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 180, bounds!.y + 150, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: '撤销' })).toBeEnabled();

  const fileChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '应用菜单' }).click();
  await page.getByTestId('open-button').click();
  await (
    await fileChooser
  ).setFiles({
    name: 'variable-pressure.drawnix',
    mimeType: 'application/vnd.drawnix+json',
    buffer: Buffer.from(
      JSON.stringify({
        type: 'drawnix',
        version: 1,
        source: 'web',
        elements: [
          {
            id: 'imported-variable-ink',
            type: 'freehand',
            shape: 'feltTipPen',
            points: [
              [20, 30],
              [40, 50],
              [70, 65],
            ],
            strokeColor: '#123456',
            strokeWidth: 4,
            ink: { version: 1, widths: [2, 4, 7] },
          },
        ],
        viewport: { zoom: 1, origination: [0, 0] },
        theme: { themeColorMode: 'default' },
      })
    ),
  });

  await expect(page.locator('.element-host > *')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled();
  await expect.poll(() => validPersistedInkCount(page)).toBe(1);
  await expect.poll(() => readFirstPersistedInkWidths(page)).toEqual([2, 4, 7]);

  await page
    .locator('.magic-context')
    .getByText(/上下文/)
    .click();
  await page.getByLabel('Subject').selectOption('physics');
  await expect.poll(() => readFirstPersistedInkWidths(page)).toEqual([2, 4, 7]);

  await page.reload();
  await expect(page.locator('.element-host > *')).toHaveCount(1);
  await expect.poll(() => readFirstPersistedInkWidths(page)).toEqual([2, 4, 7]);
  expect(pageErrors).toEqual([]);
});
