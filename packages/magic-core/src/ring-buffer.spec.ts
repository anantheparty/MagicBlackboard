import { describe, expect, it } from 'vitest';
import { BoundedRingBuffer } from './ring-buffer';

describe('BoundedRingBuffer', () => {
  it('keeps insertion order while evicting the oldest value', () => {
    const buffer = new BoundedRingBuffer<number>(3);

    expect(buffer.push(1)).toBeUndefined();
    buffer.push(2);
    buffer.push(3);
    expect(buffer.push(4)).toBe(1);

    expect(buffer.size).toBe(3);
    expect(buffer.isFull).toBe(true);
    expect(buffer.toArray()).toEqual([2, 3, 4]);
    expect(buffer.at(0)).toBe(2);
    expect(buffer.at(-1)).toBe(4);
  });

  it('clears retained references and validates capacity', () => {
    const buffer = new BoundedRingBuffer<object>(2);
    buffer.push({ value: 1 });
    buffer.clear();

    expect(buffer.toArray()).toEqual([]);
    expect(buffer.isEmpty).toBe(true);
    expect(() => new BoundedRingBuffer(0)).toThrow(RangeError);
  });
});
