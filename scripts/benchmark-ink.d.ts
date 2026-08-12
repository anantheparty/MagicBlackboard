export {};

declare global {
  interface Window {
    __inkBenchmark: {
      dispatchDurations: number[];
      frameIntervals: number[];
      longTasks: number[];
      longTaskObserver?: PerformanceObserver;
      mutationCount: number;
      mutationObserver?: MutationObserver;
      pointerMoves: number;
      running: boolean;
      startHeap: number | null;
    };
  }

  interface Performance {
    memory: {
      usedJSHeapSize: number;
    };
  }
}
