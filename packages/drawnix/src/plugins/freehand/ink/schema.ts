import {
  FREEHAND_INK_SCHEMA_VERSION,
  MAX_FREEHAND_INK_SAMPLES,
  MAX_FREEHAND_INK_WIDTH,
  MIN_FREEHAND_INK_WIDTH,
  type FreehandInkData,
} from './types';

export function isValidFreehandInkData(
  value: unknown,
  expectedPointCount?: number
): value is FreehandInkData {
  if (!isRecord(value) || value.version !== FREEHAND_INK_SCHEMA_VERSION) {
    return false;
  }
  if (
    Object.keys(value).some((key) => key !== 'version' && key !== 'widths') ||
    !Array.isArray(value.widths) ||
    value.widths.length === 0 ||
    value.widths.length > MAX_FREEHAND_INK_SAMPLES
  ) {
    return false;
  }
  if (expectedPointCount !== undefined && value.widths.length !== expectedPointCount) {
    return false;
  }
  for (let index = 0; index < value.widths.length; index += 1) {
    if (!(index in value.widths)) {
      return false;
    }
    const width = value.widths[index];
    if (
      typeof width !== 'number' ||
      !Number.isFinite(width) ||
      width < MIN_FREEHAND_INK_WIDTH ||
      width > MAX_FREEHAND_INK_WIDTH
    ) {
      return false;
    }
  }
  return true;
}

export function compactFreehandInkWidths(
  widths: readonly number[],
  expectedPointCount: number
): FreehandInkData | undefined {
  if (widths.length !== expectedPointCount || widths.length === 0) {
    return undefined;
  }
  const compact = widths.map((width) => Math.round(width * 100) / 100);
  const data: FreehandInkData = {
    version: FREEHAND_INK_SCHEMA_VERSION,
    widths: compact,
  };
  return isValidFreehandInkData(data, expectedPointCount) ? data : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
