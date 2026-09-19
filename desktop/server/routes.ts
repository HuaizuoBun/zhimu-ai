// Local HTTP service: static desktop UI + session validation + health check +
// migrated business APIs. Anything not yet migrated answers with an explicit
// 501 JSON error and never pretends to succeed.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import { UpstreamError } from "../../app/api/_lib/llm";
import * as debugRoute from "../../app/api/debug/route";
import * as analyzeRoute from "../../app/api/analyze/route";
import * as askRoute from "../../app/api/ask/route";
import * as framesRoute from "../../app/api/video/frames/route";
import * as uploadInitRoute from "../../app/api/upload/init/route";
import * as uploadPartRoute from "../../app/api/upload/part/route";
import * as uploadCompleteRoute from "../../app/api/upload/complete/route";
import * as uploadAbortRoute from "../../app/api/upload/abort/route";
import * as uploadDeleteRoute from "../../app/api/upload/delete/route";
import * as uploadMediaRoute from "../../app/api/upload/media/route";
import * as bilibiliSourceRoute from "../../app/api/source/bilibili/route";
import * as bilibiliVideoRoute from "../../app/api/source/bilibili/video/route";
import * as geminiUploadRoute from "../../app/api/video/gemini/upload/route";
import * as geminiStatusRoute from "../../app/api/video/gemini/status/route";
import * as geminiAnalyzeRoute from "../../app/api/video/gemini/analyze/route";
import * as qwenUploadRoute from "../../app/api/video/qwen/upload/route";
import * as qwenAnalyzeRoute from "../../app/api/video/qwen/analyze/route";

export type ServerConfig = {
  staticRoot: string;
  dataDir: string;
  cacheDir: string;
  token: string;
  port: number;
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function authorized(config: ServerConfig, host: string | undefined, origin: string | undefined, cookieHeader: string | undefined) {
  // Host must be our own 127.0.0.1 address (blocks DNS-rebinding style requests).
  if (host !== `127.0.0.1:${config.port}`) return false;
  // Requests carrying Origin (cross-site attempts) must be exactly our origin.
  if (origin && origin !== `http://127.0.0.1:${config.port}`) return false;
  // Every request needs the per-launch session credential.
  const cookies = (cookieHeader ?? "").split(";").map((part) => part.trim());
  return cookies.includes(`zhimu_session=${config.token}`);
}

async function serveStaticFile(config: ServerConfig, requestPath: string): Promise<Response> {
  const staticRoot = path.resolve(config.staticRoot);
  let target = path.resolve(staticRoot, "." + path.posix.normalize("/" + requestPath.replace(/[?#].*$/, "")));
  let fileStat = await stat(target).catch(() => null);
  if (!fileStat?.isFile()) {
    // SPA fallback: any non-asset path serves the app shell.
    target = path.join(staticRoot, "index.html");
    fileStat = await stat(target).catch(() => null);
  }
  if (!fileStat?.isFile()) {
    return Response.json({ ok: false, error: "未找到资源" }, { status: 404 });
  }
  const type = MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream";
  const body = Readable.toWeb(createReadStream(target)) as unknown as ReadableStream;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": type,
      "content-length": String(fileStat.size),
      "content-security-policy": CSP,
      "x-content-type-options": "nosniff",
      "cache-control": "no-cache",
    },
  });
}

export function createApp(config: ServerConfig) {
  const app = new Hono();

  // Mirror the web errorResponse contract: UpstreamError keeps its status.
  app.onError((error) => {
    const status = error instanceof UpstreamError && error.status >= 400 && error.status < 600 ? error.status : 500;
    const message = error instanceof Error ? error.message : "服务器内部错误";
    return Response.json({ ok: false, error: message }, { status });
  });

  app.use("*", async (c, next) => {
    const host = c.req.header("host");
    const origin = c.req.header("origin");
    if (!authorized(config, host, origin, c.req.header("cookie"))) {
      return c.json({ ok: false, error: "本地服务拒绝了未授权的请求" }, 403);
    }
    // Write endpoints additionally require a same-origin Origin header and,
    // for JSON APIs, an application/json content type (the part upload streams
    // raw bytes and is exempt).
    const method = c.req.method.toUpperCase();
    if ((method === "POST" || method === "PUT" || method === "DELETE") && c.req.path.startsWith("/api/")) {
      if (origin !== `http://127.0.0.1:${config.port}`) {
        return c.json({ ok: false, error: "本地服务拒绝了非同源的写请求" }, 403);
      }
      if (c.req.path !== "/api/upload/part") {
        const contentType = c.req.header("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          return c.json({ ok: false, error: "接口要求 application/json 请求体" }, 415);
        }
      }
    }
    await next();
  });

  app.get("/api/health", (c) =>
    c.json({ ok: true, app: "zhimu-ai-desktop", node: process.versions.node, uptimeSeconds: Math.round(process.uptime()) }));

  // Migrated business APIs (P3/P4): thin wrappers reusing the original handlers.
  const wrap = (handler: (request: Request) => Promise<Response>) => (c: Context) => handler(c.req.raw);
  app.post("/api/debug", wrap(debugRoute.POST));
  app.post("/api/analyze", wrap(analyzeRoute.POST));
  app.post("/api/ask", wrap(askRoute.POST));
  app.post("/api/video/frames", wrap(framesRoute.POST));
  app.post("/api/upload/init", wrap(uploadInitRoute.POST));
  app.put("/api/upload/part", wrap(uploadPartRoute.PUT));
  app.post("/api/upload/complete", wrap(uploadCompleteRoute.POST));
  app.post("/api/upload/abort", wrap(uploadAbortRoute.POST));
  app.post("/api/upload/delete", wrap(uploadDeleteRoute.POST));
  app.get("/api/upload/media", wrap(uploadMediaRoute.GET));
  app.post("/api/source/bilibili", wrap(bilibiliSourceRoute.POST));
  app.post("/api/source/bilibili/video", wrap(bilibiliVideoRoute.POST));
  app.post("/api/video/gemini/upload", wrap(geminiUploadRoute.POST));
  app.post("/api/video/gemini/status", wrap(geminiStatusRoute.POST));
  app.post("/api/video/gemini/analyze", wrap(geminiAnalyzeRoute.POST));
  app.post("/api/video/qwen/upload", wrap(qwenUploadRoute.POST));
  app.post("/api/video/qwen/analyze", wrap(qwenAnalyzeRoute.POST));

  // Unknown API paths answer an explicit 501 instead of a silent 404.
  app.all("/api/*", (c) =>
    c.json({ ok: false, error: `此接口尚未迁移到桌面版（开发阶段）：${c.req.method} ${c.req.path}` }, 501));

  app.get("*", async (c) => serveStaticFile(config, c.req.path));

  return app;
}
