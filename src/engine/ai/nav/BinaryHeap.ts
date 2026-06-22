/**
 * Min-heap binario indexado por una clave numerica externa. Disenado para que
 * A* lo reutilice entre llamadas sin allocations: `clear()` resetea length sin
 * tocar capacidad. La clave (`f-score`) se almacena en un array paralelo a los
 * valores (indices de celda), evitando el costo de struct-of-arrays vs
 * array-of-structs en V8.
 */
export class BinaryHeap {
  private readonly values: number[] = [];
  private readonly keys: number[] = [];

  size(): number {
    return this.values.length;
  }

  clear(): void {
    this.values.length = 0;
    this.keys.length = 0;
  }

  push(value: number, key: number): void {
    this.values.push(value);
    this.keys.push(key);
    this.siftUp(this.values.length - 1);
  }

  pop(): number {
    const top = this.values[0];
    const lastValue = this.values.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.values.length > 0) {
      this.values[0] = lastValue;
      this.keys[0] = lastKey;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(i: number): void {
    const value = this.values[i];
    const key = this.keys[i];
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.values[i] = this.values[parent];
      this.keys[i] = this.keys[parent];
      i = parent;
    }
    this.values[i] = value;
    this.keys[i] = key;
  }

  private siftDown(i: number): void {
    const n = this.values.length;
    const value = this.values[i];
    const key = this.keys[i];
    const halfN = n >> 1;
    while (i < halfN) {
      let child = (i << 1) + 1;
      const right = child + 1;
      if (right < n && this.keys[right] < this.keys[child]) child = right;
      if (this.keys[child] >= key) break;
      this.values[i] = this.values[child];
      this.keys[i] = this.keys[child];
      i = child;
    }
    this.values[i] = value;
    this.keys[i] = key;
  }
}
