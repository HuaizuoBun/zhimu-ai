import { UploadedPart, videoBucket } from "../../_lib/video-store";

export async function POST(request: Request) {
  const { key, uploadId, parts } = await request.json() as { key?: string; uploadId?: string; parts?: UploadedPart[] };
  if (!key || !uploadId || !parts?.length) return Response.json({ error: "无法合并空的上传任务" }, { status: 400 });
  const bucket = videoBucket();
  const upload = bucket.resumeMultipartUpload(key, uploadId);
  const object = await upload.complete(parts.sort((a, b) => a.partNumber - b.partNumber));
  if (object.size > 2 * 1024 * 1024 * 1024) {
    await bucket.delete(object.key);
    return Response.json({ error: "实际视频大小超过 2GB，已移除该临时文件" }, { status: 413 });
  }
  return Response.json({ key: object.key, size: object.size });
}
