import { videoBucket } from "../../_lib/video-store";

export async function POST(request: Request) {
  const { key } = await request.json() as { key?: string };
  if (!key?.startsWith("videos/")) return Response.json({ error: "视频存储标识无效" }, { status: 400 });
  await videoBucket().delete(key);
  return Response.json({ ok: true });
}
