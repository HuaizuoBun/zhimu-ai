import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the 知幕 AI workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>知幕 AI｜把长视频变成可检索的知识<\/title>/i);
  assert.match(html, /把长视频，变成/);
  assert.match(html, /Bilibili/);
  assert.match(html, /本地视频/);
  assert.match(html, /2GB/);
  assert.doesNotMatch(html, /youtube|youtu\.be/i);
  assert.doesNotMatch(html, /codex-preview|Building your site|SkeletonPreview/);
});

test("emits product-specific social metadata", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /property="og:title" content="知幕 AI｜把长视频变成可检索的知识"/i);
  assert.match(html, /property="og:image" content="http:\/\/localhost(?::3000)?\/og.png"/i);
  assert.match(html, /name="twitter:card" content="summary_large_image"/i);
});
