// Bound in-flight work while letting newly discovered maps start immediately.
export class WorkQueue {
  constructor(limit, signal) { this.limit = limit; this.signal = signal; this.active = 0; this.pending = []; }
  add(run) {
    const promise = new Promise((resolve, reject) => {
      this.pending.push({ run, resolve, reject });
      this.drain();
    });
    // Consumers await results after collection; cancellation must not cause early unhandled rejections.
    promise.catch(() => {});
    return promise;
  }
  drain() {
    while (this.active < this.limit && this.pending.length) {
      const task = this.pending.shift();
      this.active++;
      Promise.resolve().then(() => {
        this.signal?.throwIfAborted();
        return task.run();
      }).then(task.resolve, task.reject).finally(() => { this.active--; this.drain(); });
    }
  }
}
