// Platform-neutral video storage contract shared by the Cloudflare worker
// (r2.ts adapter) and the desktop local store. Route handlers must import
// videoBucket() from this module only — never from a platform adapter.

export type UploadedPart = { partNumber: number; etag: string };

export type MultipartUpload = {
  uploadId: string;
  uploadPart(partNumber: number, body: ReadableStream<Uint8Array>): Promise<UploadedPart>;
  complete(parts: UploadedPart[]): Promise<{ key: string; size: number }>;
  abort(): Promise<void>;
};

export type StoredVideo = {
  body: ReadableStream<Uint8Array>;
  size: number;
  httpMetadata?: { contentType?: string };
  range?: { offset: number; length: number };
};

export type PutResult = { key: string; size: number };

export type VideoBucket = {
  createMultipartUpload(key: string, options: { httpMetadata: { contentType: string } }): Promise<MultipartUpload>;
  resumeMultipartUpload(key: string, uploadId: string): MultipartUpload;
  get(key: string, options?: { range?: Headers }): Promise<StoredVideo | null>;
  put(key: string, value: ReadableStream<Uint8Array>, options: { httpMetadata: { contentType: string } }): Promise<PutResult>;
  delete(key: string): Promise<void>;
};

let currentBucket: VideoBucket | undefined;

export function setVideoBucket(bucket: VideoBucket | undefined) {
  if (bucket) currentBucket = bucket;
}

export function videoBucket(): VideoBucket {
  if (!currentBucket) throw new Error("视频存储未初始化：请先注入平台实现");
  return currentBucket;
}
