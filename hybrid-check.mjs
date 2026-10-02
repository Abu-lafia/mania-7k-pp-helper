import assert from 'node:assert/strict';
import { Sources } from './lib/sources.mjs';
const values = new Map(), pending = new Map();
const cache = {
  get: (key, ttl) => ttl === 0 ? null : values.get(key) ?? null,
  set: (key, value) => values.set(key, value),
  async memo(key, ttl, loader) {
    if (pending.has(key)) return pending.get(key);
    const task = Promise.resolve().then(loader).then(v => { values.set(key, v); return v; }).finally(() => pending.delete(key));
    pending.set(key, task); return task;
  },
};
const src = new Sources(cache, { oauth: { clientId: 1, clientSecret: 'fixture' } });
let active = 0, peak = 0;
const calls = [];
src.request = async url => {
  calls.push(url); peak = Math.max(peak, ++active);
  await new Promise(r => setTimeout(r, 5)); active--;
  return [{ id: Number(url.match(/users\/(\d+)/)[1]) }];
};
const results = await Promise.all(Array.from({ length: 12 }, (_, i) => src.best(i + 1)));
assert.ok(results.every(r => r.bp_complete));
assert.ok(src.bpRequests.api > 0 && src.bpRequests.web > 0);
assert.equal(calls.length, 12); assert.ok(peak > 1);
await src.best(1); assert.equal(calls.length, 12);
await Promise.all([src.best(20), src.best(20)]); assert.equal(calls.length, 13);
src.host('osu.ppy.sh').blocked = Date.now() + 60000;
assert.equal(src.chooseBpRoute(), 'api');
src.host('osu.ppy.sh').blocked = 0;
src.host('osu.ppy.sh:api').blocked = Date.now() + 60000;
assert.equal(src.chooseBpRoute(), 'web');
const controller = new AbortController(); controller.abort();
await assert.rejects(src.best(30, controller.signal)); assert.equal(calls.length, 13);
console.log(JSON.stringify({ split: src.bpRequests, parallel: true, cache_reused: true, duplicate_deduplicated: true,
  cooldown_routing: true, cancellation: true }));
