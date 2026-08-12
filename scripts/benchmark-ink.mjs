import { chromium } from '@playwright/test';

const url = process.env.MAGIC_BLACKBOARD_URL ?? 'http://127.0.0.1:7300';
const durationMs = Number.parseInt(process.env.INK_BENCHMARK_DURATION_MS ?? '10000', 10);
const useSystemChrome = process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === '1';

if (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > 60_000) {
  throw new Error('INK_BENCHMARK_DURATION_MS must be between 1000 and 60000.');
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
      observer.observe({ type: 'longtask', buffered: true });
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

  const startX = bounds.x + bounds.width * 0.25;
  const centerY = bounds.y + bounds.height * 0.55;
  await page.mouse.move(startX, centerY);
  await page.keyboard.press('p');
  await page.mouse.down();

  const startedAt = performance.now();
  const sampleIntervalMs = 1000 / 60;
  let sampleIndex = 0;
  while (performance.now() - startedAt < durationMs) {
    const phase = (performance.now() - startedAt) / durationMs;
    const x = bounds.x + bounds.width * (0.2 + phase * 0.6);
    const y = centerY + Math.sin(phase * Math.PI * 16) * bounds.height * 0.16;
    await page.mouse.move(x, y);
    sampleIndex += 1;
    const nextAt = startedAt + sampleIndex * sampleIntervalMs;
    const waitMs = Math.max(0, nextAt - performance.now());
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  await page.mouse.up();
  await page.waitForTimeout(250);

  const measurements = await page.evaluate(() => {
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
    };
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        browser: useSystemChrome ? 'system-chrome' : 'playwright-chromium',
        browserVersion: browser.version(),
        durationMs,
        method:
          'Synthetic 60 Hz mouse path; dispatch timing is capture-to-bubble synchronous event cost.',
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
