import {
  buildFreehandInkPlugin,
  type FreehandInkDiagnostic,
  type FreehandInkMode,
} from '@drawnix/drawnix';
import type {
  MagicInkApiAvailability,
  MagicInkDiagnosticsEntry,
  MagicInkEndReason,
  MagicInkVariation,
} from '@magic-blackboard/core';
import type { MagicRuntime } from '@magic-blackboard/runtime';
import type { PlaitPlugin } from '@plait/core';

export const MAGIC_INK_DIAGNOSTICS_FEATURE_ID = 'magic.ink-diagnostics';
export const MAGIC_PRESSURE_INK_FEATURE_ID = 'magic.pressure-ink';

export function createMagicInkFeatureDefinitions(available: boolean) {
  return [
    {
      id: MAGIC_INK_DIAGNOSTICS_FEATURE_ID,
      title: 'Ink diagnostics',
      description: 'Session-only, bounded input capability summaries; no raw coordinates persist.',
      defaultEnabled: false,
      available,
    },
    {
      id: MAGIC_PRESSURE_INK_FEATURE_ID,
      title: 'Pressure ink (experimental)',
      description: 'Uses verified variable pen pressure; fixed-width fallback stays available.',
      defaultEnabled: false,
      available,
    },
  ] as const;
}

export class MagicInkController {
  readonly #runtime: MagicRuntime;
  #disposed = false;
  #disposeInput: (() => void) | null = null;

  constructor(runtime: MagicRuntime) {
    this.#runtime = runtime;
  }

  asPlugin(): PlaitPlugin {
    return buildFreehandInkPlugin({
      getMode: () => this.#mode(),
      shouldEmitDiagnostics: () => this.#diagnosticsEnabled(),
      onLifecycleRegistration: (dispose) => {
        this.#disposeInput = dispose;
      },
      onDiagnostic: (diagnostic) => this.#record(diagnostic),
    });
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const disposeInput = this.#disposeInput;
    this.#disposeInput = null;
    disposeInput?.();
  }

  #mode(): FreehandInkMode {
    if (this.#disposed || this.#runtime.disposed) {
      return 'legacy';
    }
    if (this.#runtime.features.isEnabled(MAGIC_PRESSURE_INK_FEATURE_ID)) {
      return 'pressure';
    }
    return this.#runtime.features.isEnabled(MAGIC_INK_DIAGNOSTICS_FEATURE_ID) ? 'probe' : 'legacy';
  }

  #record(diagnostic: FreehandInkDiagnostic): void {
    if (!this.#diagnosticsEnabled()) {
      return;
    }
    this.#runtime.inkDiagnostics.record(toMagicInkDiagnostic(diagnostic));
  }

  #diagnosticsEnabled(): boolean {
    return (
      !this.#disposed &&
      !this.#runtime.disposed &&
      this.#runtime.features.isEnabled(MAGIC_INK_DIAGNOSTICS_FEATURE_ID)
    );
  }
}

export function toMagicInkDiagnostic(diagnostic: FreehandInkDiagnostic): MagicInkDiagnosticsEntry {
  const pressure = diagnostic.capability.pressure;
  return {
    observedAt: diagnostic.observedAt,
    pointerType: diagnostic.pointerType,
    isPrimary: diagnostic.isPrimary,
    button: diagnostic.button,
    buttons: diagnostic.buttons,
    source: diagnostic.source,
    strategy: diagnostic.strategy,
    receivedSamples: diagnostic.receivedSamples,
    acceptedSamples: diagnostic.acceptedSamples,
    coalescedSamples: diagnostic.coalescedSamples,
    droppedSamples: diagnostic.droppedSamples,
    geometryDroppedSamples: diagnostic.geometryDroppedSamples ?? 0,
    captureCapped: diagnostic.captureCapped === true,
    ...(diagnostic.intervalMs
      ? {
          interval: {
            intervalCount: diagnostic.intervalMs.count,
            minimumMs: diagnostic.intervalMs.min,
            maximumMs: diagnostic.intervalMs.max,
            meanMs: diagnostic.intervalMs.mean,
          },
        }
      : {}),
    pressure: {
      capability: diagnostic.capability.pressureCapability,
      ...(pressure ? { minimum: pressure.min, maximum: pressure.max } : {}),
      distinctBucketCount: pressure?.distinctBuckets ?? 0,
    },
    tilt: {
      x: variation(diagnostic.capability.tiltX),
      y: variation(diagnostic.capability.tiltY),
    },
    angles: {
      altitude: variation(diagnostic.capability.altitudeAngle),
      azimuth: variation(diagnostic.capability.azimuthAngle),
      twist: variation(diagnostic.capability.twist),
    },
    contact: {
      width: variation(diagnostic.capability.contactWidth),
      height: variation(diagnostic.capability.contactHeight),
    },
    apis: {
      coalescedEvents: availability(diagnostic.capability.apis.coalescedEvents),
      predictedEvents: availability(diagnostic.capability.apis.predictedEvents),
      pointerRawUpdate: availability(diagnostic.capability.apis.pointerRawUpdate),
    },
    ...(diagnostic.endReason ? { endReason: endReason(diagnostic.endReason) } : {}),
  };
}

function variation(summary: { readonly variation: MagicInkVariation } | null): MagicInkVariation {
  return summary?.variation ?? 'unobserved';
}

function availability(available: boolean): MagicInkApiAvailability {
  return available ? 'available' : 'unavailable';
}

function endReason(reason: NonNullable<FreehandInkDiagnostic['endReason']>): MagicInkEndReason {
  return reason === 'pointer-up' ? 'completed' : reason;
}
