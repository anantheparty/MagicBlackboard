import type { Point } from '@plait/core';
import type { InkSample } from './types';

export type InkResamplerState = {
  readonly lastInput: InkSample | null;
  readonly previousInput: InkSample | null;
  readonly previousSmoothedPoint: Point | null;
  readonly remainingDistance: number;
  readonly lastOutput: InkSample | null;
};

export type InkResampleResult = {
  readonly samples: readonly InkSample[];
  readonly droppedSamples: number;
  readonly state: InkResamplerState;
};

export const MAX_RESAMPLED_INK_SAMPLES_PER_BATCH = 8192;

export function createInkResamplerState(): InkResamplerState {
  return {
    lastInput: null,
    previousInput: null,
    previousSmoothedPoint: null,
    remainingDistance: 0,
    lastOutput: null,
  };
}

export function resampleInkSamples(
  initialState: InkResamplerState,
  samples: readonly InkSample[],
  spacing = 1.5,
  smoothing = 0.7
): InkResampleResult {
  const safeSpacing = clamp(spacing, 0.25, 32);
  const smoothingFactor = clamp(smoothing, 0, 0.95);
  let state = initialState;
  const output: InkSample[] = [];
  let droppedSamples = 0;

  for (const sample of samples) {
    const smoothedPoint = smoothPoint(state.previousSmoothedPoint, sample.point, smoothingFactor);
    const smoothedSample = { ...sample, point: smoothedPoint };
    if (!state.previousInput) {
      output.push(smoothedSample);
      state = {
        lastInput: sample,
        previousInput: smoothedSample,
        previousSmoothedPoint: smoothedPoint,
        remainingDistance: safeSpacing,
        lastOutput: smoothedSample,
      };
      continue;
    }

    const start = state.previousInput;
    const segmentDistance = distance(start.point, smoothedPoint);
    if (!Number.isFinite(segmentDistance)) {
      droppedSamples += 1;
      continue;
    }
    if (segmentDistance === 0) {
      state = {
        ...state,
        lastInput: sample,
        previousInput: smoothedSample,
        previousSmoothedPoint: smoothedPoint,
      };
      continue;
    }

    let distanceAlong = state.remainingDistance;
    let lastOutput = state.lastOutput;
    let truncated = false;
    while (distanceAlong <= segmentDistance) {
      if (output.length >= MAX_RESAMPLED_INK_SAMPLES_PER_BATCH) {
        droppedSamples = saturatingAdd(
          droppedSamples,
          Math.floor((segmentDistance - distanceAlong) / safeSpacing) + 1
        );
        truncated = true;
        break;
      }
      const ratio = distanceAlong / segmentDistance;
      const resampled = interpolateSample(start, smoothedSample, ratio);
      output.push(resampled);
      lastOutput = resampled;
      distanceAlong += safeSpacing;
    }

    state = truncated
      ? {
          // Skip the unrepresentable remainder of an abnormal segment. The
          // next batch starts at this finite endpoint with a valid spacing
          // budget instead of extrapolating from a negative remainder.
          previousInput: smoothedSample,
          lastInput: sample,
          previousSmoothedPoint: smoothedPoint,
          remainingDistance: safeSpacing,
          lastOutput,
        }
      : {
          previousInput: smoothedSample,
          lastInput: sample,
          previousSmoothedPoint: smoothedPoint,
          remainingDistance: distanceAlong - segmentDistance,
          lastOutput,
        };
  }

  return { samples: output, droppedSamples, state };
}

export function finishInkResampling(state: InkResamplerState): InkSample | null {
  // Returning the last input even when it shares the last output coordinate
  // lets the caller replace the final width after stationary pressure changes.
  return state.lastInput;
}

function smoothPoint(previous: Point | null, current: Point, smoothing: number): Point {
  if (!previous) {
    return [...current];
  }
  const currentWeight = 1 - smoothing;
  return [
    previous[0] * smoothing + current[0] * currentWeight,
    previous[1] * smoothing + current[1] * currentWeight,
  ];
}

function interpolateSample(start: InkSample, end: InkSample, ratio: number): InkSample {
  return {
    point: [
      interpolate(start.point[0], end.point[0], ratio),
      interpolate(start.point[1], end.point[1], ratio),
    ],
    time: interpolate(start.time, end.time, ratio),
    ...interpolateOptional('pressure', start.pressure, end.pressure, ratio),
    ...interpolateOptional('tiltX', start.tiltX, end.tiltX, ratio),
    ...interpolateOptional('tiltY', start.tiltY, end.tiltY, ratio),
    ...interpolateOptional('altitudeAngle', start.altitudeAngle, end.altitudeAngle, ratio),
    ...interpolateOptional('azimuthAngle', start.azimuthAngle, end.azimuthAngle, ratio),
    ...interpolateOptional('twist', start.twist, end.twist, ratio),
    ...interpolateOptional('width', start.width, end.width, ratio),
    ...interpolateOptional('height', start.height, end.height, ratio),
  };
}

function interpolateOptional<Key extends keyof InkSample>(
  key: Key,
  start: number | undefined,
  end: number | undefined,
  ratio: number
): Partial<Pick<InkSample, Key>> {
  if (start === undefined || end === undefined) {
    return {};
  }
  return { [key]: interpolate(start, end, ratio) } as Partial<Pick<InkSample, Key>>;
}

function interpolate(start: number, end: number, ratio: number): number {
  return start + (end - start) * ratio;
}

function distance(start: Point, end: Point): number {
  return Math.hypot(end[0] - start[0], end[1] - start[1]);
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

function saturatingAdd(left: number, right: number): number {
  if (!Number.isFinite(right) || right >= Number.MAX_SAFE_INTEGER - left) {
    return Number.MAX_SAFE_INTEGER;
  }
  return left + Math.max(0, Math.floor(right));
}
