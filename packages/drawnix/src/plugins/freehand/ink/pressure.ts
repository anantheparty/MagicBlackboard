import { MAX_FREEHAND_INK_WIDTH, type InkSample, type InkStrategy } from './types';

export type PressureCurveOptions = {
  readonly minimumFactor?: number;
  readonly maximumFactor?: number;
  readonly sensitivity?: number;
};

const DEFAULT_MINIMUM_FACTOR = 0.35;
const DEFAULT_MAXIMUM_FACTOR = 1.65;

export function normalizeInkPressure(pressure: number, sensitivity = 1): number {
  const clampedPressure = clamp(pressure, 0, 1);
  const clampedSensitivity = clamp(sensitivity, 0.25, 4);
  return Math.pow(clampedPressure, 1 / clampedSensitivity);
}

export function mapPressureToWidth(
  pressure: number,
  baseWidth: number,
  options: PressureCurveOptions = {}
): number {
  const minimumFactor = clamp(options.minimumFactor ?? DEFAULT_MINIMUM_FACTOR, 0.1, 1);
  const maximumFactor = clamp(options.maximumFactor ?? DEFAULT_MAXIMUM_FACTOR, 1, 3);
  const safeBaseWidth = clamp(baseWidth, 0.01, MAX_FREEHAND_INK_WIDTH);
  const normalized = normalizeInkPressure(pressure, options.sensitivity);
  const eased = normalized * normalized * (3 - 2 * normalized);
  return clamp(
    safeBaseWidth * (minimumFactor + (maximumFactor - minimumFactor) * eased),
    0.01,
    MAX_FREEHAND_INK_WIDTH
  );
}

export function mapInkSampleWidth(
  sample: InkSample,
  strategy: InkStrategy,
  baseWidth: number,
  previousWidth: number | null,
  sensitivity = 1
): number {
  const safeBaseWidth = clamp(baseWidth, 0.01, MAX_FREEHAND_INK_WIDTH);
  const target =
    strategy === 'hardware-pressure' && sample.pressure !== undefined
      ? mapPressureToWidth(sample.pressure, safeBaseWidth, { sensitivity })
      : safeBaseWidth;
  if (previousWidth === null) {
    return clamp(target, 0.01, MAX_FREEHAND_INK_WIDTH);
  }
  // Width smoothing is deliberately separate from point smoothing. It keeps
  // capability transitions continuous without retaining raw event history.
  return clamp(previousWidth + (target - previousWidth) * 0.4, 0.01, MAX_FREEHAND_INK_WIDTH);
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}
