import { videoBucket } from "../../_lib/video-store";

export async function PUT(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const uploadId = url.searchParams.get("uploadId");
  const partNumber = Number(url.searchParams.get("partNumber"));
  if (!key?.startsWith("videos/") || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 256 || !request.body) {
    return Response.json({ error: "分片参数不完整" }, { status: 400 });
  }
  const bucket = videoBucket();
  const upload = bucket.resumeMultipartUpload(key, uploadId);
  let bytes = 0;
  const bounded = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
    bytes += chunk.byteLength;
    if (bytes > 8 * 1024 * 1024) throw new Error("视频分片不能超过 8MB");
    controller.enqueue(chunk);
  } }));
  const part = await upload.uploadPart(partNumber, bounded);
  return Response.json({ partNumber: part.partNumber, etag: part.etag });
}
