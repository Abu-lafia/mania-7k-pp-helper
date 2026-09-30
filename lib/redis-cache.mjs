import { createClient } from "@redis/client";

// Redis is optional and restricted to loopback. SQLite remains authoritative.
export class RedisCache {
  constructor(url) {
    const parsed = new URL(url);
    if (
      !["redis:", "rediss:"].includes(parsed.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    )
      throw new Error("The optional Redis cache must use a loopback address.");
    this.status = "connecting";
    this.client = createClient({
      url,
      disableOfflineQueue: true,
      socket: { connectTimeout: 800, reconnectStrategy: false },
    });
    this.client.on("error", () => {
      this.status = "unavailable";
    });
  }
  async connect() {
    try {
      await this.client.connect();
      this.status = "ready";
    } catch {
      this.status = "unavailable";
    }
  }
  async command(operation) {
    if (!this.client.isReady) return null;
    let timer;
    try {
      return await Promise.race([
        operation(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Redis timeout")), 500);
        }),
      ]);
    } catch {
      this.status = "unavailable";
      if (this.client.isOpen) this.client.destroy();
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  async get(key) {
    const text = await this.command(() => this.client.get(`mania7k:v1:${key}`));
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }
  async set(key, value) {
    await this.command(() =>
      this.client.set(`mania7k:v1:${key}`, JSON.stringify(value), {
        EX: 86400,
      }),
    );
  }
  close() {
    if (this.client.isOpen) this.client.destroy();
  }
}
