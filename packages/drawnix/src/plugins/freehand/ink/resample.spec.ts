import { describe, expect, it } from 'vitest';
import {
  createInkResamplerState,
  finishInkResampling,
  MAX_RESAMPLED_INK_SAMPLES_PER_BATCH,
  resampleInkSamples,
} from './resample';
import type { InkSample } from './types';

function sample(x: number, y: number, time: number, pressure = 0.5): InkSample {
  return { point: [x, y], time, pressure };
}

describe('freehand ink resampling', () => {
  it('is deterministic and produces the same result across equivalent chunks', () => {
    const input = [sample(0, 0, 0, 0.2), sample(4, 2, 4, 0.5), sample(8, 0, 8, 0.8)];
    const oneBatch = resampleInkSamples(createInkResamplerState(), input, 1, 0.25);
    const repeat = resampleInkSamples(createInkResamplerState(), input, 1, 0.25);

    const firstChunk = resampleInkSamples(createInkResamplerState(), input.slice(0, 2), 1, 0.25);
    const secondChunk = resampleInkSamples(firstChunk.state, input.slice(2), 1, 0.25);

    expect(repeat).toEqual(oneBatch);
    expect([...firstChunk.samples, ...secondChunk.samples]).toEqual(oneBatch.samples);
    expect(secondChunk.state).toEqual(oneBatch.state);
  });

  it('maps NaN configuration to deterministic safe defaults', () => {
    const input = [sample(0, 0, 0), sample(2, 0, 2)];
    const invalid = resampleInkSamples(createInkResamplerState(), input, Number.NaN, Number.NaN);
    const explicitDefaults = resampleInkSamples(createInkResamplerState(), input, 0.25, 0);

    expect(invalid).toEqual(explicitDefaults);
    expect(invalid.samples.every(({ point }) => point.every(Number.isFinite))).toBe(true);
  });

  it('keeps huge finite distances bounded without corrupting continuation state', () => {
    const result = resampleInkSamples(
      createInkResamplerState(),
      [sample(0, 0, 0), sample(1_000_000_000_000, 0, 1)],
      32,
      0
    );

    expect(result.samples.length).toBeLessThanOrEqual(MAX_RESAMPLED_INK_SAMPLES_PER_BATCH);
    expect(result.droppedSamples).toBeGreaterThan(MAX_RESAMPLED_INK_SAMPLES_PER_BATCH);
    expect(result.samples.every(({ point }) => point.every(Number.isFinite))).toBe(true);
    expect(Number.isFinite(result.state.remainingDistance)).toBe(true);
    expect(result.state.remainingDistance).toBeGreaterThanOrEqual(0);
    expect(result.state.remainingDistance).toBeLessThanOrEqual(32);
  });

  it('enforces the per-batch output cap', () => {
    const result = resampleInkSamples(
      createInkResamplerState(),
      [sample(0, 0, 0), sample(3_000, 0, 3_000)],
      0.25,
      0
    );

    expect(result.samples).toHaveLength(MAX_RESAMPLED_INK_SAMPLES_PER_BATCH);
    expect(result.droppedSamples).toBe(3_809);
  });

  it('retains the final stationary pressure sample for final-width replacement', () => {
    const result = resampleInkSamples(
      createInkResamplerState(),
      [sample(4, 8, 1, 0.2), sample(4, 8, 2, 0.9)],
      1,
      0
    );

    expect(result.samples).toHaveLength(1);
    expect(finishInkResampling(result.state)).toEqual(sample(4, 8, 2, 0.9));
  });
});
