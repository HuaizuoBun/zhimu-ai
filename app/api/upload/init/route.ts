import { videoBucket } from "../../_lib/video-store";

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;

export async function POST(request: Request) {
  const { name, type, size } = await request.json() as { name?: string; type?: string; size?: number };
  if (!name || !Number.isSafeInteger(size) || !size || size <= 0 || size > MAX_FILE_SIZE) {
    return Response.json({ error: "视频大小必须在 2GB 以内" }, { status: 413 });
  }
  const allowedTypes = ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/x-msvideo", "video/x-ms-wmv", "video/x-flv", "video/mpeg", "video/ogg"];
  if (type && !allowedTypes.includes(type)) return Response.json({ error: "仅支持视频文件类型" }, { status: 400 });
  const safeName = name.replace(/[^a-zA-Z0-9._\u4e00-\u9fff-]/g, "_").slice(-120);
  const key = `videos/${crypto.randomUUID()}-${safeName}`;
  const bucket = videoBucket();
  const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: type || "application/octet-stream" } });
  return Response.json({ key, uploadId: upload.uploadId });
}
