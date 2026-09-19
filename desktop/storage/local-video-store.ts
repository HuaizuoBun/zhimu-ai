// Local video storage for the desktop app. Implements the shared VideoBucket
// contract with streaming writes (no full-file buffering), server-generated
// opaque identifiers, multipart merge with atomic replace, Range reads and
// startup cleanup that tolerates Windows file locks.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { MultipartUpload, PutResult, StoredVideo, UploadedPart, VideoBucket } from "../../app/api/_lib/video-store";
import { UpstreamError } from "../../app/api/_lib/llm";

const DEFAULT_MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_PART_SIZE = 8 * 1024 * 1024;
const MAX_PART_NUMBER = 256;
const OBJECT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^videos\/[A-Za-z0-9._\u4e00-\u9fff-]+$/;
const UPLOAD_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export type LocalStoreLimits = { maxFileSize?: number; maxPartSize?: number };

type Manifest = {
  key: string;
  contentType: string;
  parts: Record<string, { etag: string; size: number }>;
};

const RETRY = { maxRetries: 5, retryDelay: 200 } as const;

function encodeKey(key: string) {
  return encodeURIComponent(key);
}

function assertKey(key: string) {
  if (!KEY_PATTERN.test(key)) throw new UpstreamError("视频存储标识无效", 400);
  return encodeKey(key);
}

function assertUploadId(uploadId: string) {
  if (!UPLOAD_ID_PATTERN.test(uploadId)) throw new UpstreamError("上传任务标识无效", 400);
  return uploadId;
}

class LocalMultipartUpload implements MultipartUpload {
  private store: LocalVideoStore;
  readonly uploadId: string;
  private key: string;

  constructor(store: LocalVideoStore, uploadId: string, key: string) {
    this.store = store;
    this.uploadId = uploadId;
    this.key = key;
  }

  private uploadDir() {
    return path.join(this.store.uploadsDir, this.uploadId);
  }

  private async readManifest(): Promise<Manifest> {
    let raw: string;
    try {
      raw = await readFile(path.join(this.uploadDir(), "manifest.json"), "utf8");
    } catch {
      throw new UpstreamError("上传任务不存在或已失效", 404);
    }
    let manifest: Manifest;
    try {
      manifest = JSON.parse(raw) as Manifest;
    } catch {
      throw new UpstreamError("上传任务记录已损坏", 500);
    }
    // uploadId must stay bound to its key for the whole task.
    if (manifest.key !== this.key) throw new UpstreamError("上传任务与视频标识不匹配", 400);
    return manifest;
  }

  private async writeManifest(manifest: Manifest) {
    const target = path.join(this.uploadDir(), "manifest.json");
    const temp = `${target}.tmp`;
    await writeFile(temp, JSON.stringify(manifest), "utf8");
    await rename(temp, target);
  }

  async uploadPart(partNumber: number, body: ReadableStream<Uint8Array>): Promise<UploadedPart> {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PART_NUMBER) {
      throw new UpstreamError("分片编号无效", 400);
    }
    const manifest = await this.readManifest();
    let bytes = 0;
    const hash = createHash("sha256");
    const store = this.store;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.byteLength;
        if (bytes > store.maxPartSize) {
          callback(new UpstreamError(`视频分片不能超过 ${Math.floor(store.maxPartSize / 1024 / 1024)}MB`, 413));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    const partTemp = path.join(this.uploadDir(), `part-${partNumber}.tmp`);
    try {
      await pipeline(Readable.fromWeb(body as unknown as NodeWebReadableStream<Uint8Array>), counter, createWriteStream(partTemp, { flags: "wx" }));
    } catch (error) {
      await rm(partTemp, { force: true });
      throw error;
    }
    if (bytes <= 0) {
      await rm(partTemp, { force: true });
      throw new UpstreamError("分片内容为空", 400);
    }
    // Cumulative cap on actually written bytes, not client claims.
    const existing = Object.values(manifest.parts).reduce((sum, part) => sum + part.size, 0);
    const previousSize = manifest.parts[String(partNumber)]?.size ?? 0;
    if (existing - previousSize + bytes > this.store.maxFileSize) {
      await rm(partTemp, { force: true });
      throw new UpstreamError("累计上传字节超过 2GB 限制", 413);
    }
    const etag = hash.digest("hex");
    const partPath = path.join(this.uploadDir(), `part-${partNumber}`);
    await rm(partPath, { force: true, ...RETRY });
    await rename(partTemp, partPath);
    manifest.parts[String(partNumber)] = { etag, size: bytes };
    await this.writeManifest(manifest);
    return { partNumber, etag };
  }

