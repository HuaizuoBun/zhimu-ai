// P4 route tests over the real desktop server + local video store with a
// controlled mock upstream (globalThis.fetch replacement — never shipped).
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp, LocalVideoStore, setVideoBucket } from "../desktop/dist/test/wires.mjs";

async function startApp() {
  const staticRoot = await mkdtemp(path.join(tmpdir(), "zhimu-p4-static-"));
  await writeFile(path.join(staticRoot, "index.html"), "<!doctype html><html></html>");
  const storeRoot = await mkdtemp(path.join(tmpdir(), "zhimu-p4-store-"));
  setVideoBucket(new LocalVideoStore(storeRoot));
  const config = { staticRoot, dataDir: "", cacheDir: storeRoot, token: "p4-token", port: 0 };
  const app = createApp(config);
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
    config.port = info.port;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { server, config, storeRoot, staticRoot };
}

function request(port, { method = "GET", path: urlPath = "/", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    if (body) req.end(body);
    else req.end();
  });
}

function auth(config, extra = {}) {
  return {
    host: `127.0.0.1:${config.port}`,
    origin: `http://127.0.0.1:${config.port}`,
    cookie: `zhimu_session=${config.token}`,
    ...extra,
  };
}

async function postJson(port, headers, urlPath, payload) {
  const text = JSON.stringify(payload);
  return request(port, { method: "POST", path: urlPath, headers: { ...headers, "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }, body: text });
}

async function readWebStream(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

test("bilibili subtitle import works through the desktop server", async () => {
  const { server, config, storeRoot, staticRoot } = await startApp();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("x/web-interface/view")) return Response.json({ code: 0, data: { title: "B 站桌面测试", duration: 125, cid: 99 } });
    if (url.includes("x/player/v2")) return Response.json({ code: 0, data: { subtitle: { subtitles: [{ lan: "zh-CN", lan_doc: "中文", subtitle_url: "//i0.hdslb.com/bfs/subtitle/desktop.json" }] } } });
    if (url.includes("hdslb.com")) return Response.json({ body: [{ from: 1.2, to: 3.4, content: "桌面字幕第一条" }, { from: 62, to: 65, content: "桌面字幕第二条" }] });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await postJson(config.port, auth(config), "/api/source/bilibili", { url: "https://www.bilibili.com/video/BV1xx411c7mD" });
    assert.equal(response.status, 200);
    const data = JSON.parse(response.body.toString("utf8"));
    assert.equal(data.hasSubtitle, true);
    assert.equal(data.metadata.title, "B 站桌面测试");
    assert.deepEqual(data.transcript.map((item) => item.time), ["00:01", "01:02"]);
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
    await rm(storeRoot, { recursive: true, force: true });
    await rm(staticRoot, { recursive: true, force: true });
  }
});

test("bilibili video import lands in the local store and serves identical bytes", async () => {
  const { server, config, storeRoot, staticRoot } = await startApp();
  const originalFetch = globalThis.fetch;
  const mediaBytes = Buffer.alloc(64 * 1024, 0);
  for (let index = 0; index < mediaBytes.length; index += 1) mediaBytes[index] = (index * 7 + 11) & 0xff;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("x/web-interface/view")) return Response.json({ code: 0, data: { title: "导入视频", duration: 88, cid: 7 } });
    if (url.includes("x/player/playurl")) return Response.json({ code: 0, data: { durl: [{ url: "https://cdn.example.com/video.flv", size: mediaBytes.length, length: 88000 }] } });
    if (url.includes("cdn.example.com")) return new Response(mediaBytes);
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await postJson(config.port, auth(config), "/api/source/bilibili/video", { url: "https://www.bilibili.com/video/BV1xx411c7mD" });
    assert.equal(response.status, 200);
    const data = JSON.parse(response.body.toString("utf8"));
    assert.equal(data.size, mediaBytes.length);
    assert.ok(data.key.startsWith("videos/"));

    // The imported video is served byte-identically from the local store.
    const media = await request(config.port, { path: `/api/upload/media?key=${encodeURIComponent(data.key)}`, headers: auth(config) });
    assert.equal(media.status, 200);
    assert.equal(media.headers["content-length"], String(mediaBytes.length));
    assert.ok(media.body.equals(mediaBytes), "stored bytes must match the downloaded stream");
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
    await rm(storeRoot, { recursive: true, force: true });
    await rm(staticRoot, { recursive: true, force: true });
  }
});

async function seedVideo(config, bytes, name) {
  const init = await postJson(config.port, auth(config), "/api/upload/init", { name, type: "video/mp4", size: bytes.length });
  const { key, uploadId } = JSON.parse(init.body.toString("utf8"));
  const part = await request(config.port, {
    method: "PUT",
    path: `/api/upload/part?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=1`,
    headers: auth(config, { "content-length": String(bytes.length) }),
    body: bytes,
  });
  const complete = await postJson(config.port, auth(config), "/api/upload/complete", { key, uploadId, parts: [JSON.parse(part.body.toString("utf8"))] });
  assert.equal(complete.status, 200);
  return key;
}

