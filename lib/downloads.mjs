import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
export class Downloads {
  constructor(directory) {
    this.directory = directory;
    this.current = null;
  }
  start(ids, result) {
    if (this.current?.status === "running")
      throw new Error("A download queue is already running.");
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 10000 ||
      ids.some((id) => !Number.isSafeInteger(id))
    )
      throw new Error("Select one or more beatmapsets.");
    const allowed = new Set(result?.maps.map((m) => m.beatmapset_id) || []);
    const unique = [...new Set(ids)];
    if (unique.some((id) => !allowed.has(id)))
      throw new Error("A selected beatmapset is not in the current results.");
    fs.mkdirSync(this.directory, { recursive: true });
    this.current = {
      id: randomUUID(),
      status: "running",
      directory: this.directory,
      items: unique.map((id) => ({ id, status: "queued", bytes: 0 })),
      controller: new AbortController(),
    };
    this.run(this.current).catch((error) => {
      this.current.status = this.current.controller.signal.aborted
        ? "cancelled"
        : "error";
      this.current.error = error.message;
    });
    return this.status();
  }
  status() {
    if (!this.current) return null;
    const { controller, ...safe } = this.current;
    return safe;
  }
  cancel() {
    this.current?.controller.abort();
    return this.status();
  }
  async run(queue) {
    const signal = queue.controller.signal;
    for (const item of queue.items) {
      signal.throwIfAborted();
      const filename = path.join(this.directory, `${item.id}-novideo.osz`),
        temp = filename + ".part";
      try {
        const stat = await fsp.stat(filename).catch(() => null);
        if (stat?.size > 4) {
          item.status = "saved";
          item.bytes = stat.size;
          continue;
        }
        item.status = "downloading";
        const response = await fetch(
          `https://dl.sayobot.cn/beatmaps/download/novideo/${item.id}`,
          {
            signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]),
            headers: { "User-Agent": "mania-7k-pp-helper/1.0" },
          },
        );
        if (!response.ok)
          throw new Error(`SayoBot returned HTTP ${response.status}.`);
        if (!response.body) throw new Error("The download body was empty.");
        item.total = Number(response.headers.get("content-length")) || null;
        const file = await fsp.open(temp, "w");
        let prefix = Buffer.alloc(0);
        try {
          for await (const chunk of response.body) {
            signal.throwIfAborted();
            if (prefix.length < 4)
              prefix = Buffer.concat([prefix, chunk]).subarray(0, 4);
            if (
              item.bytes === 0 &&
              /text\/html|application\/json/.test(
                response.headers.get("content-type") || "",
              )
            )
              throw new Error(
                "The mirror returned a page instead of an osu! archive.",
              );
            await file.write(chunk);
            item.bytes += chunk.length;
          }
        } finally {
          await file.close();
        }
        if (prefix[0] !== 0x50 || prefix[1] !== 0x4b)
          throw new Error("The mirror returned an invalid osu! archive.");
        await fsp.rename(temp, filename);
        item.status = "saved";
      } catch (error) {
        await fsp.rm(temp, { force: true }).catch(() => {});
        item.status = signal.aborted ? "cancelled" : "failed";
        item.error = error.message;
        if (signal.aborted) throw error;
      }
      await delay(750, undefined, { signal });
    }
    queue.status = queue.items.some((i) => i.status === "failed")
      ? "partial"
      : "complete";
  }
}
