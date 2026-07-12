export class ActivityTracker {
  private activeCount = 0;
  private readonly idleWaiters = new Set<() => void>();

  enter(): () => void {
    this.activeCount += 1;
    let finished = false;

    return () => {
      if (finished) {
        return;
      }

      finished = true;
      this.activeCount -= 1;

      if (this.activeCount === 0) {
        for (const resolve of this.idleWaiters) {
          resolve();
        }
        this.idleWaiters.clear();
      }
    };
  }

  whenIdle(): Promise<void> {
    if (this.activeCount === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.idleWaiters.add(resolve);
    });
  }
}
