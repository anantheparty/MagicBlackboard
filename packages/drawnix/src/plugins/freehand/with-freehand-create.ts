import {
  PlaitBoard,
  Point,
  Transforms,
  distanceBetweenPointAndPoint,
  isMainPointer,
  toHostPoint,
  toViewBoxPoint,
  type PlaitOperation,
} from '@plait/core';
import { isDrawingMode } from '@plait/common';
import { createFreehandElement, getFreehandDrawOptions, getFreehandPointers } from './utils';
import { Freehand, FreehandShape } from './type';
import { FreehandGenerator } from './freehand.generator';
import { FreehandSmoother } from './smoother';
import {
  isTwoFingerMode,
  setBoardPointerLifecycleHandler,
  type BoardPointerLifecycleEvent,
} from '@plait-board/react-board';
import { InkCapabilityProbe } from './ink/capability';
import { getFreehandInkPluginOptions, registerFreehandInkLifecycleDisposer } from './ink/plugin';
import { mapInkSampleWidth } from './ink/pressure';
import {
  createInkResamplerState,
  finishInkResampling,
  resampleInkSamples,
  type InkResamplerState,
} from './ink/resample';
import {
  acceptMonotonicInkSamples,
  extractInkSampleBatch,
  summarizeIntervals,
  transformInkSamplePoints,
  type MonotonicInkState,
} from './ink/samples';
import { compactFreehandInkWidths } from './ink/schema';
import type {
  ExtractedInkSampleBatch,
  FreehandInkDiagnostic,
  FreehandInkMode,
  InkCapabilitySnapshot,
  InkEndReason,
  InkSample,
  InkStrategy,
} from './ink/types';
import { MAX_FREEHAND_INK_SAMPLES, MAX_LEGACY_FREEHAND_POINTS } from './ink/types';

export const appendLegacyFreehandPoint = (points: Point[], point: Point): boolean => {
  if (points.length >= MAX_LEGACY_FREEHAND_POINTS) {
    return false;
  }
  points.push(point);
  return true;
};

export const closeLegacyFreehandPoints = (points: Point[]): void => {
  if (points.length === 0) return;
  if (!appendLegacyFreehandPoint(points, points[0]) && points.length > 1) {
    // Preserve the legacy closed-stroke marker without exceeding the document
    // contract when capture already reached its hard bound.
    points[points.length - 1] = points[0];
  }
};

export const withFreehandCreate = (board: PlaitBoard) => {
  const legacy = installLegacyFreehandCreate(board);
  return installExperimentalFreehandCreate(legacy.board, legacy.cancelActiveStroke);
};

