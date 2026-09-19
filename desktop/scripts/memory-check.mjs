// Memory observation for the desktop video store (reproducible measurement).
// Uploads a synthetic file through the real HTTP server in 8 MiB parts while
// sampling process memory, then verifies range reads and cleans up.
// Prerequisite: node desktop/scripts/build-test.mjs (bundles wires.mjs).
// Run: node desktop/scripts/memory-check.mjs [sizeMB]
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp, LocalVideoStore, setVideoBucket } from "../dist/test/wires.mjs";

const sizeMB = Number(process.argv[2] ?? 256);
const partSize = 8 * 1024 * 1024;
const totalBytes = sizeMB * 1024 * 1024;

const workDir = await mkdtemp(path.join(tmpdir(), "zhimu-mem-"));
const sourcePath = path.join(workDir, "source.bin");

// Patterned source file, written with explicit backpressure.
{
  const pattern = Buffer.alloc(64 * 1024);
  for (let index = 0; index < pattern.length; index += 1) pattern[index] = (index * 31 + 7) & 0xff;
  const out = createWriteStream(sourcePath);
  for (let written = 0; written < totalBytes; written += pattern.length) {
    if (!out.write(pattern.subarray(0, Math.min(pattern.length, totalBytes - written)))) {
      await new Promise((resolve) => out.once("drain", resolve));
    }
  }
  await new Promise((resolve) => out.end(resolve));
}
console.log(`[memory-check] source: ${((await stat(sourcePath)).size / 1024 / 1024).toFixed(1)} MB`);

// Server with a local store, same wiring as the real service.
const storeRoot = await mkdtemp(path.join(tmpdir(), "zhimu-mem-store-"));
const staticRoot = await mkdtemp(path.join(tmpdir(), "zhimu-mem-static-"));
await writeFile(path.join(staticRoot, "index.html"), "<!doctype html><html></html>");
setVideoBucket(new LocalVideoStore(storeRoot));
const config = { staticRoot, dataDir: "", cacheDir: storeRoot, token: "memory-check", port: 0 };
const app = createApp(config);
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
  config.port = info.port;
});
await new Promise((resolve) => setTimeout(resolve, 100));

const authHeaders = {
  host: `127.0.0.1:${config.port}`,
  origin: `http://127.0.0.1:${config.port}`,
  cookie: `zhimu_session=${config.token}`,
};

function request(method, urlPath, headers = {}, streamBody = null, textBody = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: config.port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    if (streamBody) {
      streamBody.pipe(req);
    } else if (textBody !== null) {
      req.end(textBody);
    } else {
      req.end();
    }
  });
}

function postJson(urlPath, payload) {
  const text = JSON.stringify(payload);
  return request("POST", urlPath, { ...authHeaders, "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }, null, text);
}

// Memory sampler running for the whole upload window.
let peak = { rss: 0, heapUsed: 0 };
const sampler = setInterval(() => {
  const usage = process.memoryUsage();
  if (usage.rss > peak.rss) peak = { rss: usage.rss, heapUsed: usage.heapUsed };
}, 100);
const baseline = process.memoryUsage();

try {
  const startedAt = Date.now();
  const init = await postJson("/api/upload/init", { name: "memory-check.bin", type: "video/mp4", size: totalBytes });
  if (init.status !== 200) throw new Error(`init failed: ${init.status} ${init.body}`);
  const { key, uploadId } = JSON.parse(init.body.toString("utf8"));

  const parts = [];
  const totalParts = Math.ceil(totalBytes / partSize);
  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    const start = (partNumber - 1) * partSize;
    const end = Math.min(totalBytes, start + partSize) - 1;
    const part = await request("PUT",
      `/api/upload/part?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`,
      { ...authHeaders, "content-length": String(end - start + 1) },
      createReadStream(sourcePath, { start, end }));
    if (part.status !== 200) throw new Error(`part ${partNumber} failed: ${part.status} ${part.body}`);
    parts.push(JSON.parse(part.body.toString("utf8")));
  }

  const complete = await postJson("/api/upload/complete", { key, uploadId, parts });
  const completeBody = JSON.parse(complete.body.toString("utf8"));
  if (complete.status !== 200) throw new Error(`complete failed: ${complete.status} ${complete.body}`);
  console.log(`[memory-check] uploaded ${totalParts} parts -> ${completeBody.size} bytes in ${Date.now() - startedAt} ms`);

  // Range read: fetch bytes 1MB..1MB+4KB and compare with the source pattern window.
  const range = await request("GET", `/api/upload/media?key=${encodeURIComponent(key)}`, { ...authHeaders, range: "bytes=1048576-1052671" });
  if (range.status !== 206) throw new Error(`range failed: ${range.status}`);
  const expected = Buffer.alloc(4096);
  const pattern = Buffer.alloc(64 * 1024);
  for (let index = 0; index < pattern.length; index += 1) pattern[index] = (index * 31 + 7) & 0xff;
  for (let index = 0; index < 4096; index += 1) expected[index] = pattern[(1048576 + index) % pattern.length];
  if (!range.body.equals(expected)) throw new Error("range content mismatch");
  console.log(`[memory-check] range 206 verified (bytes 1048576-1052671 match source pattern)`);

  const del = await postJson("/api/upload/delete", { key });
  if (del.status !== 200) throw new Error(`delete failed: ${del.status}`);

  const after = process.memoryUsage();
  console.log(`[memory-check] baseline rss=${(baseline.rss / 1048576).toFixed(1)}MB heap=${(baseline.heapUsed / 1048576).toFixed(1)}MB`);
  console.log(`[memory-check] peak     rss=${(peak.rss / 1048576).toFixed(1)}MB heap=${(peak.heapUsed / 1048576).toFixed(1)}MB`);
  console.log(`[memory-check] after    rss=${(after.rss / 1048576).toFixed(1)}MB heap=${(after.heapUsed / 1048576).toFixed(1)}MB`);
  console.log(`[memory-check] peak rss growth over baseline: ${(peak.rss / baseline.rss).toFixed(2)}x of ${(sizeMB)}MB payload (streaming, not buffered)`);
} finally {
  clearInterval(sampler);
  server.close();
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
  await rm(storeRoot, { recursive: true, force: true }).catch(() => {});
  await rm(staticRoot, { recursive: true, force: true }).catch(() => {});
}
