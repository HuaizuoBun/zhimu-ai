// Minimal preload: exposes read-only desktop environment info only.
// No file system, shell, or IPC bridge is handed to the renderer.
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("zhimuDesktop", {
  isDesktop: true,
  platform: process.platform,
});
