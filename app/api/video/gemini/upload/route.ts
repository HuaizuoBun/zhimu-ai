import { geminiJson, geminiKey } from "../../../_lib/gemini";
import { errorResponse, UpstreamError } from "../../../_lib/llm";
import { videoBucket } from "../../../_lib/video-store";

export async function POST(request: Request) {
  try {
    const { key, apiKey, displayName } = await request.json() as { key?: string; apiKey?: string; displayName?: string };
    if (!key?.startsWith("videos/")) throw new UpstreamError("视频存储标识无效", 400);
    const token = geminiKey(apiKey || "");
    const bucket = videoBucket();
    const object = await bucket.get(key);
    if (!object?.body) throw new UpstreamError("找不到已上传的视频，请重新上传", 404);
    if (object.size > 2 * 1024 * 1024 * 1024) throw new UpstreamError("Gemini Files API 单文件上限为 2GB", 413);
    const mimeType = object.httpMetadata?.contentType || "video/mp4";
    const startResponse = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: {
        "x-goog-api-key": token,
        "content-type": "application/json",
        "x-goog-upload-protocol": "resumable",
        "x-goog-upload-command": "start",
        "x-goog-upload-header-content-length": String(object.size),
        "x-goog-upload-header-content-type": mimeType,
      },
      body: JSON.stringify({ file: { display_name: (displayName || key.split("/").at(-1) || "video").slice(0, 120) } }),
    });
    if (!startResponse.ok) await geminiJson(startResponse);
    const uploadUrl = startResponse.headers.get("x-goog-upload-url");
    if (!uploadUrl) throw new UpstreamError("Gemini 没有返回文件上传地址");
    // Node/undici requires duplex for streaming bodies (ignored by worker fetch).
    const uploadInit: RequestInit & { duplex?: "half" } = {
      method: "POST",
      signal: AbortSignal.timeout(1200000),
      headers: {
        "content-length": String(object.size),
        "x-goog-upload-offset": "0",
        "x-goog-upload-command": "upload, finalize",
      },
      duplex: "half",
      body: object.body as BodyInit,
    };
    const uploadResponse = await fetch(uploadUrl, uploadInit);
    const data = await geminiJson(uploadResponse);
    const file = data.file as Record<string, unknown> | undefined;
    if (!file || typeof file.name !== "string" || typeof file.uri !== "string") throw new UpstreamError("Gemini 文件上传响应不完整");
    return Response.json({ ok: true, file: { name: file.name, uri: file.uri, mimeType: file.mimeType || mimeType, state: file.state || "PROCESSING" } });
  } catch (error) {
    return errorResponse(error);
  }
}
