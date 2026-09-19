// Test-only entry: re-exports the desktop server surface as one ESM bundle
// so Node tests can import it without extension resolution issues.
// This file is never part of the packaged application.
export { createApp } from "./server/routes";
export { LocalVideoStore } from "./storage/local-video-store";
export { setVideoBucket, videoBucket } from "../app/api/_lib/video-store";
