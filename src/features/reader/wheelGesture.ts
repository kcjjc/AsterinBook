export class WheelGesture {
  private last = -Infinity;
  private sum = 0;
  private fired = false;
  push(dy: number, now: number, mode: number): -1 | 0 | 1 {
    if (now - this.last > 200) {
      this.sum = 0;
      this.fired = false;
    }
    this.last = now;
    if (this.fired) return 0;
    this.sum += dy * (mode === 1 ? 16 : mode === 2 ? 400 : 1);
    if (Math.abs(this.sum) < 40) return 0;
    this.fired = true;
    return this.sum > 0 ? 1 : -1;
  }
}
