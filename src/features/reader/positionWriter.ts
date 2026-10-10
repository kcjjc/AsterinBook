export class PositionWriter {
  private pending = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<void> | undefined;
  constructor(
    private save: (id: string, offset: number) => Promise<void>,
    private error: (e: unknown) => void,
  ) {}
  schedule(id: string, offset: number) {
    this.pending.set(id, offset);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch(this.error);
    }, 1000);
  }
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.active) {
      await this.active;
      return this.flush();
    }
    if (!this.pending.size) return;
    const batch = [...this.pending];
    this.pending.clear();
    const operation = (async () => {
      for (let n = 0; n < batch.length; n++) {
        const [id, offset] = batch[n];
        try {
          await this.save(id, offset);
        } catch (e) {
          for (const [bid, pos] of batch.slice(n))
            if (!this.pending.has(bid)) this.pending.set(bid, pos);
          throw e;
        }
      }
    })();
    this.active = operation;
    try {
      await operation;
    } finally {
      if (this.active === operation) this.active = undefined;
    }
    await this.flush();
  }
}
