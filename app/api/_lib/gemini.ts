import { cleanApiKey, explainAuthFailure, UpstreamError } from "./llm";

export function geminiKey(value: string) {
  const key = cleanApiKey(value);
  if (!key) throw new UpstreamError("请填写 Gemini 视频理解 API Key", 400);
  return key;
}

export async function geminiJson(response: Response) {
  const raw = await response.text();
  let data: unknown = {};
  try { data = JSON.parse(raw); } catch { data = { raw: raw.slice(0, 1000) }; }
  if (!response.ok) {
    const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const error = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
    const rawMessage = typeof error.message === "string" ? error.message : `Gemini 返回 HTTP ${response.status}`;
    throw new UpstreamError(explainAuthFailure("gemini", response.status, rawMessage), response.status, rawMessage);
  }
  return data as Record<string, unknown>;
}

export function interactionText(data: Record<string, unknown>) {
  if (typeof data.output_text === "string") return data.output_text;
  const steps = Array.isArray(data.steps) ? data.steps : [];
  const texts: string[] = [];
  for (const stepValue of steps) {
    if (!stepValue || typeof stepValue !== "object") continue;
    const step = stepValue as Record<string, unknown>;
    if (step.type !== "model_output" || !Array.isArray(step.content)) continue;
    for (const partValue of step.content) {
      if (!partValue || typeof partValue !== "object") continue;
      const part = partValue as Record<string, unknown>;
      if (part.type === "text" && typeof part.text === "string") texts.push(part.text);
    }
  }
  if (!texts.length) throw new UpstreamError("Gemini 已完成处理，但没有返回分析文本");
  return texts.join("\n");
}
