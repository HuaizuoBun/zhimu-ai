// 知幕 AI 桌面版主进程：窗口、专用会话、后台本地服务（utilityProcess）、
// 就绪握手、单实例与正常退出。凭据只通过父子进程消息传递，不进入 URL、日志或源码。
import { app, BrowserWindow, dialog, Menu, session, shell, utilityProcess } from "electron";
import { randomBytes } from "node:crypto";
import path from "node:path";

type ServerMessage =
  | { type: "ready"; port: number; token: string; node?: string; startupMs?: number }
  | { type: "error"; message: string };

let mainWindow: BrowserWindow | null = null;
let serverProcess: Electron.UtilityProcess | null = null;
let loadedOrigin = "";
let shuttingDown = false;

const isPackaged = app.isPackaged;
const serverModulePath = isPackaged
  ? path.join(process.resourcesPath, "app.asar.unpacked", "desktop", "dist", "server", "index.cjs")
  : path.join(__dirname, "..", "server", "index.cjs");
const staticRootPath = isPackaged
  ? path.join(process.resourcesPath, "app.asar.unpacked", "desktop", "dist", "renderer")
  : path.join(__dirname, "..", "renderer");
// The preload can live inside the asar archive; Electron loads it natively.
const preloadPath = path.join(__dirname, "preload.cjs");

function log(stage: string, detail?: string) {
  console.log(`[zhimu-main] ${stage}${detail ? ` · ${detail}` : ""}`);
}

function isOwnUrl(url: string) {
  return loadedOrigin !== "" && url.startsWith(loadedOrigin + "/");
}

function openExternal(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
    void shell.openExternal(parsed.toString());
  } catch { /* ignore malformed URLs */ }
}

function showErrorAndQuit(title: string, detail: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  dialog.showErrorBox(title, detail);
  app.exit(1);
}

function stopServer() {
  if (!serverProcess) return;
  try {
    serverProcess.postMessage({ type: "shutdown" });
  } catch { /* already gone */ }
  const processRef = serverProcess;
  setTimeout(() => {
    try {
      processRef.kill();
    } catch { /* already exited */ }
  }, 2000);
}

async function openWindow(port: number, token: string, info?: { node?: string; startupMs?: number }) {
  loadedOrigin = `http://127.0.0.1:${port}`;

  // Dedicated non-persistent session; the credential is an HttpOnly,
  // SameSite=Strict host cookie for this launch only.
  const partition = `inactive:zhimu-${randomBytes(8).toString("hex")}`;
  const appSession = session.fromPartition(partition);
  await appSession.cookies.set({
    url: loadedOrigin,
    name: "zhimu_session",
    value: token,
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: "/",
  });

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: "#f7f5f8",
    title: "知幕 AI",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      session: appSession,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    log("window-shown", `服务启动 ${info?.startupMs ?? "?"} ms · Electron 内置 Node ${info?.node ?? "?"}`);
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isOwnUrl(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });

  // Exported .md files go through a normal save dialog with a suggested name.
  appSession.on("will-download", (_event, item) => {
    const suggested = item.getFilename();
    item.setSaveDialogOptions({
      defaultPath: path.join(app.getPath("downloads"), suggested),
    });
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    showErrorAndQuit("知幕 AI 界面异常退出", `渲染进程退出（${details.reason}）。请重新打开应用。`);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(`${loadedOrigin}/`);
}

function start() {
  const dataDir = app.getPath("userData");
  const cacheDir = path.join(app.getPath("temp"), "zhimu-ai-video");

  log("forking-server", `static=${staticRootPath}`);
  serverProcess = utilityProcess.fork(serverModulePath, [
    "--static-root", staticRootPath,
    "--data-dir", dataDir,
    "--cache-dir", cacheDir,
  ], { serviceName: "zhimu-local-server" });

  serverProcess.stdout?.on("data", (chunk: Buffer) => process.stdout.write(`[zhimu-server] ${chunk}`));
  serverProcess.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[zhimu-server] ${chunk}`));

  serverProcess.on("message", (message) => {
    const parsed = message as ServerMessage;
    if (parsed.type === "ready") {
      log("server-ready", `127.0.0.1:${parsed.port}`);
      void openWindow(parsed.port, parsed.token, { node: parsed.node, startupMs: parsed.startupMs });
    } else if (parsed.type === "error") {
      showErrorAndQuit("知幕 AI 无法启动", parsed.message);
    }
  });

  serverProcess.on("exit", (code) => {
    if (!shuttingDown) {
      showErrorAndQuit("知幕 AI 本地服务已停止", `后台服务退出（代码 ${code}）。请重新打开应用。`);
    }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Remove the default File/Edit/View menu bar: the app has its own
  // top navigation, and the packaged build only runs bundled UI.
  Menu.setApplicationMenu(null);

  app.whenReady().then(() => {
    log("app-ready", `开发 Node ${process.versions.node} · Electron ${process.versions.electron}`);
    start();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopServer();
  });

  app.on("will-quit", () => {
    try {
      serverProcess?.kill();
    } catch { /* already exited */ }
  });
}