function installLegacyFreehandCreate(board: PlaitBoard): {
  board: PlaitBoard;
  cancelActiveStroke: () => void;
} {
  const { pointerDown, pointerMove, pointerUp, globalPointerUp, touchStart } = board;

  let isDrawing = false;
  let isSnappingStartAndEnd = false;
  let points: Point[] = [];
  let originScreenPoint: Point | null = null;

  const generator = new FreehandGenerator(board);
  const smoother = new FreehandSmoother({ smoothing: 0.7, pressureSensitivity: 0.6 });
  let temporaryElement: Freehand | null = null;

  const complete = (cancel?: boolean) => {
    if (isDrawing) {
      const pointer = PlaitBoard.getPointer(board) as FreehandShape;
      const drawOptions = getFreehandDrawOptions(board);
      if (isSnappingStartAndEnd) {
        closeLegacyFreehandPoints(points);
      }
      temporaryElement = createFreehandElement(pointer, points, drawOptions);
    }
    if (temporaryElement && !cancel) {
      Transforms.insertNode(board, temporaryElement, [board.children.length]);
    }
    generator.destroy();
    temporaryElement = null;
    isDrawing = false;
    points = [];
    smoother.reset();
  };

  board.touchStart = (event: TouchEvent) => {
    const freehandPointers = getFreehandPointers();
    const isFreehandPointer = PlaitBoard.isInPointer(board, freehandPointers);
    if (isFreehandPointer && isDrawingMode(board)) {
      return event.preventDefault();
    }
    touchStart(event);
  };

  board.pointerDown = (event: PointerEvent) => {
    if (resolveInkMode(board) === 'pressure' && event.pointerType === 'pen' && !isDrawing) {
      pointerDown(event);
      return;
    }
    const freehandPointers = getFreehandPointers();
    const isFreehandPointer = PlaitBoard.isInPointer(board, freehandPointers);
    if (isFreehandPointer && isDrawingMode(board) && isMainPointer(event)) {
      isDrawing = true;
      originScreenPoint = [event.x, event.y];
      const smoothingPoint = smoother.process(originScreenPoint) as Point;
      const point = toViewBoxPoint(board, toHostPoint(board, smoothingPoint[0], smoothingPoint[1]));
      appendLegacyFreehandPoint(points, point);
    }
    pointerDown(event);
  };

  board.pointerMove = (event: PointerEvent) => {
    if (resolveInkMode(board) === 'pressure' && event.pointerType === 'pen' && !isDrawing) {
      pointerMove(event);
      return;
    }
    if (isDrawing && !isTwoFingerMode(board)) {
      const currentScreenPoint: Point = [event.x, event.y];
      if (
        originScreenPoint &&
        distanceBetweenPointAndPoint(
          originScreenPoint[0],
          originScreenPoint[1],
          currentScreenPoint[0],
          currentScreenPoint[1]
        ) < 8
      ) {
        isSnappingStartAndEnd = true;
      } else {
        isSnappingStartAndEnd = false;
      }
      const smoothingPoint = smoother.process(currentScreenPoint);
      if (smoothingPoint) {
        generator.destroy();
        const newPoint = toViewBoxPoint(
          board,
          toHostPoint(board, smoothingPoint[0], smoothingPoint[1])
        );
        if (!appendLegacyFreehandPoint(points, newPoint)) {
          return;
        }
        const pointer = PlaitBoard.getPointer(board) as FreehandShape;
        temporaryElement = createFreehandElement(pointer, points, getFreehandDrawOptions(board));
        generator.processDrawing(temporaryElement, PlaitBoard.getElementTopHost(board));
      }
      return;
    }
    if (isTwoFingerMode(board) && isDrawing) {
      complete(true);
      return;
    }
    pointerMove(event);
  };

  board.pointerUp = (event: PointerEvent) => {
    if (isDrawing) {
      complete();
    }
    pointerUp(event);
  };

  board.globalPointerUp = (event: PointerEvent) => {
    if (isDrawing) {
      complete(true);
    }
    globalPointerUp(event);
  };

  return {
    board,
    cancelActiveStroke: () => complete(true),
  };
}