  async complete(parts: UploadedPart[]): Promise<{ key: string; size: number }> {
    const manifest = await this.readManifest();
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const numbers = sorted.map((part) => part.partNumber);
    if (new Set(numbers).size !== numbers.length || numbers[0] !== 1 || numbers.some((number, index) => number !== index + 1)) {
      const missing: number[] = [];
      for (let number = 1; number <= numbers.length; number++) if (!numbers.includes(number)) missing.push(number);
      throw new UpstreamError(`分片不连续或缺失${missing.length ? `（缺少 ${missing.join("、")}）` : ""}`, 400);
    }
    for (const part of sorted) {
      const recorded = manifest.parts[String(part.partNumber)];
      if (!recorded) throw new UpstreamError(`第 ${part.partNumber} 个分片尚未上传`, 400);
      if (recorded.etag !== part.etag) throw new UpstreamError(`第 ${part.partNumber} 个分片校验不一致，请重新上传该分片`, 409);
    }
    const totalSize = sorted.reduce((sum, part) => sum + (manifest.parts[String(part.partNumber)]?.size ?? 0), 0);
    if (totalSize > this.store.maxFileSize) throw new UpstreamError("实际视频大小超过 2GB", 413);

    // Merge parts in order via streams, then atomically replace into objects/.
    const encoded = assertKey(this.key);
    const finalPath = path.join(this.store.objectsDir, encoded);
    const mergeTemp = path.join(this.store.objectsDir, `${encoded}.merging`);
    await rm(mergeTemp, { force: true, ...RETRY });
    try {
      for (const part of sorted) {
        const partPath = path.join(this.uploadDir(), `part-${part.partNumber}`);
        await pipeline(createReadStream(partPath), createWriteStream(mergeTemp, { flags: "a" }));
      }
      const merged = await stat(mergeTemp);
      if (merged.size !== totalSize) throw new UpstreamError("合并后的分片字节数与记录不一致", 500);
      await this.store.writeObjectMeta(encoded, { size: totalSize, contentType: manifest.contentType });
      await rm(finalPath, { force: true, ...RETRY });
      await rename(mergeTemp, finalPath);
    } catch (error) {
      await rm(mergeTemp, { force: true, ...RETRY });
      throw error;
    }
    await rm(this.uploadDir(), { recursive: true, force: true, ...RETRY });
    return { key: this.key, size: totalSize };
  }

  async abort() {
    await rm(this.uploadDir(), { recursive: true, force: true, ...RETRY });
  }
}

export class LocalVideoStore implements VideoBucket {
  readonly objectsDir: string;
  readonly uploadsDir: string;
  readonly maxFileSize: number;
  readonly maxPartSize: number;

  constructor(rootDir: string, limits: LocalStoreLimits = {}) {
    this.objectsDir = path.join(rootDir, "objects");
    this.uploadsDir = path.join(rootDir, "uploads");
    this.maxFileSize = limits.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    this.maxPartSize = limits.maxPartSize ?? DEFAULT_MAX_PART_SIZE;
  }

  private async ensureDirs() {
    await mkdir(this.objectsDir, { recursive: true });
    await mkdir(this.uploadsDir, { recursive: true });
  }

  private objectPath(key: string) {
    return path.join(this.objectsDir, assertKey(key));
  }

  async writeObjectMeta(encoded: string, meta: { size: number; contentType: string }) {
    const metaTemp = path.join(this.objectsDir, `${encoded}.meta.tmp`);
    await writeFile(metaTemp, JSON.stringify(meta), "utf8");
    await rename(metaTemp, path.join(this.objectsDir, `${encoded}.meta.json`));
  }

  private async readObjectMeta(encoded: string): Promise<{ size: number; contentType: string } | null> {
    try {
      return JSON.parse(await readFile(path.join(this.objectsDir, `${encoded}.meta.json`), "utf8"));
    } catch {
      return null;
    }
  }

