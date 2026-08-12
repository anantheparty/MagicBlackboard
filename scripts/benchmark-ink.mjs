import { chromium } from '@playwright/test';

const url = process.env.MAGIC_BLACKBOARD_URL ?? 'http://127.0.0.1:7300';
const durationMs = Number.parseInt(process.env.INK_BENCHMARK_DURATION_MS ?? '10000', 10);
const useSystemChrome = process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === '1';
const mode = process.env.INK_BENCHMARK_MODE ?? 'legacy';

if (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > 60_000) {
  throw new Error('INK_BENCHMARK_DURATION_MS must be between 1000 and 60000.');
}
if (mode !== 'legacy' && mode !== 'simulated-pressure') {
  throw new Error('INK_BENCHMARK_MODE must be legacy or simulated-pressure.');
}

const browser = await chromium.launch({
  headless: true,
  ...(useSystemChrome ? { channel: 'chrome' } : {}),
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  const board = page.locator('.plait-board-container');
  await board.waitFor({ state: 'visible' });
  const bounds = await board.boundingBox();
  if (!bounds) {
    throw new Error('Board bounds are unavailable.');
  }

  if (mode === 'simulated-pressure') {
    await page.keyboard.press('Control+Shift+D');
    const consolePanel = page.getByRole('complementary', {
      name: 'Magic Blackboard development console',
    });
    await consolePanel.getByRole('button', { name: 'Features' }).click();
    const pressureFeature = consolePanel.getByRole('checkbox', {
      name: 'Pressure ink (experimental) feature',
    });
    await pressureFeature.click();
    await page.waitForFunction(
      (element) => element instanceof HTMLInputElement && element.checked,
      await pressureFeature.elementHandle()
    );
    await consolePanel.getByRole('button', { name: 'Close console' }).click();
    await page.getByRole('button', { name: '画笔 — P', exact: true }).first().click();
  }

  await page.evaluate(() => {
    const state = {
      dispatchDurations: [],
      frameIntervals: [],
      longTasks: [],
      mutationCount: 0,
      pointerMoves: 0,
      running: true,
      startHeap: 'memory' in performance ? performance.memory.usedJSHeapSize : null,
    };
    window.__inkBenchmark = state;

    const starts = new WeakMap();
    window.addEventListener(
      'pointermove',
      (event) => {
        starts.set(event, performance.now());
        state.pointerMoves += 1;
      },
      { capture: true }
    );
    window.addEventListener('pointermove', (event) => {
      const startedAt = starts.get(event);
      if (startedAt !== undefined) {
        state.dispatchDurations.push(performance.now() - startedAt);
      }
    });

    let previousFrame = performance.now();
    const frame = (now) => {
      if (!state.running) {
        return;
      }
      state.frameIntervals.push(now - previousFrame);
      previousFrame = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      const observer = new PerformanceObserver((list) => {
        state.longTasks.push(...list.getEntries().map((entry) => entry.duration));
      });
      // Observe only work produced after this benchmark begins; buffered page-load
      // entries would make the sustained-input measurement incomparable.
      observer.observe({ type: 'longtask' });
      state.longTaskObserver = observer;
    }

    const mutationObserver = new MutationObserver((records) => {
      state.mutationCount += records.length;
    });
    mutationObserver.observe(document.querySelector('.drawnix'), {
      childList: true,
      subtree: true,
      attributes: true,
    });
    state.mutationObserver = mutationObserver;
  });

  if (mode === 'legacy') {
    await runLegacyMouseBenchmark(page, bounds, durationMs);
  } else {
    await runSimulatedPressureBenchmark(page, board.locator('svg').first(), bounds, durationMs);
  }
  await page.waitForFunction(
    async ({ benchmarkMode, minimumMoves }) => {
      const state = window.__inkBenchmark;
      if (!state || state.pointerMoves < minimumMoves) return false;
      const persisted = await new Promise((resolve, reject) => {
        const request = indexedDB.open('magic_blackboard.board.v1');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('state', 'readonly');
          const documentRequest = transaction.objectStore('state').get('document');
          documentRequest.onerror = () => reject(documentRequest.error);
          documentRequest.onsuccess = () => resolve(documentRequest.result);
          transaction.oncomplete = () => database.close();
        };
      });
      const freehands = persisted?.children?.filter((element) => element.type === 'freehand') ?? [];
      const freehand = freehands.at(-1);
      const points = freehand?.points;
      if (!Array.isArray(points) || points.length < 2) return false;
      if (benchmarkMode === 'legacy') {
        return (
          !Object.prototype.hasOwnProperty.call(freehand, 'ink') &&
          !document.querySelector('[data-freehand-ink-version="1"]')
        );
      }
      const widths = freehand?.ink?.widths;
      if (!Array.isArray(widths) || points.length !== widths.length) return false;
      let minimumWidth = Number.POSITIVE_INFINITY;
      let maximumWidth = Number.NEGATIVE_INFINITY;
      for (const width of widths) {
        minimumWidth = Math.min(minimumWidth, width);
        maximumWidth = Math.max(maximumWidth, width);
      }
      return (
        document.querySelector('[data-freehand-ink-version="1"]') !== null &&
        maximumWidth - minimumWidth > 0
      );
    },
    {
      benchmarkMode: mode,
      minimumMoves: Math.max(10, Math.floor((durationMs / 1000) * 30)),
    },
    { timeout: 5000 }
  );
  await page.waitForTimeout(250);

  const measurements = await page.evaluate(async (benchmarkMode) => {
    const state = window.__inkBenchmark;
    state.running = false;
    state.longTaskObserver?.disconnect();
    state.mutationObserver?.disconnect();

    const summarize = (values) => {
      if (values.length === 0) {
        return { count: 0, max: null, p50: null, p95: null };
      }
      const sorted = [...values].sort((left, right) => left - right);
      const percentile = (ratio) =>
        sorted[Math.min(sorted.length - 1, Math.floor(ratio * sorted.length))];
      return {
        count: sorted.length,
        max: sorted[sorted.length - 1],
        p50: percentile(0.5),
        p95: percentile(0.95),
      };
    };

    const endHeap = 'memory' in performance ? performance.memory.usedJSHeapSize : null;
    const readPersistedDocument = () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('magic_blackboard.board.v1');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('state', 'readonly');
          const documentRequest = transaction.objectStore('state').get('document');
          documentRequest.onerror = () => reject(documentRequest.error);
          documentRequest.onsuccess = () => resolve(documentRequest.result);
          transaction.oncomplete = () => database.close();
        };
      });
    const persisted = await readPersistedDocument();
    const freehand = persisted?.children?.filter((element) => element.type === 'freehand').at(-1);
    const widths = Array.isArray(freehand?.ink?.widths) ? freehand.ink.widths : [];
    let minimumWidth = Number.POSITIVE_INFINITY;
    let maximumWidth = Number.NEGATIVE_INFINITY;
    for (const width of widths) {
      minimumWidth = Math.min(minimumWidth, width);
      maximumWidth = Math.max(maximumWidth, width);
    }
    return {
      dispatchMs: summarize(state.dispatchDurations),
      frameIntervalMs: summarize(state.frameIntervals),
      heapDeltaBytes:
        state.startHeap === null || endHeap === null ? null : endHeap - state.startHeap,
      longTaskMs: summarize(state.longTasks),
      mutationCount: state.mutationCount,
      pointerMoves: state.pointerMoves,
      renderedElementCount: document.querySelectorAll('.element-host > *').length,
      svgNodeCount: document.querySelectorAll('.drawnix svg *').length,
      ...(benchmarkMode === 'simulated-pressure'
        ? {
            inkPathCount: document.querySelectorAll('[data-freehand-ink-version="1"]').length,
            persistedPointCount: Array.isArray(freehand?.points) ? freehand.points.length : null,
            persistedWidthCount: widths.length,
            persistedWidthSpread: widths.length > 0 ? maximumWidth - minimumWidth : null,
          }
        : {
            persistedPointCount: Array.isArray(freehand?.points) ? freehand.points.length : null,
            persistedWithoutInk:
              freehand !== undefined && !Object.prototype.hasOwnProperty.call(freehand, 'ink'),
          }),
    };
  }, mode);

  process.stdout.write(
    `${JSON.stringify(
      {
        browser: useSystemChrome ? 'system-chrome' : 'playwright-chromium',
        browserVersion: browser.version(),
        durationMs,
        mode,
        method:
          mode === 'legacy'
            ? 'Synthetic 60 Hz mouse path with every ink feature off; dispatch timing is capture-to-bubble synchronous event cost.'
            : 'Simulated 60 Hz pen pointer events with two monotonic coalesced samples per move and variable pressure; dispatch timing excludes rAF preview work.',
        url,
        ...measurements,
      },
      null,
      2
    )}\n`
  );
} finally {
  await browser.close();
}

