import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { serve } from "@hono/node-server";
import { createApp, LocalVideoStore, setVideoBucket } from "../desktop/dist/test/wires.mjs";

function webStreamOf(buffer) {
  return Readable.toWeb(Readable.from(buffer));
}

async function streamToBuffer(webStream) {
  const reader = webStream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function uploadParts(store, key, contentType, parts) {
  const upload = await store.createMultipartUpload(key, { httpMetadata: { contentType } });
  const uploaded = [];
  for (let index = 0; index < parts.length; index += 1) {
    uploaded.push(await upload.uploadPart(index + 1, webStreamOf(parts[index])));
  }
  return { upload, uploaded };
}

test("local store merges multipart uploads byte-exactly and serves ranges", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhimu-store-"));
  const store = new LocalVideoStore(root);
  setVideoBucket(store);
  const key = "videos/11111111-2222-3333-4444-555555555555-测试视频.mp4";
  const partA = Buffer.from("0123456789");
  const partB = Buffer.from("ABCDEFGHIJ");
  const partC = Buffer.from("abcdefghij");
  try {
    const { upload, uploaded } = await uploadParts(store, key, "video/mp4", [partA, partB, partC]);
    const result = await upload.complete(uploaded);
    assert.equal(result.key, key);
    assert.equal(result.size, 30);

    // Full read returns the exact concatenation.
    const full = await store.get(key);
    assert.equal(full.size, 30);
    assert.equal(full.httpMetadata.contentType, "video/mp4");
    assert.equal((await streamToBuffer(full.body)).toString("utf8"), "0123456789ABCDEFGHIJabcdefghij");

    // Single range bytes=start-end.
    const range1 = await store.get(key, { range: new Headers({ range: "bytes=10-14" }) });
    assert.deepEqual(range1.range, { offset: 10, length: 5 });
    assert.equal((await streamToBuffer(range1.body)).toString("utf8"), "ABCDE");

    // Open range bytes=start-.
    const range2 = await store.get(key, { range: new Headers({ range: "bytes=20-" }) });
    assert.deepEqual(range2.range, { offset: 20, length: 10 });
    assert.equal((await streamToBuffer(range2.body)).toString("utf8"), "abcdefghij");

    // Suffix range bytes=-suffix.
    const range3 = await store.get(key, { range: new Headers({ range: "bytes=-4" }) });
    assert.deepEqual(range3.range, { offset: 26, length: 4 });
    assert.equal((await streamToBuffer(range3.body)).toString("utf8"), "ghij");

    // Suffix larger than the file clamps to the whole file.
    const range4 = await store.get(key, { range: new Headers({ range: "bytes=-100" }) });
    assert.deepEqual(range4.range, { offset: 0, length: 30 });

    // End beyond file size clamps.
    const range5 = await store.get(key, { range: new Headers({ range: "bytes=25-999" }) });
    assert.deepEqual(range5.range, { offset: 25, length: 5 });

    // Unsatisfiable range -> 416.
    await assert.rejects(() => store.get(key, { range: new Headers({ range: "bytes=30-40" }) }), (error) => error.status === 416);
    await assert.rejects(() => store.get(key, { range: new Headers({ range: "bytes=-0" }) }), (error) => error.status === 416);

    // Multi-range falls back to the full body.
    const multi = await store.get(key, { range: new Headers({ range: "bytes=0-4,10-14" }) });
    assert.equal(multi.range, undefined);
    assert.equal(multi.size, 30);

    // Missing object -> null.
    assert.equal(await store.get("videos/00000000-0000-0000-0000-000000000000-none.mp4"), null);

    // delete removes the object.
    await store.delete(key);
    assert.equal(await store.get(key), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local store validates parts, etags, keys, limits and cancellation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhimu-store-"));
  // Small limits exercise the same enforcement logic as the 2GiB/8MiB defaults.
  const store = new LocalVideoStore(root, { maxFileSize: 100, maxPartSize: 20 });
  setVideoBucket(store);
  try {
    const key = "videos/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-小.mp4";
    const { upload, uploaded } = await uploadParts(store, key, "video/mp4", [Buffer.alloc(20, 1), Buffer.alloc(20, 2)]);
    // Missing part: claim a third part that was never uploaded.
    await assert.rejects(
      () => upload.complete([...uploaded, { partNumber: 3, etag: "f".repeat(64) }]),
      (error) => error.status === 400 && /分片/.test(error.message),
    );
    // Wrong etag is rejected with 409.
    await assert.rejects(
      () => upload.complete([{ partNumber: 1, etag: "0".repeat(64) }, uploaded[1]]),
      (error) => error.status === 409,
    );
    // Cumulative bytes beyond maxFileSize are rejected (actual bytes, not claims):
    // five 20-byte parts reach exactly 100; a sixth is over the cap.
    for (let extra = 3; extra <= 5; extra += 1) {
      await upload.uploadPart(extra, webStreamOf(Buffer.alloc(20, extra)));
    }
    await assert.rejects(() => upload.uploadPart(6, webStreamOf(Buffer.alloc(20, 6))), (error) => error.status === 413);
    // A part larger than maxPartSize is rejected.
    await assert.rejects(() => upload.uploadPart(7, webStreamOf(Buffer.alloc(21, 3))), (error) => error.status === 413);
    // Correct completion still works after the failed attempts.
    const done = await upload.complete(uploaded);
    assert.equal(done.size, 40);

    // uploadId must stay bound to its key.
    const other = await store.createMultipartUpload("videos/other-key.mp4", { httpMetadata: { contentType: "video/mp4" } });
    const hijack = store.resumeMultipartUpload("videos/hijacked-key.mp4", other.uploadId);
    await assert.rejects(() => hijack.uploadPart(1, webStreamOf(Buffer.alloc(5))), (error) => error.status === 400);

    // Path-like or malformed keys never reach the disk.
    await assert.rejects(() => store.get("../etc/passwd"), (error) => error.status === 400);
    await assert.rejects(() => store.get("videos/../escape"), (error) => error.status === 400);
    await assert.rejects(() => store.put("videos/a b/c", webStreamOf(Buffer.alloc(5)), { httpMetadata: { contentType: "video/mp4" } }), (error) => error.status === 400);

    // put streams with the size cap enforced on actual bytes.
    const putSmall = await store.put("videos/put-ok.bin", webStreamOf(Buffer.alloc(30, 7)), { httpMetadata: { contentType: "video/mp4" } });
    assert.equal(putSmall.size, 30);
    await assert.rejects(
      () => store.put("videos/put-big.bin", webStreamOf(Buffer.alloc(101, 7)), { httpMetadata: { contentType: "video/mp4" } }),
      (error) => error.status === 413,
    );

    // abort removes the pending task; resuming it then fails.
    const pending = await store.createMultipartUpload("videos/pending.mp4", { httpMetadata: { contentType: "video/mp4" } });
    await pending.uploadPart(1, webStreamOf(Buffer.alloc(5, 9)));
    await pending.abort();
    await assert.rejects(() => store.resumeMultipartUpload("videos/pending.mp4", pending.uploadId).uploadPart(2, webStreamOf(Buffer.alloc(5, 9))), (error) => error.status === 404);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local store startup cleanup removes stale uploads and old objects", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhimu-store-cleanup-"));
  const store = new LocalVideoStore(root);
  try {
    // Leftover pending upload from a previous run.
    const oldUpload = await store.createMultipartUpload("videos/leftover.mp4", { httpMetadata: { contentType: "video/mp4" } });
    await oldUpload.uploadPart(1, webStreamOf(Buffer.alloc(10, 1)));
    // A completed object that is fresh, and one that is 25h old.
    await store.put("videos/fresh.mp4", webStreamOf(Buffer.alloc(10, 2)), { httpMetadata: { contentType: "video/mp4" } });
    await store.put("videos/stale.mp4", webStreamOf(Buffer.alloc(10, 3)), { httpMetadata: { contentType: "video/mp4" } });
    const stalePath = path.join(store.objectsDir, encodeURIComponent("videos/stale.mp4"));
    const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(stalePath, dayAgo, dayAgo);

    await store.cleanupAtStartup();

    assert.equal((await readdir(store.uploadsDir)).length, 0, "pending uploads are wiped");
    assert.notEqual(await store.get("videos/fresh.mp4"), null, "fresh object kept");
    assert.equal(await store.get("videos/stale.mp4"), null, "stale object removed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---- Route-level tests over real HTTP with the desktop server + local store ----

async function startApp(limits) {
  const staticRoot = await mkdtemp(path.join(tmpdir(), "zhimu-static-"));
  await writeFile(path.join(staticRoot, "index.html"), "<!doctype html><html><body>zhimu</body></html>");
  const storeRoot = await mkdtemp(path.join(tmpdir(), "zhimu-store-http-"));
  const store = new LocalVideoStore(storeRoot, limits);
  setVideoBucket(store);
  const config = { staticRoot, dataDir: "", cacheDir: storeRoot, token: "test-token-value", port: 0 };
  const app = createApp(config);
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
    config.port = info.port;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { server, config, store, storeRoot, staticRoot };
}

function request(port, { method = "GET", path: urlPath = "/", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function authHeaders(config, extra = {}) {
  return {
    host: `127.0.0.1:${config.port}`,
    origin: `http://127.0.0.1:${config.port}`,
    cookie: `zhimu_session=${config.token}`,
    ...extra,
  };
}

test("upload API flow over HTTP: init, parts, complete, range media, delete", async () => {
  const { server, config, storeRoot, staticRoot } = await startApp();
  try {
    const jsonHeaders = (extra = {}) => authHeaders(config, { "content-type": "application/json", ...extra });

    // init
    const init = await request(config.port, { method: "POST", path: "/api/upload/init", headers: jsonHeaders(), body: JSON.stringify({ name: "演示.mp4", type: "video/mp4", size: 30 }) });
    assert.equal(init.status, 200);
    const { key, uploadId } = JSON.parse(init.body.toString("utf8"));
    assert.ok(key.startsWith("videos/"));

    // parts (raw bytes PUT; no content-type requirement)
    const parts = [];
    for (const [index, chunk] of [Buffer.from("0123456789"), Buffer.from("ABCDEFGHIJ"), Buffer.from("abcdefghij")].entries()) {
      const part = await request(config.port, {
        method: "PUT",
        path: `/api/upload/part?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${index + 1}`,
        headers: authHeaders(config, { "content-length": String(chunk.length) }),
        body: chunk,
      });
      assert.equal(part.status, 200);
      parts.push(JSON.parse(part.body.toString("utf8")));
    }

    // complete
    const complete = await request(config.port, { method: "POST", path: "/api/upload/complete", headers: jsonHeaders(), body: JSON.stringify({ key, uploadId, parts }) });
    assert.equal(complete.status, 200);
    assert.equal(JSON.parse(complete.body.toString("utf8")).size, 30);

    // media full + range semantics through the real HTTP layer
    const media = await request(config.port, { path: `/api/upload/media?key=${encodeURIComponent(key)}`, headers: authHeaders(config) });
    assert.equal(media.status, 200);
    assert.equal(media.headers["content-length"], "30");
    assert.equal(media.headers["accept-ranges"], "bytes");
    assert.equal(media.body.toString("utf8"), "0123456789ABCDEFGHIJabcdefghij");

    const partial = await request(config.port, { path: `/api/upload/media?key=${encodeURIComponent(key)}`, headers: authHeaders(config, { range: "bytes=10-14" }) });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers["content-range"], "bytes 10-14/30");
    assert.equal(partial.headers["content-length"], "5");
    assert.equal(partial.body.toString("utf8"), "ABCDE");

    const suffix = await request(config.port, { path: `/api/upload/media?key=${encodeURIComponent(key)}`, headers: authHeaders(config, { range: "bytes=-4" }) });
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers["content-range"], "bytes 26-29/30");
    assert.equal(suffix.body.toString("utf8"), "ghij");

    const invalid = await request(config.port, { path: `/api/upload/media?key=${encodeURIComponent(key)}`, headers: authHeaders(config, { range: "bytes=99-" }) });
    assert.equal(invalid.status, 416);

    // Write endpoints enforce same-origin + JSON content type.
    assert.equal((await request(config.port, { method: "POST", path: "/api/upload/init", headers: authHeaders(config, { origin: "http://evil.example", "content-type": "application/json" }), body: "{}" })).status, 403);
    assert.equal((await request(config.port, { method: "POST", path: "/api/upload/init", headers: authHeaders(config), body: "{}" })).status, 415);

    // Unknown API paths still answer 501.
    assert.equal((await request(config.port, { method: "POST", path: "/api/not-a-real-route", headers: jsonHeaders(), body: JSON.stringify({}) })).status, 501);

    // delete cleans up; subsequent media is 404.
    assert.equal((await request(config.port, { method: "POST", path: "/api/upload/delete", headers: jsonHeaders(), body: JSON.stringify({ key }) })).status, 200);
    assert.equal((await request(config.port, { path: `/api/upload/media?key=${encodeURIComponent(key)}`, headers: authHeaders(config) })).status, 404);

    // abort cancels a pending task.
    const init2 = await request(config.port, { method: "POST", path: "/api/upload/init", headers: jsonHeaders(), body: JSON.stringify({ name: "取消.mp4", type: "video/mp4", size: 10 }) });
    const { key: key2, uploadId: uploadId2 } = JSON.parse(init2.body.toString("utf8"));
    assert.equal((await request(config.port, { method: "POST", path: "/api/upload/abort", headers: jsonHeaders(), body: JSON.stringify({ key: key2, uploadId: uploadId2 }) })).status, 200);
    assert.equal((await request(config.port, { method: "POST", path: "/api/upload/complete", headers: jsonHeaders(), body: JSON.stringify({ key: key2, uploadId: uploadId2, parts: [{ partNumber: 1, etag: "x" }] }) })).status, 404);
  } finally {
    server.close();
    await rm(storeRoot, { recursive: true, force: true });
    await rm(staticRoot, { recursive: true, force: true });
  }
});

test("ask API answers with article context through the desktop server", async () => {
  const { server, config, storeRoot, staticRoot } = await startApp();
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return Response.json({ choices: [{ message: { content: "这是基于视频的回答 [00:12]" } }] });
  };
  try {
    const response = await request(config.port, {
      method: "POST",
      path: "/api/ask",
      headers: authHeaders(config, { "content-type": "application/json" }),
      body: JSON.stringify({
        config: { provider: "deepseek", endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-chat", apiKey: "test" },
        question: "视频讲了什么？",
        analysis: {
          title: "测试", duration: "01:00", sourceLabel: "字幕", oneLineSummary: "一句话", finalSummary: "总结", keywords: [],
          chapters: [{ time: "00:00", seconds: 0, tag: "", title: "章节", intro: "", points: ["要点"] }],
          transcript: [{ time: "00:12", seconds: 12, text: "证据" }],
          mindmap: { label: "测试", children: [{ label: "章节" }] },
          article: { version: 1, title: "测试", sections: [{ id: "s", title: "章节", points: [{ label: "标签", text: "解释" }] }], conclusion: { paragraphs: ["总结"] } },
        },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body.toString("utf8")).answer, "这是基于视频的回答 [00:12]");
    // The Q&A context combines raw evidence with article key points.
    const context = JSON.parse(requestBody.messages[1].content.split("视频知识：")[1].split("\n\n问题：")[0]);
    assert.equal(context.articlePoints[0], "标签：解释");
    assert.equal(context.conclusion.paragraphs[0], "总结");
    assert.equal(context.transcript[0].text, "证据");
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
    await rm(storeRoot, { recursive: true, force: true });
    await rm(staticRoot, { recursive: true, force: true });
  }
});

test("analyze API runs the article pipeline through the desktop server", async () => {
  const { server, config, storeRoot, staticRoot } = await startApp();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    const user = payload.messages.at(-1).content;
    calls.push(user);
    if (user.includes("提取全部有信息量的证据条目")) {
      return Response.json({ choices: [{ message: { content: JSON.stringify({ evidence: [{ time: "00:00", text: "主题证据甲，数据 1" }, { time: "00:30", text: "主题证据乙，数据 2" }] }) } }] });
    }
    if (user.includes("归并为若干主题")) {
      return Response.json({ choices: [{ message: { content: JSON.stringify({ topics: [{ title: "合并主题", gist: "概要", evidenceIds: ["e0", "e1"] }] }) } }] });
    }
    if (user.includes("撰写一个文章章节")) {
      return Response.json({ choices: [{ message: { content: JSON.stringify({ sections: [{ title: "合并主题", gist: "概要", points: [{ label: "标签", text: "解释" }] }] }) } }] });
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify({ title: "桌面文章标题", oneLineSummary: "一句话", finalSummary: "总结", keywords: ["桌面"], conclusion: { paragraphs: ["总结段"] } }) } }] });
  };
  try {
    const response = await request(config.port, {
      method: "POST",
      path: "/api/analyze",
      headers: authHeaders(config, { "content-type": "application/json" }),
      body: JSON.stringify({
        config: { provider: "deepseek", endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-chat", apiKey: "test" },
        metadata: { title: "桌面测试" },
        transcript: [{ time: "00:00", text: "第一条" }, { time: "00:30", text: "第二条" }],
      }),
    });
    assert.equal(response.status, 200);
    const analysis = JSON.parse(response.body.toString("utf8")).analysis;
    assert.equal(analysis.article.sections[0].title, "合并主题");
    assert.equal(analysis.finalSummary, "总结段");
    assert.equal(calls.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
    await rm(storeRoot, { recursive: true, force: true });
    await rm(staticRoot, { recursive: true, force: true });
  }
});