function installExperimentalFreehandCreate(
  board: PlaitBoard,
  cancelLegacyStroke: () => void
): PlaitBoard {
  const { pointerDown, pointerMove, pointerUp, pointerCancel, globalPointerUp, apply } = board;
  const generator = new FreehandGenerator(board);
  let capabilityProbe = new InkCapabilityProbe();

  let activePointerId: number | null = null;
  let probePointerId: number | null = null;
  let legacyFallbackPointerId: number | null = null;
  let isDrawing = false;
  let isSnappingStartAndEnd = false;
  let originScreenPoint: Point | null = null;
  let points: Point[] = [];
  let widths: number[] = [];
  let previousWidth: number | null = null;
  let usedHardwarePressure = false;
  let monotonicState: MonotonicInkState = { lastSample: null };
  let resamplerState: InkResamplerState = createInkResamplerState();
  let temporaryElement: Freehand | null = null;
  let activePointerType: ExtractedInkSampleBatch['identity']['pointerType'] = 'unknown';
  let lastPressureBatch: ExtractedInkSampleBatch | null = null;
  let captureTarget: Element | null = null;
  let captureCapped = false;
  let previousDiagnosticSample: InkSample | null = null;
  let previewFrameId: number | null = null;
  let previewFramePending = false;

  const cancelPreviewFrame = () => {
    if (previewFrameId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(previewFrameId);
    }
    previewFrameId = null;
    previewFramePending = false;
  };

  const reset = () => {
    const pointerId = activePointerId;
    const target = captureTarget;
    cancelPreviewFrame();
    generator.destroy();
    activePointerId = null;
    probePointerId = null;
    legacyFallbackPointerId = null;
    activePointerType = 'unknown';
    lastPressureBatch = null;
    captureTarget = null;
    captureCapped = false;
    previousDiagnosticSample = null;
    isDrawing = false;
    isSnappingStartAndEnd = false;
    originScreenPoint = null;
    points = [];
    widths = [];
    previousWidth = null;
    usedHardwarePressure = false;
    monotonicState = { lastSample: null };
    resamplerState = createInkResamplerState();
    temporaryElement = null;
    if (pointerId !== null && target && 'hasPointerCapture' in target) {
      try {
        if (target.hasPointerCapture(pointerId)) {
          target.releasePointerCapture(pointerId);
        }
      } catch {
        // Pointer capture may already have been released by the browser.
      }
    }
  };

  const emitDiagnostic = (
    batch: ExtractedInkSampleBatch,
    accepted: readonly InkSample[],
    additionalDropped = 0,
    endReason?: InkEndReason,
    capabilityOverride?: InkCapabilitySnapshot,
    geometryDroppedSamples = 0,
    capped = false
  ) => {
    const options = getFreehandInkPluginOptions(board);
    if (!options.onDiagnostic || !shouldEmitDiagnostics(options.shouldEmitDiagnostics)) {
      return;
    }
    const capability =
      capabilityOverride ?? capabilityProbe.observe(batch.identity, batch.samples, batch.apis);
    const strategy = resolveStrategy(capability.pressureCapability);
    const intervalSamples = previousDiagnosticSample
      ? [previousDiagnosticSample, ...accepted]
      : accepted;
    if (accepted.length > 0) {
      previousDiagnosticSample = accepted[accepted.length - 1];
    }
    const diagnostic: FreehandInkDiagnostic = {
      observedAt: batch.samples[batch.samples.length - 1]?.time ?? 0,
      pointerType: batch.identity.pointerType,
      isPrimary: batch.identity.isPrimary,
      button: batch.identity.button,
      buttons: batch.identity.buttons,
      source: batch.source,
      strategy,
      receivedSamples: batch.receivedSamples,
      acceptedSamples: accepted.length,
      coalescedSamples: batch.coalescedSamples,
      droppedSamples: batch.droppedSamples + additionalDropped,
      ...(geometryDroppedSamples > 0 ? { geometryDroppedSamples } : {}),
      ...(capped ? { captureCapped: true } : {}),
      intervalMs: summarizeIntervals(intervalSamples),
      capability,
      ...(endReason ? { endReason } : {}),
    };
    try {
      options.onDiagnostic(diagnostic);
    } catch {
      // Diagnostics are optional observability and never own drawing correctness.
    }
  };

  const observeOnly = (event: PointerEvent, endReason?: InkEndReason) => {
    const batch = extractInkSampleBatch(event);
    lastPressureBatch = batch;
    const monotonic = acceptMonotonicInkSamples(monotonicState, batch.samples);
    monotonicState = monotonic.state;
    const capability = capabilityProbe.observe(batch.identity, monotonic.accepted, batch.apis);
    emitDiagnostic(batch, monotonic.accepted, monotonic.droppedSamples, endReason, capability);
  };

  const stopProbe = () => {
    probePointerId = null;
    lastPressureBatch = null;
    previousDiagnosticSample = null;
    monotonicState = { lastSample: null };
  };

  const handoffProbeToLegacyFallback = () => {
    if (probePointerId !== null) {
      legacyFallbackPointerId = probePointerId;
      stopProbe();
    }
  };

  const processPressureEvent = (event: PointerEvent, activePressure?: number) => {
    const extractedBatch = extractInkSampleBatch(event);
    const batch =
      event.buttons === 0 && activePressure !== undefined
        ? {
            ...extractedBatch,
            samples: extractedBatch.samples.map((sample) =>
              sample.pressure === undefined || sample.pressure === 0
                ? { ...sample, pressure: activePressure }
                : sample
            ),
          }
        : extractedBatch;
    lastPressureBatch = batch;
    const viewBoxSamples = transformInkSamplePoints(batch.samples, ([x, y]) =>
      toViewBoxPoint(board, toHostPoint(board, x, y))
    );
    const monotonic = acceptMonotonicInkSamples(monotonicState, viewBoxSamples);
    monotonicState = monotonic.state;
    const resampled = resampleInkSamples(
      resamplerState,
      monotonic.accepted,
      1.5 / Math.max(0.01, board.viewport.zoom),
      0.7
    );
    resamplerState = resampled.state;
    const capability = capabilityProbe.observe(batch.identity, monotonic.accepted, batch.apis);
    const strategy = resolveStrategy(capability.pressureCapability);
    usedHardwarePressure ||= strategy === 'hardware-pressure';
    const strokeCapacity = Math.max(0, MAX_FREEHAND_INK_SAMPLES - points.length);
    const acceptedForStroke = resampled.samples.slice(0, strokeCapacity);
    const strokeOverflow = resampled.samples.length - acceptedForStroke.length;
    captureCapped = points.length + acceptedForStroke.length >= MAX_FREEHAND_INK_SAMPLES;
    appendInkSamples(acceptedForStroke, strategy);
    const transformDropped = batch.samples.length - viewBoxSamples.length;
    emitDiagnostic(
      batch,
      monotonic.accepted,
      monotonic.droppedSamples + transformDropped,
      undefined,
      capability,
      resampled.droppedSamples + strokeOverflow,
      captureCapped
    );
  };

  const appendInkSamples = (samples: readonly InkSample[], strategy: InkStrategy) => {
    const drawOptions = getFreehandDrawOptions(board);
    const baseWidth = drawOptions.strokeWidth ?? 2;
    const sensitivity = getFreehandInkPluginOptions(board).sensitivity ?? 1;
    for (const sample of samples) {
      const width = mapInkSampleWidth(sample, strategy, baseWidth, previousWidth, sensitivity);
      points.push(sample.point);
      widths.push(width);
      previousWidth = width;
    }
  };

  const redrawPreview = () => {
    if (points.length === 0) {
      return;
    }
    const drawLatestPreview = () => {
      if (points.length === 0) {
        return;
      }
      generator.destroy();
      temporaryElement = createPressureElement(board, points, widths, usedHardwarePressure, false);
      generator.processDrawing(temporaryElement, PlaitBoard.getElementTopHost(board));
    };
    if (typeof requestAnimationFrame !== 'function') {
      drawLatestPreview();
      return;
    }
    if (previewFramePending) {
      return;
    }
    previewFramePending = true;
    const frameId = requestAnimationFrame(() => {
      previewFramePending = false;
      previewFrameId = null;
      drawLatestPreview();
    });
    if (previewFramePending) {
      previewFrameId = frameId;
    }
  };

  const complete = (cancel: boolean, endReason: InkEndReason) => {
    if (!isDrawing) {
      return;
    }
    const finalSample = finishInkResampling(resamplerState);
    if (finalSample) {
      const capability = capabilityProbe.snapshot(activePointerType);
      const strategy = resolveStrategy(capability.pressureCapability);
      const lastPoint = points[points.length - 1];
      const drawOptions = getFreehandDrawOptions(board);
      const finalWidth = mapInkSampleWidth(
        finalSample,
        strategy,
        drawOptions.strokeWidth ?? 2,
        previousWidth,
        getFreehandInkPluginOptions(board).sensitivity ?? 1
      );
      if (
        lastPoint &&
        lastPoint[0] === finalSample.point[0] &&
        lastPoint[1] === finalSample.point[1]
      ) {
        widths[widths.length - 1] = finalWidth;
      } else if (points.length < MAX_FREEHAND_INK_SAMPLES) {
        points.push(finalSample.point);
        widths.push(finalWidth);
      } else {
        // The final endpoint is omitted because this stroke has reached its
        // documented capture budget; earlier accepted geometry remains valid.
      }
    }
    if (isSnappingStartAndEnd && points.length > 0) {
      if (points.length < MAX_FREEHAND_INK_SAMPLES) {
        points.push(points[0]);
        widths.push(widths[0]);
      } else {
        // Closing the path is omitted at the capture budget rather than
        // producing an invalid points/widths length.
      }
    }
    temporaryElement = createPressureElement(board, points, widths, usedHardwarePressure, true);
    if (!cancel && points.length > 0) {
      Transforms.insertNode(board, temporaryElement, [board.children.length]);
    }
    const syntheticBatch = lastPressureBatch
      ? {
          ...lastPressureBatch,
          samples: lastPressureBatch.samples.slice(-1),
          receivedSamples: 0,
          droppedSamples: 0,
          coalescedSamples: 0,
        }
      : emptyBatchForEnd(activePointerId ?? -1);
    emitDiagnostic(syntheticBatch, [], 0, endReason, capabilityProbe.snapshot(activePointerType));
    reset();
  };

  board.pointerDown = (event: PointerEvent) => {
    const mode = resolveInkMode(board);
    if (mode !== 'probe' && probePointerId !== null) {
      handoffProbeToLegacyFallback();
    }
    if (isDrawing && event.pointerId !== activePointerId) {
      const pointerId = activePointerId;
      complete(true, 'two-finger-navigation');
      cancelLegacyStroke();
      pointerCancel(toPointerCancelEvent('two-finger-navigation', pointerId));
      return;
    }
    const isFreehandPointer = PlaitBoard.isInPointer(board, getFreehandPointers());
    const canStart = isFreehandPointer && isDrawingMode(board) && isMainPointer(event);
    if (mode === 'probe') {
      if (canStart) {
        capabilityProbe = new InkCapabilityProbe();
        monotonicState = { lastSample: null };
        previousDiagnosticSample = null;
        probePointerId = event.pointerId;
        observeOnly(event);
      }
      pointerDown(event);
      return;
    }
    if (mode !== 'pressure' || event.pointerType !== 'pen' || !canStart) {
      if (mode === 'pressure' && event.pointerType !== 'pen' && canStart) {
        legacyFallbackPointerId = event.pointerId;
      }
      pointerDown(event);
      return;
    }
    if (isDrawing) {
      complete(true, 'two-finger-navigation');
    }
    capabilityProbe = new InkCapabilityProbe();
    probePointerId = null;
    lastPressureBatch = null;
    isDrawing = true;
    activePointerId = event.pointerId;
    activePointerType = 'pen';
    originScreenPoint = [event.clientX, event.clientY];
    captureTarget = event.currentTarget instanceof Element ? event.currentTarget : null;
    if (captureTarget && 'setPointerCapture' in captureTarget) {
      try {
        captureTarget.setPointerCapture(event.pointerId);
      } catch {
        captureTarget = null;
      }
    }
    processPressureEvent(event);
    redrawPreview();
    pointerDown(event);
  };

  board.pointerMove = (event: PointerEvent) => {
    const mode = resolveInkMode(board);
    if (mode !== 'probe' && probePointerId !== null) {
      handoffProbeToLegacyFallback();
    }
    if (isDrawing && mode !== 'pressure') {
      complete(true, 'pointer-cancel');
      pointerCancel(toPointerCancelEvent('pointer-cancel', event.pointerId));
    }
    if (mode === 'probe') {
      if (probePointerId === event.pointerId) {
        observeOnly(event);
      }
      pointerMove(event);
      return;
    }
    if (mode !== 'pressure' || !isDrawing) {
      pointerMove(event);
      return;
    }
    if (event.pointerId !== activePointerId) {
      return;
    }
    if (isTwoFingerMode(board)) {
      const pointerId = activePointerId;
      complete(true, 'two-finger-navigation');
      pointerCancel(toPointerCancelEvent('two-finger-navigation', pointerId));
      return;
    }
    const currentScreenPoint: Point = [event.clientX, event.clientY];
    isSnappingStartAndEnd =
      originScreenPoint !== null &&
      distanceBetweenPointAndPoint(
        originScreenPoint[0],
        originScreenPoint[1],
        currentScreenPoint[0],
        currentScreenPoint[1]
      ) < 8;
    if (!captureCapped) {
      processPressureEvent(event);
      redrawPreview();
    } else {
      recordCappedInput(event);
    }
  };

  board.pointerUp = (event: PointerEvent) => {
    const mode = resolveInkMode(board);
    if (mode !== 'probe' && probePointerId !== null) {
      handoffProbeToLegacyFallback();
    }
    if (isDrawing && mode !== 'pressure') {
      complete(true, 'pointer-cancel');
      pointerCancel(toPointerCancelEvent('pointer-cancel', event.pointerId));
    }
    if (mode === 'pressure' && isDrawing && event.pointerId !== activePointerId) {
      return;
    }
    if (mode === 'probe' && probePointerId === event.pointerId) {
      observeOnly(event, 'pointer-up');
      stopProbe();
    }
    if (mode === 'pressure' && isDrawing && event.pointerId === activePointerId) {
      if (originScreenPoint) {
        isSnappingStartAndEnd =
          distanceBetweenPointAndPoint(
            originScreenPoint[0],
            originScreenPoint[1],
            event.clientX,
            event.clientY
          ) < 8;
      }
      if (!captureCapped) {
        processPressureEvent(event, monotonicState.lastSample?.pressure);
      } else {
        recordCappedInput(event);
      }
      complete(false, 'pointer-up');
    }
    pointerUp(event);
    if (legacyFallbackPointerId === event.pointerId) {
      legacyFallbackPointerId = null;
    }
  };

  board.pointerCancel = (event: PointerEvent) => {
    const mode = resolveInkMode(board);
    const matchesProbe =
      probePointerId !== null &&
      (event.type === 'orientationchange' ||
        event.type === 'viewportresize' ||
        event.pointerId === probePointerId);
    const matchesLegacyFallback =
      legacyFallbackPointerId !== null &&
      (event.type === 'orientationchange' ||
        event.type === 'viewportresize' ||
        event.pointerId === legacyFallbackPointerId);
    const reason =
      event.type === 'lostpointercapture'
        ? 'lost-pointer-capture'
        : event.type === 'orientationchange'
          ? 'orientation-change'
          : event.type === 'viewportresize'
            ? 'viewport-change'
            : 'pointer-cancel';
    const cancelsEveryPointer =
      event.type === 'orientationchange' || event.type === 'viewportresize';
    if (
      mode === 'pressure' &&
      isDrawing &&
      !cancelsEveryPointer &&
      event.pointerId !== activePointerId
    ) {
      return;
    }
    if (matchesProbe) {
      if (mode === 'probe') {
        observeOnly(event, reason);
      }
      cancelLegacyStroke();
      stopProbe();
    }
    if (isDrawing && (event.pointerId === activePointerId || cancelsEveryPointer)) {
      complete(true, reason);
    }
    pointerCancel(event);
    if (matchesLegacyFallback) {
      cancelLegacyStroke();
      legacyFallbackPointerId = null;
    }
  };

  board.globalPointerUp = (event: PointerEvent) => {
    const mode = resolveInkMode(board);
    if (mode !== 'probe' && probePointerId !== null) {
      handoffProbeToLegacyFallback();
    }
    if (mode === 'pressure' && isDrawing && event.pointerId !== activePointerId) {
      return;
    }
    if (isDrawing && event.pointerId === activePointerId) {
      complete(true, 'global-pointer-up');
    }
    if (probePointerId === event.pointerId) {
      observeOnly(event, 'global-pointer-up');
      stopProbe();
    }
    globalPointerUp(event);
    if (legacyFallbackPointerId === event.pointerId) {
      legacyFallbackPointerId = null;
    }
  };

  board.apply = (operation: PlaitOperation) => {
    if (isDrawing && operation.type === 'set_viewport') {
      const pointerId = activePointerId;
      complete(true, 'viewport-change');
      pointerCancel(toPointerCancelEvent('viewport-change', pointerId));
    }
    apply(operation);
  };

  const disposePointerLifecycle = setBoardPointerLifecycleHandler(
    board,
    (event: BoardPointerLifecycleEvent) => {
      const cancelsEveryPointer = event.pointerId === undefined;
      const matchesProbe =
        probePointerId !== null && (cancelsEveryPointer || event.pointerId === probePointerId);
      const matchesPressure =
        isDrawing && (cancelsEveryPointer || event.pointerId === activePointerId);
      const matchesLegacyFallback =
        legacyFallbackPointerId !== null &&
        (cancelsEveryPointer || event.pointerId === legacyFallbackPointerId);
      if (!matchesProbe && !matchesPressure && !matchesLegacyFallback) {
        return;
      }

      const mode = resolveInkMode(board);
      const pointerId =
        event.pointerId ?? probePointerId ?? activePointerId ?? legacyFallbackPointerId;
      if (mode === 'legacy') {
        // This event matches input that started while an experimental mode was
        // active. Release those resources and still unwind the captured Plait
        // and legacy handler chain. Events that started with the feature off
        // returned above because they have no tracked pointer identity.
        if (matchesProbe || matchesLegacyFallback) {
          cancelLegacyStroke();
        }
        reset();
        pointerCancel(toPointerCancelEvent(event.reason, pointerId));
        return;
      }
      if (matchesProbe) {
        emitLifecycleDiagnostic(event.reason);
        cancelLegacyStroke();
        stopProbe();
      }
      if (matchesPressure) {
        complete(true, event.reason);
      }
      if (matchesLegacyFallback) {
        cancelLegacyStroke();
        legacyFallbackPointerId = null;
      }
      pointerCancel(toPointerCancelEvent(event.reason, pointerId));
    }
  );
  let inputLifecycleDisposed = false;
  registerFreehandInkLifecycleDisposer(board, () => {
    if (inputLifecycleDisposed) {
      return;
    }
    inputLifecycleDisposed = true;
    try {
      disposePointerLifecycle();
    } finally {
      // Owner disposal is a silent teardown: no persisted element and no
      // terminal diagnostic may escape after the board session has ended.
      try {
        cancelLegacyStroke();
      } finally {
        reset();
      }
    }
  });

  return board;

  function emitLifecycleDiagnostic(reason: InkEndReason): void {
    const batch = lastPressureBatch
      ? {
          ...lastPressureBatch,
          samples: lastPressureBatch.samples.slice(-1),
          receivedSamples: 0,
          droppedSamples: 0,
          coalescedSamples: 0,
        }
      : emptyBatchForEnd(probePointerId ?? -1);
    emitDiagnostic(batch, [], 0, reason, capabilityProbe.snapshot(batch.identity.pointerType));
    monotonicState = { lastSample: null };
    previousDiagnosticSample = null;
  }

  function recordCappedInput(event: PointerEvent): void {
    const batch = extractInkSampleBatch(event);
    lastPressureBatch = batch;
    const monotonic = acceptMonotonicInkSamples(monotonicState, batch.samples);
    monotonicState = monotonic.state;
    const capability = capabilityProbe.observe(batch.identity, monotonic.accepted, batch.apis);
    emitDiagnostic(
      batch,
      monotonic.accepted,
      monotonic.droppedSamples,
      undefined,
      capability,
      monotonic.accepted.length,
      true
    );
  }
}

