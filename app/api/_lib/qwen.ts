import { cleanApiKey, explainAuthFailure, UpstreamError } from "./llm";

export function qwenKey(value: string) {
  const key = cleanApiKey(value);
  if (!key) throw new UpstreamError("请填写阿里云百炼视频理解 API Key", 400);
  return key;
}

export async function qwenJson(response: Response, label = "阿里云百炼") {
  const raw = await response.text();
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new UpstreamError(`${label}返回了非 JSON 数据，请检查地域 Endpoint 或稍后重试`, 502, raw.slice(0, 500)); }
  if (!response.ok) {
    const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
    const message = typeof nested.message === "string" ? nested.message : typeof record.message === "string" ? record.message : `${label}返回 HTTP ${response.status}`;
    throw new UpstreamError(explainAuthFailure("qwen", response.status, message), response.status, message);
  }
  return data as Record<string, unknown>;
}

export function qwenOutputText(data: Record<string, unknown>) {
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : {};
  const message = first.message && typeof first.message === "object" ? first.message as Record<string, unknown> : {};
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    const texts = message.content.map((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string" ? (item as Record<string, unknown>).text as string : "").filter(Boolean);
    if (texts.length) return texts.join("\n");
  }
  throw new UpstreamError("阿里云百炼已响应，但没有返回可用的分析文本");
}
