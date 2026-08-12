/**
 * A fixed-capacity FIFO buffer. Pushing into a full buffer evicts the oldest
 * value without reallocating the backing array.
 */
export class BoundedRingBuffer<Value> {
  readonly capacity: number;

  #items: Array<Value | undefined>;
  #head = 0;
  #size = 0;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError('Ring buffer capacity must be a positive safe integer.');
    }

    this.capacity = capacity;
    this.#items = Array.from<Value | undefined>({ length: capacity });
  }

  get size(): number {
    return this.#size;
  }

  get isEmpty(): boolean {
    return this.#size === 0;
  }

  get isFull(): boolean {
    return this.#size === this.capacity;
  }

  push(value: Value): Value | undefined {
    if (this.#size < this.capacity) {
      const tail = (this.#head + this.#size) % this.capacity;
      this.#items[tail] = value;
      this.#size += 1;
      return undefined;
    }

    const evicted = this.#items[this.#head];
    this.#items[this.#head] = value;
    this.#head = (this.#head + 1) % this.capacity;
    return evicted;
  }

  at(index: number): Value | undefined {
    const normalizedIndex = index < 0 ? this.#size + index : index;
    if (
      !Number.isInteger(normalizedIndex) ||
      normalizedIndex < 0 ||
      normalizedIndex >= this.#size
    ) {
      return undefined;
    }

    return this.#items[(this.#head + normalizedIndex) % this.capacity];
  }

  toArray(): Value[] {
    const values: Value[] = [];
    for (let index = 0; index < this.#size; index += 1) {
      values.push(this.#items[(this.#head + index) % this.capacity] as Value);
    }
    return values;
  }

  clear(): void {
    this.#items = Array.from<Value | undefined>({ length: this.capacity });
    this.#head = 0;
    this.#size = 0;
  }
}