function toPointerCancelEvent(reason: InkEndReason, pointerId: number | null): PointerEvent {
  const type =
    reason === 'lost-pointer-capture'
      ? 'lostpointercapture'
      : reason === 'orientation-change'
        ? 'orientationchange'
        : reason === 'viewport-change'
          ? 'viewportresize'
          : 'pointercancel';
  return { pointerId: pointerId ?? -1, type } as PointerEvent;
}

function createPressureElement(
  board: PlaitBoard,
  points: Point[],
  widths: number[],
  includeInk: boolean,
  compact: boolean
): Freehand {
  const pointer = PlaitBoard.getPointer(board) as FreehandShape;
  const element = createFreehandElement(pointer, points, getFreehandDrawOptions(board));
  const ink = includeInk
    ? compact
      ? compactFreehandInkWidths(widths, points.length)
      : {
          version: 1 as const,
          widths,
        }
    : undefined;
  return ink ? { ...element, ink } : element;
}

function resolveInkMode(board: PlaitBoard): FreehandInkMode {
  try {
    return getFreehandInkPluginOptions(board).getMode();
  } catch {
    return 'legacy';
  }
}

function resolveStrategy(capability: string): InkStrategy {
  return capability === 'variable-observed' ? 'hardware-pressure' : 'fixed-width';
}

function emptyBatchForEnd(pointerId: number): ExtractedInkSampleBatch {
  return {
    identity: {
      pointerId,
      pointerType: 'unknown',
      button: -1,
      buttons: 0,
      isPrimary: true,
    },
    source: 'parent',
    samples: [],
    receivedSamples: 0,
    droppedSamples: 0,
    coalescedSamples: 0,
    apis: { coalescedEvents: false, predictedEvents: false, pointerRawUpdate: false },
  };
}

function shouldEmitDiagnostics(predicate: (() => boolean) | undefined): boolean {
  if (!predicate) {
    return true;
  }
  try {
    return predicate();
  } catch {
    return false;
  }
}
