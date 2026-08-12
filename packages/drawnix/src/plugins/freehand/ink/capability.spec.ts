import { describe, expect, it } from 'vitest';
import { InkCapabilityProbe } from './capability';
import type { InkApiAvailability, InkPointerIdentity, InkSample } from './types';

const noApis: InkApiAvailability = {
  coalescedEvents: false,
  predictedEvents: false,
  pointerRawUpdate: false,
};

function identity(pointerType: InkPointerIdentity['pointerType'], buttons = 1): InkPointerIdentity {
  return { pointerId: 1, pointerType, button: 0, buttons, isPrimary: true };
}

function pressures(values: readonly number[]): InkSample[] {
  return values.map((pressure, index) => ({
    point: [index, 0],
    time: index,
    pressure,
  }));
}

describe('freehand ink capability probe', () => {
  it('requires repeated active pen samples before classifying the 0.5 fallback', () => {
    const probe = new InkCapabilityProbe();

    expect(
      probe.observe(identity('pen'), pressures([0.5, 0.5, 0.5]), noApis).pressureCapability
    ).toBe('unknown');
    expect(probe.observe(identity('pen'), pressures([0.5]), noApis).pressureCapability).toBe(
      'fallback-0.5-suspected'
    );
  });

  it('classifies sufficiently varying active pen pressure as variable', () => {
    const probe = new InkCapabilityProbe();
    const snapshot = probe.observe(identity('pen'), pressures([0.18, 0.31, 0.52, 0.82]), noApis);

    expect(snapshot.pressureCapability).toBe('variable-observed');
    expect(snapshot.pressure).toEqual({
      min: 0.18,
      max: 0.82,
      distinctBuckets: 4,
      variation: 'varying',
    });
  });

  it.each(['pen', 'touch'] as const)(
    'requires repeated active %s samples before classifying zero pressure as none',
    (pointerType) => {
      const probe = new InkCapabilityProbe();

      expect(
        probe.observe(identity(pointerType), pressures([0, 0, 0]), noApis).pressureCapability
      ).toBe('unknown');
      expect(probe.observe(identity(pointerType), pressures([0]), noApis).pressureCapability).toBe(
        'none'
      );
    }
  );

  it('keeps mouse, touch, and pen pressure observations isolated', () => {
    const probe = new InkCapabilityProbe();

    probe.observe(identity('mouse'), pressures([0.5, 0.5, 0.5, 0.5]), noApis);
    probe.observe(identity('touch'), pressures([0, 0, 0, 0]), noApis);

    expect(probe.snapshot('mouse').pressureCapability).toBe('fallback-0.5-suspected');
    expect(probe.snapshot('touch').pressureCapability).toBe('none');
    expect(probe.snapshot('pen').pressureCapability).toBe('unknown');
    expect(probe.snapshot('pen').pressure).toBeNull();
  });

  it('does not let an inactive pointerup pressure of zero pollute active capability', () => {
    const probe = new InkCapabilityProbe();

    probe.observe(identity('pen'), pressures([0.2, 0.35, 0.55, 0.8]), noApis);
    const afterPointerUp = probe.observe(identity('pen', 0), pressures([0]), noApis);

    expect(afterPointerUp.pressureCapability).toBe('variable-observed');
    expect(afterPointerUp.pressure).toEqual({
      min: 0.2,
      max: 0.8,
      distinctBuckets: 4,
      variation: 'varying',
    });

    const inactiveOnly = new InkCapabilityProbe().observe(
      identity('pen', 0),
      pressures([0]),
      noApis
    );
    expect(inactiveOnly.pressure).toBeNull();
    expect(inactiveOnly.pressureCapability).toBe('unknown');
  });
});
