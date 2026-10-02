import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { WorkQueue } from './work-queue.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

export function validateBeatmap(bytes, entry) {
  const text = bytes.toString('utf8');
  if (!/^\uFEFF?osu file format v\d+/.test(text) ||
      !new RegExp(`^BeatmapID\\s*:\\s*${entry.beatmap_id}\\s*$`, 'm').test(text))
    throw new Error('Downloaded beatmap identity is invalid.');
  if (entry.checksum && createHash('md5').update(bytes).digest('hex') !== entry.checksum)
    throw new Error('Downloaded beatmap checksum does not match.');
  return bytes;
}
export function zipIndex(bytes, base = 0) {
  let end = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error('Invalid mirror ZIP directory.');
  const start = bytes.readUInt32LE(end + 16), size = bytes.readUInt32LE(end + 12);
  if (start === 0xffffffff || size === 0xffffffff) throw new Error('ZIP64 is unsupported.');
  if (start < base) return { start, size };
  const entries = [];
  let position = start - base;
  while (position < start - base + size) {
    if (bytes.readUInt32LE(position) !== 0x02014b50) throw new Error('Invalid ZIP member.');
    const nameLength = bytes.readUInt16LE(position + 28);
    const name = bytes.subarray(position + 46, position + 46 + nameLength).toString('utf8');
    if (/\.osu$/i.test(name)) entries.push({ name, nameLength,
      method: bytes.readUInt16LE(position + 10), encrypted: bytes.readUInt16LE(position + 8) & 1,
      compressed: bytes.readUInt32LE(position + 20), size: bytes.readUInt32LE(position + 24),
      offset: bytes.readUInt32LE(position + 42) });
    position += 46 + nameLength + bytes.readUInt16LE(position + 30) + bytes.readUInt16LE(position + 32);
  }
  return { start, size, entries };
}
export class BeatmapDownloads {
  constructor(sources, concurrency = 32) {
    this.sources = sources;
    this.queues = { official: new WorkQueue(Math.min(8, concurrency)), sayo: new WorkQueue(concurrency) };
    this.metrics = { official: 0, sayo: 0, fallback: 0, local: 0 };
    // Each source has a bounded pool; 429 responses still trigger source cooldown.
    sources.gaps['dl.sayobot.cn'] = 0;
  }
  async range(url, start, end, signal) {
    return this.sources.request(url, { signal, type: 'bytes', partial: true, details: true,
      timeout: 10000, attempts: 2,
      headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' } });
  }
  async mirror(entry, signal) {
    const index = await this.sources.cached(`sayo-index-v1:${entry.beatmapset_id}`, 3600000, async () => {
      const tail = await this.range(`https://dl.sayobot.cn/beatmaps/download/mini/${entry.beatmapset_id}`, '', 65557, signal);
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(tail.range || '');
      if (!match) throw new Error('Invalid ZIP range response.');
      let parsed = zipIndex(tail.bytes, Number(match[1]));
      if (parsed.size > 2097152) throw new Error('Mirror ZIP directory is too large.');
      if (!parsed.entries) {
        const directory = await this.range(tail.url, parsed.start, Number(match[3]) - 1, signal);
        parsed = zipIndex(directory.bytes, parsed.start);
      }
      return { ...parsed, url: tail.url, total: Number(match[3]) };
    });
    const clean = text => text.replace(/\[[1-9]K\]/ig, '').replace(/[\[\]]/g,'').trim().toLowerCase();
    const matches = [...index.entries].sort((a,b) =>
      Number(clean(b.name.slice(0,-4)).endsWith(clean(entry.difficulty))) -
      Number(clean(a.name.slice(0,-4)).endsWith(clean(entry.difficulty))));
    if (matches.length > 32) throw new Error('Mirror archive has too many difficulties.');
    for (const member of matches) {
    const content = await this.sources.cached(`sayo-member-v1:${entry.beatmapset_id}:${member.offset}:${member.compressed}`, 3600000, async () => {
    if (member.encrypted || member.size > 16777216 || member.compressed > 8388608)
      throw new Error('Unsupported mirror ZIP member.');
    const data = await this.range(index.url, member.offset,
      Math.min(index.total - 1, member.offset + 30 + member.nameLength + 65535 + member.compressed - 1), signal);
    const bytes = data.bytes;
    if (bytes.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid ZIP local header.');
    const start = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28);
    const compressed = bytes.subarray(start, start + member.compressed);
    if (compressed.length !== member.compressed) throw new Error('Truncated ZIP member.');
    const content = member.method === 0 ? compressed : member.method === 8
      ? inflateRawSync(compressed, { maxOutputLength: 16777216 }) : null;
    if (!content || content.length !== member.size) throw new Error('Invalid ZIP member length.');
    return content.toString('base64');
    });
    const decoded = Buffer.from(content,'base64');
    const id = /^BeatmapID\s*:\s*(\d+)\s*$/m.exec(decoded.toString('utf8'));
    if (Number(id?.[1]) === entry.beatmap_id) return validateBeatmap(decoded, entry);
    }
    throw new Error('Mirror archive does not contain the requested beatmap.');
  }
  async download(entry, signal) {
    signal?.throwIfAborted();
    if (this.sources.localBeatmapDirectory && Number.isSafeInteger(entry.beatmap_id)) {
      const names = [`${entry.beatmap_id}.osu`];
      if (/^[a-f0-9]{32}$/i.test(entry.checksum || '')) names.push(`${entry.checksum}.osu`);
      for (const name of names) {
        try {
          const file = path.join(this.sources.localBeatmapDirectory,name);
          const stat = await fs.stat(file);
          if (stat.size > 16777216) continue;
          const bytes = validateBeatmap(await fs.readFile(file),entry);
          signal?.throwIfAborted(); this.metrics.local++; return bytes;
        } catch(error) { signal?.throwIfAborted(); }
      }
    }
    const officialBlocked = (this.sources.host?.('osu.ppy.sh:maps').blocked || 0) > Date.now();
    const sayoBlocked = (this.sources.host?.('dl.sayobot.cn').blocked || 0) > Date.now();
    const load = route => (this.queues[route].active + this.queues[route].pending.length) / this.queues[route].limit;
    const preferred = load('sayo') <= load('official') ? 'sayo' : 'official';
    const route = officialBlocked && !sayoBlocked ? 'sayo' : sayoBlocked && !officialBlocked ? 'official' : preferred;
    const run = source => this.queues[source].add(async () => {
      signal?.throwIfAborted();
      const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20000)]);
      this.metrics[source]++;
      if (source === 'sayo') return this.mirror(entry, deadline);
      return validateBeatmap(await this.sources.request(`https://osu.ppy.sh/osu/${entry.beatmap_id}`,
        { signal: deadline, type: 'bytes', timeout: 10000, attempts: 2 }), entry);
    });
    try { return await run(route); }
    catch (error) {
      signal?.throwIfAborted(); this.metrics.fallback++;
      return run(route === 'sayo' ? 'official' : 'sayo');
    }
  }
}
