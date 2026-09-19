import { errorResponse, UpstreamError } from "../../_lib/llm";
import { videoBucket } from "../../_lib/video-store";

export async function GET(request: Request) {
  try {
    const key = new URL(request.url).searchParams.get("key");
    if (!key?.startsWith("videos/")) throw new UpstreamError("视频标识无效", 400);
    const object = await videoBucket().get(key, { range: request.headers });
    if (!object) throw new UpstreamError("临时视频不存在，请重新解析", 404);
    const type = object.httpMetadata?.contentType || "application/octet-stream";
    const headers = new Headers({ "content-type": /^video\/[a-z0-9.+-]+$/i.test(type) ? type : "application/octet-stream", "accept-ranges": "bytes", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" });
    const range = object.range;
    if (range) {
      headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
      headers.set("content-length", String(range.length));
    } else headers.set("content-length", String(object.size));
    return new Response(object.body, { status: range ? 206 : 200, headers });
  } catch (error) { return errorResponse(error); }
}
