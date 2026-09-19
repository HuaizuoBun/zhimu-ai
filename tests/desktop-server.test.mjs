import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "../desktop/dist/test/wires.mjs";

// Real HTTP server so Host/Origin/Cookie headers behave exactly as in production.
async function startServer(staticRoot) {
  const config = { staticRoot, dataDir: "", cacheDir: "", token: "test-token-value", port: 0 };
  const app = createApp(config);
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
    config.port = info.port;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { server, config };
}

function request(port, { method = "GET", path: urlPath = "/", headers = {}, ...rest } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      method,
      path: urlPath,
      headers: { ...rest, ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("desktop server enforces host, origin and session credentials", async () => {
  const staticRoot = await mkdtemp(path.join(tmpdir(), "zhimu-static-"));
  await mkdir(path.join(staticRoot, "assets"), { recursive: true });
  await writeFile(path.join(staticRoot, "index.html"), "<!doctype html><html><body>zhimu</body></html>");
  await writeFile(path.join(staticRoot, "assets", "app.js"), "console.log('app')");
  const { server, config } = await startServer(staticRoot);
  try {
    const valid = { host: `127.0.0.1:${config.port}`, cookie: `zhimu_session=${config.token}` };

    // Health requires the session credential.
    const health = await request(config.port, { ...valid, path: "/api/health" });
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).ok, true);
    assert.equal(JSON.parse(health.body).app, "zhimu-ai-desktop");

    // No credential -> 403.
    assert.equal((await request(config.port, { path: "/api/health", host: valid.host })).status, 403);
    // Wrong credential -> 403.
    assert.equal((await request(config.port, { path: "/api/health", host: valid.host, cookie: "zhimu_session=wrong" })).status, 403);
    // Foreign Host (DNS rebinding shape) -> 403 even with a valid cookie.
    assert.equal((await request(config.port, { path: "/api/health", host: "evil.example:8080", cookie: valid.cookie })).status, 403);
    // Cross-origin Origin -> 403.
    assert.equal((await request(config.port, { path: "/api/health", host: valid.host, origin: "http://evil.example", cookie: valid.cookie })).status, 403);

    // Unknown business APIs answer an explicit 501 JSON error.
    const notMigrated = await request(config.port, { ...valid, method: "POST", path: "/api/not-a-real-route", origin: `http://127.0.0.1:${config.port}`, "content-type": "application/json" });
    assert.equal(notMigrated.status, 501);
    assert.match(JSON.parse(notMigrated.body).error, /尚未迁移到桌面版/);
    // Write APIs without a JSON content type are rejected with 415.
    const noContentType = await request(config.port, { ...valid, method: "POST", path: "/api/upload/init", origin: `http://127.0.0.1:${config.port}` });
    assert.equal(noContentType.status, 415);
    // Write APIs from a foreign origin are rejected even with a valid session.
    const foreignOrigin = await request(config.port, { ...valid, method: "POST", path: "/api/upload/init", origin: "http://evil.example", "content-type": "application/json" });
    assert.equal(foreignOrigin.status, 403);

    // Static index.html is served with CSP and only for authorized sessions.
    const page = await request(config.port, { ...valid, path: "/" });
    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"], /text\/html/);
    assert.match(page.headers["content-security-policy"], /default-src 'self'/);
    assert.match(page.body, /zhimu/);
    assert.equal((await request(config.port, { path: "/", host: valid.host })).status, 403);

    // Assets are served; unknown asset paths fall back to the app shell (SPA).
    const asset = await request(config.port, { ...valid, path: "/assets/app.js" });
    assert.equal(asset.status, 200);
    assert.match(asset.headers["content-type"], /text\/javascript/);
    const fallback = await request(config.port, { ...valid, path: "/some/route" });
    assert.equal(fallback.status, 200);
    assert.match(fallback.body, /zhimu/);

    // Directory traversal is contained inside the static root.
    const traversal = await request(config.port, { ...valid, path: "/../../etc/passwd" });
    assert.ok(traversal.status === 200 || traversal.status === 404);
    assert.ok(!traversal.body.includes("root:"));
  } finally {
    server.close();
    await rm(staticRoot, { recursive: true, force: true });
  }
});