  async createMultipartUpload(key: string, options: { httpMetadata: { contentType: string } }): Promise<MultipartUpload> {
    assertKey(key);
    await this.ensureDirs();
    const uploadId = crypto.randomUUID();
    const dir = path.join(this.uploadsDir, uploadId);
    await mkdir(dir, { recursive: true });
    const manifest: Manifest = { key, contentType: options.httpMetadata.contentType, parts: {} };
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest), "utf8");
    return new LocalMultipartUpload(this, uploadId, key);
  }

  resumeMultipartUpload(key: string, uploadId: string): MultipartUpload {
    assertKey(key);
    assertUploadId(uploadId);
    return new LocalMultipartUpload(this, uploadId, key);
  }

  async get(key: string, options?: { range?: Headers }): Promise<StoredVideo | null> {
    const encoded = assertKey(key);
    const filePath = path.join(this.objectsDir, encoded);
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) return null;
    const meta = await this.readObjectMeta(encoded);
    const size = fileStat.size;
    const contentType = meta?.contentType || "application/octet-stream";

    const rangeHeader = options?.range?.get("range");
    if (!rangeHeader) {
      return { body: Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream<Uint8Array>, size, httpMetadata: { contentType } };
    }
    // Multi-range requests fall back to the full 200 response (documented choice).
    if (rangeHeader.includes(",")) {
      return { body: Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream<Uint8Array>, size, httpMetadata: { contentType } };
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) {
      return { body: Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream<Uint8Array>, size, httpMetadata: { contentType } };
    }
    const [, startText, endText] = match;
    let offset: number;
    let length: number;
    if (startText === "") {
      const suffix = Number(endText);
      if (!Number.isFinite(suffix) || suffix <= 0) throw new UpstreamError("请求的视频范围无效", 416);
      length = Math.min(suffix, size);
      offset = size - length;
    } else {
      offset = Number(startText);
      if (!Number.isFinite(offset) || offset < 0 || offset >= size) throw new UpstreamError("请求的视频范围无效", 416);
      if (endText === "") {
        length = size - offset;
      } else {
        const end = Number(endText);
        if (!Number.isFinite(end) || end < offset) throw new UpstreamError("请求的视频范围无效", 416);
        length = Math.min(end, size - 1) - offset + 1;
      }
    }
    if (length <= 0) throw new UpstreamError("请求的视频范围无效", 416);
    return {
      body: Readable.toWeb(createReadStream(filePath, { start: offset, end: offset + length - 1 })) as unknown as ReadableStream<Uint8Array>,
      size,
      httpMetadata: { contentType },
      range: { offset, length },
    };
  }

  async put(key: string, value: ReadableStream<Uint8Array>, options: { httpMetadata: { contentType: string } }): Promise<PutResult> {
    const encoded = assertKey(key);
    await this.ensureDirs();
    const finalPath = path.join(this.objectsDir, encoded);
    const tempPath = path.join(this.objectsDir, `${encoded}.putting`);
    await rm(tempPath, { force: true, ...RETRY });
    let size = 0;
    const maxFileSize = this.maxFileSize;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.byteLength;
        if (size > maxFileSize) {
          callback(new UpstreamError("实际写入字节超过 2GB 限制", 413));
          return;
        }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(value as unknown as NodeWebReadableStream<Uint8Array>), counter, createWriteStream(tempPath, { flags: "wx" }));
      await this.writeObjectMeta(encoded, { size, contentType: options.httpMetadata.contentType });
      await rm(finalPath, { force: true, ...RETRY });
      await rename(tempPath, finalPath);
    } catch (error) {
      await rm(tempPath, { force: true, ...RETRY });
      throw error;
    }
    return { key, size };
  }

  async delete(key: string): Promise<void> {
    const encoded = assertKey(key);
    await rm(path.join(this.objectsDir, encoded), { force: true, ...RETRY });
    await rm(path.join(this.objectsDir, `${encoded}.meta.json`), { force: true, ...RETRY });
    await rm(path.join(this.objectsDir, `${encoded}.merging`), { force: true, ...RETRY });
    await rm(path.join(this.objectsDir, `${encoded}.putting`), { force: true, ...RETRY });
  }

  // Called once at server startup: pending upload tasks from a previous run
  // are dead; completed objects older than 24h are leftovers from crashes.
  async cleanupAtStartup() {
    await this.ensureDirs();
    await rm(this.uploadsDir, { recursive: true, force: true, ...RETRY });
    await mkdir(this.uploadsDir, { recursive: true });
    const now = Date.now();
    for (const entry of await readdir(this.objectsDir).catch(() => [])) {
      if (entry.endsWith(".tmp")) continue; // cleaned by their owners above
      const filePath = path.join(this.objectsDir, entry);
      const fileStat = await stat(filePath).catch(() => null);
      if (fileStat?.isFile() && now - fileStat.mtimeMs > OBJECT_MAX_AGE_MS) {
        await rm(filePath, { force: true, ...RETRY }).catch(() => { /* still locked; retry next launch */ });
      }
    }
  }
}
