import assert from 'node:assert/strict';
import { Sources } from './lib/sources.mjs';
const store = new Map();
const cache = {
  get(key, ttl) { return ttl === 0 ? null : structuredClone(store.get(key) ?? null); },
  set(key, value) { store.set(key, structuredClone(value)); },
  async memo(key, ttl, loader) { const value = await loader(); this.set(key, value); return value; },
};
const source = new Sources(cache);
let requests = 0;
source.request = async url => {
  requests++;
  assert.equal(new URL(url).searchParams.get('limit'), '50');
  assert.equal(new URL(url).searchParams.get('offset'), '0');
  return Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));
};
assert.equal((await source.best(1)).scores.length, 50);
assert.equal(requests, 1);
assert.equal((await source.best(1)).bp_complete, true);
assert.equal(requests, 1);
await source.best(1, undefined, true);
assert.equal(requests, 2);
console.log('Top 50: one request, no extra page, cache reuse and refresh passed.');
