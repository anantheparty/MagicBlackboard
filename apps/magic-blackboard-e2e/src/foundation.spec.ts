import { expect, test } from '@playwright/test';

test('keeps the Strict Mode board session attached and placeholders fail closed', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page).toHaveTitle(/Magic Blackboard/);
  await expect(page.locator('.drawnix .plait-board-container')).toBeVisible();

  await page.keyboard.press('Control+Shift+D');
  const consolePanel = page.getByRole('complementary', {
    name: 'Magic Blackboard development console',
  });
  await expect(consolePanel).toBeVisible();
  await expect(consolePanel.getByText('attached', { exact: true })).toBeVisible();

  await consolePanel.getByRole('button', { name: 'Features' }).click();
  await expect(
    consolePanel.getByRole('checkbox', { name: 'Ink diagnostics feature' })
  ).toBeDisabled();
  await expect(consolePanel.getByRole('checkbox', { name: 'Actor feature' })).toBeDisabled();
  await expect(consolePanel.getByText(/Unavailable in this milestone/)).toHaveCount(2);
  expect(pageErrors).toEqual([]);
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