async function runLegacyMouseBenchmark(page, bounds, duration) {
  const startX = bounds.x + bounds.width * 0.25;
  const centerY = bounds.y + bounds.height * 0.55;
  await page.mouse.move(startX, centerY);
  await page.keyboard.press('p');
  await page.mouse.down();
  const startedAt = performance.now();
  const sampleIntervalMs = 1000 / 60;
  let sampleIndex = 0;
  while (performance.now() - startedAt < duration) {
    const phase = (performance.now() - startedAt) / duration;
    await page.mouse.move(
      bounds.x + bounds.width * (0.2 + phase * 0.6),
      centerY + Math.sin(phase * Math.PI * 16) * bounds.height * 0.16
    );
    sampleIndex += 1;
    const waitMs = Math.max(0, startedAt + sampleIndex * sampleIntervalMs - performance.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  await page.mouse.up();
}

async function runSimulatedPressureBenchmark(page, host, bounds, duration) {
  await host.evaluate(
    async (target, input) => {
      const pointerId = 91;
      const intervalMs = 1000 / 60;
      const centerY = input.y + input.height * 0.55;
      const startedAt = performance.now();
      const pointAt = (phase) => ({
        x: input.x + input.width * (0.2 + phase * 0.6),
        y: centerY + Math.sin(phase * Math.PI * 16) * input.height * 0.16,
        pressure: 0.12 + 0.76 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 12)),
      });
      const dispatch = (type, point, buttons, coalesced = []) => {
        const event = new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: 'pen',
          isPrimary: true,
          button: 0,
          buttons,
          clientX: point.x,
          clientY: point.y,
          pressure: point.pressure,
        });
        if (coalesced.length > 0) {
          Object.defineProperty(event, 'getCoalescedEvents', { value: () => coalesced });
        }
        target.dispatchEvent(event);
      };
      dispatch('pointerdown', pointAt(0), 1);
      let index = 1;
      await new Promise((resolve) => {
        const step = () => {
          const elapsed = performance.now() - startedAt;
          if (elapsed >= input.duration) {
            dispatch('pointerup', pointAt(1), 0);
            resolve();
            return;
          }
          const phase = Math.min(1, elapsed / input.duration);
          const point = pointAt(phase);
          const previous = pointAt(Math.max(0, phase - intervalMs / input.duration));
          const nominalTime = startedAt + index * intervalMs;
          dispatch('pointermove', point, 1, [
            {
              pointerId,
              pointerType: 'pen',
              isPrimary: true,
              button: 0,
              buttons: 1,
              clientX: previous.x,
              clientY: previous.y,
              pressure: previous.pressure,
              timeStamp: nominalTime - intervalMs / 2,
            },
            {
              pointerId,
              pointerType: 'pen',
              isPrimary: true,
              button: 0,
              buttons: 1,
              clientX: point.x,
              clientY: point.y,
              pressure: point.pressure,
              timeStamp: nominalTime,
            },
          ]);
          index += 1;
          setTimeout(step, Math.max(0, startedAt + index * intervalMs - performance.now()));
        };
        setTimeout(step, intervalMs);
      });
    },
    { ...bounds, duration }
  );
}
