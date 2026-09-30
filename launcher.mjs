import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
const root = path.dirname(fileURLToPath(import.meta.url));
await fs.mkdir(path.join(root, "work", "tmp"), { recursive: true });
await fs.mkdir(path.join(root, "data"), { recursive: true });
const open = (url) =>
  spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
async function existing() {
  try {
    const info = JSON.parse(
      await fs.readFile(path.join(root, "data", "server.json")),
    );
    const r = await fetch(`http://127.0.0.1:${info.port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    const data = await r.json();
    return data.app === "mania-7k-pp-helper" && data.root === root
      ? `http://127.0.0.1:${info.port}`
      : null;
  } catch {
    return null;
  }
}
let url = await existing();
if (url) {
  open(url);
  process.exit(0);
}
const log = await fs.open(path.join(root, "data", "server.log"), "a");
const child = spawn(process.execPath, [path.join(root, "server.mjs")], {
  cwd: root,
  env: {
    ...process.env,
    TEMP: path.join(root, "work", "tmp"),
    TMP: path.join(root, "work", "tmp"),
  },
  detached: true,
  stdio: ["ignore", log.fd, log.fd],
  windowsHide: true,
});
child.unref();
await log.close();
for (let i = 0; i < 40; i++) {
  await delay(250);
  url = await existing();
  if (url) {
    open(url);
    process.exit(0);
  }
}
console.error("The helper could not start. See data/server.log for details.");
process.exit(1);
