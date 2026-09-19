import { videoBucket } from "../../_lib/video-store";

export async function POST(request: Request) {
  const { key, uploadId } = await request.json() as { key?: string; uploadId?: string };
  if (!key || !uploadId) return Response.json({ error: "缺少上传任务标识" }, { status: 400 });
  const bucket = videoBucket();
  await bucket.resumeMultipartUpload(key, uploadId).abort();
  return Response.json({ ok: true });
}
