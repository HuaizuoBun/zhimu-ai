// Server entry run inside an Electron utilityProcess.
// Binds 127.0.0.1 with an ephemeral port, then reports the actual port and the
// per-launch session credential to the main process over the parent port.
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { setVideoBucket } from "../../app/api/_lib/video-store";
import { LocalVideoStore } from "../storage/local-video-store";
import { createApp } from "./routes";

type ParentPort = {
  postMessage(value: unknown): void;
  on(event: "message", listener: (event: { data?: unknown }) => void): void;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
if (!parentPort) {
  console.error("[zhimu-server] 必须在 Electron utilityProcess 中运行");
  process.exit(1);
}

function argValue(name: string): string | undefined {
  const argv = process.argv;
  for (let index = 0; index < argv.length - 1; index += 1) {
    if (argv[index] === name) return argv[index + 1];
  }
  return undefined;
}

const staticRoot = argValue("--static-root");
if (!staticRoot) {
  parentPort.postMessage({ type: "error", message: "服务缺少 --static-root 参数" });
  process.exit(1);
}
const dataDir = argValue("--data-dir") ?? "";
const cacheDir = argValue("--cache-dir") ?? "";

const token = randomBytes(32).toString("hex");
const config = { staticRoot, dataDir, cacheDir, token, port: 0 };

async function main() {
  try {
    if (dataDir) await mkdir(dataDir, { recursive: true });
    if (cacheDir) await mkdir(cacheDir, { recursive: true });
  } catch (error) {
    parentPort.postMessage({ type: "error", message: `无法创建数据目录：${error instanceof Error ? error.message : String(error)}` });
    process.exit(1);
  }

  // Local video storage with startup cleanup of stale temp tasks.
  const store = new LocalVideoStore(cacheDir);
  setVideoBucket(store);
  const cleanupStartedAt = Date.now();
  await store.cleanupAtStartup();
  console.log(`[zhimu-server] video store ready (cleanup ${Date.now() - cleanupStartedAt} ms)`);

  const app = createApp(config);
  const startedAt = Date.now();
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
    config.port = info.port;
    parentPort.postMessage({
      type: "ready",
      port: info.port,
      token,
      node: process.versions.node,
      startupMs: Date.now() - startedAt,
    });
  }) as unknown as import("node:http").Server;

  server.keepAliveTimeout = 5000;
  server.on("error", (error: NodeJS.ErrnoException) => {
    parentPort.postMessage({ type: "error", message: `本地服务错误：${error.message}` });
  });

  parentPort.on("message", (event) => {
    const message = event.data as { type?: string } | undefined;
    if (message?.type === "shutdown") {
      try {
        server.closeIdleConnections();
      } catch { /* older Node without closeIdleConnections */ }
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    }
  });
}

void main();
