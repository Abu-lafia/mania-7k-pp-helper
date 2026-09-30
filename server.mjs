import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { setDefaultResultOrder } from "node:dns";
import { Cache } from "./lib/cache.mjs";
import { Sources } from "./lib/sources.mjs";
import { SearchJobs } from "./lib/jobs.mjs";
import { Downloads } from "./lib/downloads.mjs";
import { loadDanAsset } from "./lib/dan-assets.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
setDefaultResultOrder("ipv4first");
const config = JSON.parse(
  await fsp.readFile(path.join(root, "config.json"), "utf8"),
);
const redis = config.redisUrl
  ? new (await import("./lib/redis-cache.mjs")).RedisCache(config.redisUrl)
  : null;
if (redis) await redis.connect();
const cache = new Cache(path.join(root, "data"), {
  memoryBytes:
    Math.max(0, Math.min(256, Number(config.memoryCacheMB) || 0)) * 1048576,
  redis,
});
const sources = new Sources(cache),
  jobs = new SearchJobs(sources, cache),
  downloads = new Downloads(path.join(root, "downloads"));
const token = randomBytes(24).toString("hex");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
let port = Number(process.env.PPHELPER_PORT) || 7277;
function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 200000) throw new Error("The request is too large.");
  }
  return data ? JSON.parse(data) : {};
}
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host))
    return json(res, 403, { error: "Invalid host." });
  if (
    req.headers.origin &&
    ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(
      req.headers.origin,
    )
  )
    return json(res, 403, { error: "Invalid origin." });
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/health")
      return json(res, 200, { app: "mania-7k-pp-helper", root, port });
    if (req.method === "GET" && url.pathname === "/api/info")
      return json(res, 200, {
        token,
        root,
        download_directory: downloads.directory,
        active_job:
          [...jobs.jobs.values()].find((j) => j.status === "running")?.id ||
          null,
        latest: jobs.latest
          ? { id: jobs.latest.id, completed_at: jobs.latest.completed_at }
          : null,
        cache: {
          memory_mb: cache.memoryBytes / 1048576,
          redis: redis?.status || "disabled",
        },
      });
    if (req.method === "GET" && url.pathname === "/api/results/latest")
      return json(res, 200, jobs.latest);
    if (
      req.method === "GET" &&
      /^\/api\/jobs\/[a-f0-9-]+$/.test(url.pathname)
    ) {
      const job = jobs.status(url.pathname.split("/").at(-1));
      return json(res, job ? 200 : 404, job || { error: "Search not found." });
    }
    if (req.method === "GET" && url.pathname === "/api/downloads")
      return json(res, 200, downloads.status());
    if (req.method === "GET" && url.pathname === "/api/image") {
      const imageUrl = new URL(url.searchParams.get("url"));
      if (
        imageUrl.protocol !== "https:" ||
        imageUrl.port ||
        !(
          ["a.ppy.sh", "assets.ppy.sh"].includes(imageUrl.hostname) ||
          (imageUrl.hostname === "osu.ppy.sh" &&
            /^\/assets\/images\/flags\/[a-f0-9-]+\.svg$/.test(
              imageUrl.pathname,
            ))
        )
      )
        return json(res, 400, { error: "Unsupported image source." });
      const stored = await cache.memo(
        `image-v1:${imageUrl.href}`,
        604800000,
        async () => {
          const response = await fetch(imageUrl, {
            signal: AbortSignal.timeout(20000),
          });
          const type = response.headers.get("content-type") || "";
          if (
            !response.ok ||
            !/^image\/(jpeg|png|webp|gif|svg\+xml)/.test(type)
          )
            throw new Error("Image unavailable.");
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length > 5000000) throw new Error("Image is too large.");
          return { type, bytes: bytes.toString("base64") };
        },
      );
      res.writeHead(200, {
        "Content-Type": stored.type,
        "Cache-Control": "public, max-age=86400",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      });
      res.end(Buffer.from(stored.bytes, "base64"));
      return;
    }
    if (req.method === "POST") {
      if (req.headers["x-app-token"] !== token)
        return json(res, 403, { error: "Reload the page and try again." });
      const input = await body(req);
      if (url.pathname === "/api/search")
        return json(res, 202, jobs.start(input));
      if (url.pathname === "/api/cancel")
        return json(res, 200, jobs.cancel(input.id));
      if (url.pathname === "/api/downloads")
        return json(res, 202, downloads.start(input.ids, jobs.latest));
      if (url.pathname === "/api/downloads/cancel")
        return json(res, 200, downloads.cancel());
      if (url.pathname === "/api/shutdown") {
        for (const job of jobs.jobs.values()) job.controller.abort();
        downloads.cancel();
        json(res, 200, { ok: true });
        setTimeout(() => {
          server.close();
          process.exit(0);
        }, 200);
        return;
      }
      return json(res, 404, { error: "Endpoint not found." });
    }
    if (req.method !== "GET" && req.method !== "HEAD")
      return json(res, 405, { error: "Method not allowed." });
    if (url.pathname.startsWith("/assets/dans/")) {
      const bytes = await loadDanAsset(url.pathname, cache, { root });
      if (!bytes) return json(res, 404, { error: "Unknown dan badge." });
      res.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Content-Length": bytes.length,
        "Cache-Control": "public, max-age=86400",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      });
      res.end(req.method === "HEAD" ? undefined : bytes);
      return;
    }
    const base = path.join(root, "public");
    const filename = path.resolve(
      base,
      "." +
        decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname),
    );
    if (!filename.startsWith(base + path.sep))
      return json(res, 403, { error: "Invalid path." });
    const stat = await fsp.stat(filename).catch(() => null);
    if (!stat?.isFile()) return json(res, 404, { error: "File not found." });
    res.writeHead(200, {
      "Content-Type":
        mime[path.extname(filename)] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control":
        url.pathname.includes("/vendor/") || url.pathname.includes("/fonts/")
          ? "public, max-age=86400"
          : "no-cache",
    });
    if (req.method === "HEAD") res.end();
    else fs.createReadStream(filename).pipe(res);
  } catch (error) {
    json(res, 400, { error: error.message });
  }
});
function listen() {
  server.listen(port, "127.0.0.1");
}
server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && port < 7377) {
    port++;
    listen();
  } else {
    console.error(error);
    process.exit(1);
  }
});
server.on("listening", async () => {
  const url = `http://127.0.0.1:${port}`;
  await fsp.writeFile(
    path.join(root, "data", "server.json"),
    JSON.stringify({ pid: process.pid, port, root }),
  );
  console.log(`mania 7k pp helper: ${url}`);
  if (process.argv.includes("--open"))
    spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
});
process.on("SIGINT", () => {
  for (const job of jobs.jobs.values()) job.controller.abort();
  downloads.cancel();
  server.close();
  cache.close();
  process.exit(0);
});
listen();
