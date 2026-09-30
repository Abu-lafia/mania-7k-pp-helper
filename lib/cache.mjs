import { DatabaseSync } from "node:sqlite";
import { gzipSync, gunzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
export class Cache {
  constructor(root, { memoryBytes = 64 * 1024 * 1024, redis = null } = {}) {
    fs.mkdirSync(root, { recursive: true });
    this.db = new DatabaseSync(path.join(root, "cache.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, data BLOB NOT NULL)",
    );
    this.getStmt = this.db.prepare(
      "SELECT timestamp,data FROM cache WHERE key=?",
    );
    this.hasStmt = this.db.prepare("SELECT timestamp FROM cache WHERE key=?");
    this.setStmt = this.db.prepare(
      "INSERT OR REPLACE INTO cache VALUES (?,?,?)",
    );
    this.inflight = new Map();
    this.memory = new Map();
    this.memoryBytes = memoryBytes;
    this.usedBytes = 0;
    this.redis = redis;
    this.stats = { memory_hits: 0, disk_hits: 0, redis_hits: 0, misses: 0 };
  }
  remember(key, text, timestamp) {
    const old = this.memory.get(key);
    if (old) {
      this.usedBytes -= old.bytes;
      this.memory.delete(key);
    }
    const bytes = text.length * 2;
    if (bytes > Math.min(this.memoryBytes, 4 * 1024 * 1024)) return;
    while (this.usedBytes + bytes > this.memoryBytes && this.memory.size) {
      const first = this.memory.keys().next().value;
      this.usedBytes -= this.memory.get(first).bytes;
      this.memory.delete(first);
    }
    this.memory.set(key, { text, timestamp, bytes });
    this.usedBytes += bytes;
  }
  has(key, ttl = Infinity) {
    if (ttl <= 0) return false;
    const row = this.memory.get(key) || this.hasStmt.get(key);
    return !!row && Date.now() - row.timestamp <= ttl;
  }
  get(key, ttl = Infinity) {
    if (ttl <= 0) return null;
    const hot = this.memory.get(key);
    if (hot && Date.now() - hot.timestamp <= ttl) {
      this.memory.delete(key);
      this.memory.set(key, hot);
      this.stats.memory_hits++;
      // Cached source objects must never be mutated by a search's aggregation.
      return JSON.parse(hot.text);
    }
    const row = this.getStmt.get(key);
    if (!row || Date.now() - row.timestamp > ttl) {
      this.stats.misses++;
      return null;
    }
    try {
      const text = gunzipSync(row.data).toString();
      const data = JSON.parse(text);
      this.remember(key, text, row.timestamp);
      this.stats.disk_hits++;
      return data;
    } catch {
      return null;
    }
  }
  set(key, value, timestamp = Date.now(), publish = true) {
    const text = JSON.stringify(value);
    this.setStmt.run(key, timestamp, gzipSync(text));
    this.remember(key, text, timestamp);
    if (publish && this.redis && text.length < 2 * 1024 * 1024)
      void this.redis.set(key, { timestamp, value });
    return value;
  }
  async memo(key, ttl, loader) {
    const cached = this.get(key, ttl);
    if (cached !== null) return cached;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const promise = Promise.resolve()
      .then(async () => {
        if (ttl > 0 && this.redis) {
          const shared = await this.redis.get(key);
          if (
            shared &&
            Number.isFinite(shared.timestamp) &&
            Date.now() - shared.timestamp <= ttl &&
            shared.value != null
          ) {
            this.stats.redis_hits++;
            return this.set(key, shared.value, shared.timestamp, false);
          }
        }
        return this.set(key, await loader());
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }
  close() {
    this.redis?.close();
    this.memory.clear();
    this.db.close();
  }
}
