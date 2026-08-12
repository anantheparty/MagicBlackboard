import type { Point } from '@plait/core';

export const FREEHAND_INK_SCHEMA_VERSION = 1 as const;
// A single continuous stroke is intentionally bounded. At 240 Hz this still
// allows more than a minute of uninterrupted input while keeping import,
// outline construction, hit testing, and preview work predictable.
export const MAX_FREEHAND_INK_SAMPLES = 20_000;
// Legacy fixed-width strokes predate Pressure Ink V2 and did not have the
// pressure capture cap. Keep their import/export envelope wider so existing
// and default-off Drawnix documents do not become unreadable solely because
// they cross the new variable-width limit.
export const MAX_LEGACY_FREEHAND_POINTS = 100_000;
export const MIN_FREEHAND_INK_WIDTH = 0.01;
export const MAX_FREEHAND_INK_WIDTH = 96;
// Keep generated SVG geometry and resampling arithmetic within a practical,
// deterministic range even when a restored viewport is corrupt or an input
// event is constructed by script.
export const MAX_ABSOLUTE_INK_COORDINATE = 1_000_000_000;

export type FreehandInkData = {
  readonly version: typeof FREEHAND_INK_SCHEMA_VERSION;
  readonly widths: readonly number[];
};

export type FreehandInkMode = 'legacy' | 'probe' | 'pressure';
export type InkSampleSource = 'parent' | 'coalesced';
export type InkStrategy = 'fixed-width' | 'hardware-pressure';
export type InkPressureCapability =
  | 'unknown'
  | 'none'
  | 'fallback-0.5-suspected'
  | 'variable-observed';
export type InkVariation = 'unobserved' | 'constant' | 'varying';
export type InkEndReason =
  | 'pointer-up'
  | 'pointer-cancel'
  | 'lost-pointer-capture'
  | 'global-pointer-up'
  | 'two-finger-navigation'
  | 'viewport-change'
  | 'orientation-change';

export type InkSample = {
  readonly point: Point;
  readonly time: number;
  readonly pressure?: number;
  readonly tiltX?: number;
  readonly tiltY?: number;
  readonly altitudeAngle?: number;
  readonly azimuthAngle?: number;
  readonly twist?: number;
  readonly width?: number;
  readonly height?: number;
};

export type InkPointerIdentity = {
  readonly pointerId: number;
  readonly pointerType: 'mouse' | 'pen' | 'touch' | 'unknown';
  readonly button: number;
  readonly buttons: number;
  readonly isPrimary: boolean;
};

export type InkApiAvailability = {
  readonly coalescedEvents: boolean;
  readonly predictedEvents: boolean;
  readonly pointerRawUpdate: boolean;
};

export type InkRangeSummary = {
  readonly min: number;
  readonly max: number;
  readonly distinctBuckets: number;
  readonly variation: InkVariation;
};

export type InkIntervalSummary = InkRangeSummary & {
  readonly count: number;
  readonly mean: number;
};

export type InkCapabilitySnapshot = {
  readonly pressure: InkRangeSummary | null;
  readonly pressureCapability: InkPressureCapability;
  readonly tiltX: InkRangeSummary | null;
  readonly tiltY: InkRangeSummary | null;
  readonly altitudeAngle: InkRangeSummary | null;
  readonly azimuthAngle: InkRangeSummary | null;
  readonly contactWidth: InkRangeSummary | null;
  readonly contactHeight: InkRangeSummary | null;
  readonly twist: InkRangeSummary | null;
  readonly apis: InkApiAvailability;
};

export type FreehandInkDiagnostic = {
  readonly observedAt: number;
  readonly pointerType: InkPointerIdentity['pointerType'];
  readonly isPrimary: boolean;
  readonly button: number;
  readonly buttons: number;
  readonly source: InkSampleSource;
  readonly strategy: InkStrategy;
  readonly receivedSamples: number;
  readonly acceptedSamples: number;
  readonly coalescedSamples: number;
  /** Derived geometry points omitted by resampling or the stroke budget. */
  readonly geometryDroppedSamples?: number;
  readonly droppedSamples: number;
  readonly captureCapped?: boolean;
  readonly intervalMs?: InkIntervalSummary;
  readonly capability: InkCapabilitySnapshot;
  readonly endReason?: InkEndReason;
};

export type FreehandInkPluginOptions = {
  readonly getMode: () => FreehandInkMode;
  readonly shouldEmitDiagnostics?: () => boolean;
  readonly onLifecycleRegistration?: (dispose: () => void) => void;
  readonly onDiagnostic?: (diagnostic: FreehandInkDiagnostic) => void;
  readonly sensitivity?: number;
};

export type PointerEventLike = {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly buttons: number;
  readonly isPrimary: boolean;
  readonly clientX: number;
  readonly clientY: number;
  readonly timeStamp: number;
  readonly pressure?: number;
  readonly tiltX?: number;
  readonly tiltY?: number;
  readonly altitudeAngle?: number;
  readonly azimuthAngle?: number;
  readonly twist?: number;
  readonly width?: number;
  readonly height?: number;
  readonly getCoalescedEvents?: () => readonly PointerEventLike[];
  readonly getPredictedEvents?: () => readonly PointerEventLike[];
};

export type ExtractedInkSampleBatch = {
  readonly identity: InkPointerIdentity;
  readonly source: InkSampleSource;
  readonly samples: readonly InkSample[];
  readonly receivedSamples: number;
  readonly droppedSamples: number;
  readonly coalescedSamples: number;
  readonly apis: InkApiAvailability;
};
