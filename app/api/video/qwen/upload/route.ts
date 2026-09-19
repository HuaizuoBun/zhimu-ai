import { errorResponse, UpstreamError } from "../../../_lib/llm";
import { qwenJson, qwenKey } from "../../../_lib/qwen";
import { videoBucket } from "../../../_lib/video-store";

type Policy = {
  policy?: string;
  signature?: string;
  upload_dir?: string;
  upload_host?: string;
  max_file_size_mb?: string | number;
  oss_access_key_id?: string;
  x_oss_object_acl?: string;
  x_oss_forbid_overwrite?: string;
};

function multipartStream(fields: Array<[string, string]>, filename: string, contentType: string, body: ReadableStream<Uint8Array>) {
  const boundary = `----ZhiMuQwen${crypto.randomUUID().replace(/-/g, "")}`;
  const encoder = new TextEncoder();
  const fieldText = fields.map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`).join("");
  const safeName = filename.replace(/["\r\n]/g, "_");
  const prefix = encoder.encode(`${fieldText}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const reader = body.getReader();
  let stage: "prefix" | "body" | "suffix" | "done" = "prefix";
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (stage === "prefix") { controller.enqueue(prefix); stage = "body"; return; }
      if (stage === "body") {
        const chunk = await reader.read();
        if (!chunk.done) { controller.enqueue(chunk.value); return; }
        stage = "suffix";
      }
      if (stage === "suffix") { controller.enqueue(suffix); stage = "done"; controller.close(); }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  return { boundary, stream, overhead: prefix.byteLength + suffix.byteLength };
}

export async function POST(request: Request) {
  try {
    const { key, apiKey, model, displayName } = await request.json() as { key?: string; apiKey?: string; model?: string; displayName?: string };
    if (!key?.startsWith("videos/")) throw new UpstreamError("视频存储标识无效", 400);
    const token = qwenKey(apiKey || "");
    const modelName = model || "qwen3.5-omni-flash";
    const policyResponse = await fetch(`https://dashscope.aliyuncs.com/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(modelName)}`, {
      signal: AbortSignal.timeout(30000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    const policyJson = await qwenJson(policyResponse, "阿里云临时文件凭证接口");
    const policy = policyJson.data && typeof policyJson.data === "object" ? policyJson.data as Policy : {};
    if (!policy.upload_host || !policy.upload_dir || !policy.policy || !policy.signature || !policy.oss_access_key_id) throw new UpstreamError("阿里云没有返回完整的上传凭证");
    const uploadHost = new URL(policy.upload_host);
    if (uploadHost.protocol !== "https:" || !/(^|\.)aliyuncs\.com$/i.test(uploadHost.hostname)) throw new UpstreamError("阿里云返回的上传地址无效");
    const object = await videoBucket().get(key);
    if (!object?.body) throw new UpstreamError("找不到已上传的视频，请重新上传", 404);
    const maxBytes = Number(policy.max_file_size_mb || 1024) * 1024 * 1024;
    if (object.size > maxBytes) throw new UpstreamError(`当前阿里模型的临时上传上限为 ${policy.max_file_size_mb || 1024}MB；更大文件请切换 Gemini 视频理解`, 413);
    const contentType = object.httpMetadata?.contentType || "video/mp4";
    const filename = (displayName || key.split("/").at(-1) || "video.mp4").slice(-120);
    const objectKey = `${policy.upload_dir}/${crypto.randomUUID()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const fields: Array<[string, string]> = [
      ["OSSAccessKeyId", policy.oss_access_key_id], ["Signature", policy.signature], ["policy", policy.policy],
      ["x-oss-object-acl", policy.x_oss_object_acl || "private"], ["x-oss-forbid-overwrite", policy.x_oss_forbid_overwrite || "true"],
      ["key", objectKey], ["success_action_status", "200"],
    ];
    const multipart = multipartStream(fields, filename, contentType, object.body);
    // Node/undici requires duplex for streaming bodies (ignored by worker fetch).
    const uploadInit: RequestInit & { duplex?: "half" } = {
      method: "POST",
      signal: AbortSignal.timeout(1200000),
      headers: { "content-type": `multipart/form-data; boundary=${multipart.boundary}`, "content-length": String(object.size + multipart.overhead) },
      duplex: "half",
      body: multipart.stream as BodyInit,
    };
    const uploadResponse = await fetch(uploadHost, uploadInit);
    if (!uploadResponse.ok) throw new UpstreamError(`阿里云临时视频上传失败（HTTP ${uploadResponse.status}）`, uploadResponse.status, (await uploadResponse.text()).slice(0, 500));
    return Response.json({ ok: true, file: { uri: `oss://${objectKey}`, mimeType: contentType, name: filename, size: object.size, model: modelName } });
  } catch (error) {
    return errorResponse(error);
  }
}