test("gemini upload streams the exact file bytes with duplex half", async () => {
  const { server, config, storeRoot, staticRoot } = await startApp();
  const originalFetch = globalThis.fetch;
  const videoBytes = Buffer.alloc(48 * 1024, 0);
  for (let index = 0; index < videoBytes.length; index += 1) videoBytes[index] = (index * 13 + 5) & 0xff;
  let uploadInit = null;
  let receivedBytes = null;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("upload_id=test-123")) {
      uploadInit = init;
      receivedBytes = await readWebStream(init.body);
      return Response.json({ file: { name: "files/seed-001", uri: "https://generativelanguage.googleapis.com/v1beta/files/seed-001", mimeType: "video/mp4", state: "PROCESSING" } });
    }
    if (url.includes("/upload/v1beta/files")) {
      return new Response(JSON.stringify({ file: { display_name: "seed" } }), { status: 200, headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=test-123" } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const key = await seedVideo(config, videoBytes, "gemini-seed.mp4");
    const response = await postJson(config.port, auth(config), "/api/video/gemini/upload", { key, apiKey: "test-gemini", displayName: "seed.mp4" });
    assert.equal(response.status, 200);
    const data = JSON.parse(response.body.toString("utf8"));
    assert.equal(data.file.name, "files/seed-001");
    // Streaming requirements for Electron's Node/undici fetch.
    assert.equal(uploadInit.duplex, "half");
    assert.equal(uploadInit.headers["content-length"], String(videoBytes.length));
    assert.ok(receivedBytes.equals(videoBytes), "upstream must receive the exact stored bytes");
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
    await rm(storeRoot, { recursive: true, force: true });
    await rm(staticRoot, { recursive: true, force: true });
  }
});

test("gemini status and file-based analyze return the article through the desktop server", async () => {
  const { server, config, storeRoot, staticRoot } = await startApp();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/v1beta/files/")) {
      return Response.json({ name: "files/seed-001", uri: "https://generativelanguage.googleapis.com/v1beta/files/seed-001", mimeType: "video/mp4", state: "ACTIVE" });
    }
    if (url.includes("/v1beta/interactions")) {
      return Response.json({ status: "completed", output_text: JSON.stringify({
        title: "Gemini 桌面文章", duration: "01:00", sourceLabel: "本地视频", oneLineSummary: "一句话",
        finalSummary: "总结", keywords: ["音画"],
        article: { version: 1, title: "Gemini 桌面文章", sections: [{ title: "主题", startSeconds: 0, points: [{ label: "标签", text: "解释" }] }], conclusion: { paragraphs: ["总结段"] } },
        transcript: [{ time: "00:00", seconds: 0, text: "转写" }],
        mindmap: { label: "Gemini 桌面文章", children: [{ label: "主题" }] },
      }) });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    // Legacy YouTube requests stay rejected on the desktop path too.
    const rejected = await postJson(config.port, auth(config), "/api/video/gemini/analyze", { source: "youtube", url: "https://youtube.com/watch?v=x", apiKey: "test" });
    assert.equal(rejected.status, 410);

    const status = await postJson(config.port, auth(config), "/api/video/gemini/status", { name: "files/seed-001", apiKey: "test" });
    assert.equal(status.status, 200);
    assert.equal(JSON.parse(status.body.toString("utf8")).file.state, "ACTIVE");

    const analyze = await postJson(config.port, auth(config), "/api/video/gemini/analyze", { source: "file", file: { uri: "https://generativelanguage.googleapis.com/v1beta/files/seed-001" }, apiKey: "test", title: "测试" });
    assert.equal(analyze.status, 200);
    const analysis = JSON.parse(analyze.body.toString("utf8")).analysis;
    assert.equal(analysis.article.sections[0].title, "主题");
    assert.equal(analysis.finalSummary, "总结段");
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
    await rm(storeRoot, { recursive: true, force: true });
    await rm(staticRoot, { recursive: true, force: true });
  }
});

test("qwen upload posts a complete multipart body to the aliyuncs host", async () => {
  const { server, config, storeRoot, staticRoot } = await startApp();
  const originalFetch = globalThis.fetch;
  const videoBytes = Buffer.alloc(32 * 1024, 0);
  for (let index = 0; index < videoBytes.length; index += 1) videoBytes[index] = (index * 17 + 3) & 0xff;
  let uploadInit = null;
  let receivedBytes = null;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("action=getPolicy")) {
      return Response.json({ data: {
        policy: "policy-data", signature: "sig==", upload_dir: "instant-dir", upload_host: "https://oss-cn-beijing.aliyuncs.com",
        max_file_size_mb: 1024, oss_access_key_id: "AKID", x_oss_object_acl: "private", x_oss_forbid_overwrite: "true",
      } });
    }
    if (url.includes("aliyuncs.com")) {
      uploadInit = init;
      receivedBytes = await readWebStream(init.body);
      return new Response("", { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const key = await seedVideo(config, videoBytes, "qwen-seed.mp4");
    const response = await postJson(config.port, auth(config), "/api/video/qwen/upload", { key, apiKey: "test-qwen", model: "qwen3.5-omni-flash", displayName: "seed.mp4" });
    assert.equal(response.status, 200);
    const data = JSON.parse(response.body.toString("utf8"));
    assert.match(data.file.uri, /^oss:\/\/instant-dir\//);
    assert.equal(data.file.size, videoBytes.length);

    // Streaming + multipart correctness at the mock upstream.
    assert.equal(uploadInit.duplex, "half");
    const contentType = uploadInit.headers["content-type"];
    assert.match(contentType, /^multipart\/form-data; boundary=/);
    const boundary = contentType.split("boundary=")[1];
    const body = receivedBytes.toString("latin1");
    assert.ok(body.includes(`--${boundary}`));
    assert.ok(body.includes('name="policy"'));
    assert.ok(body.includes("policy-data"));
    assert.ok(body.includes('name="key"'));
    // The exact video bytes appear inside the multipart envelope.
    assert.ok(receivedBytes.includes(videoBytes), "multipart body must contain the exact stored bytes");
    assert.equal(uploadInit.headers["content-length"], String(receivedBytes.length));
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
    await rm(storeRoot, { recursive: true, force: true });
    await rm(staticRoot, { recursive: true, force: true });
  }
});
