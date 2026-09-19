export type LlmConfig = {
  provider?: string;
  endpoint: string;
  model: string;
  apiKey: string;
  multimodal?: boolean;
};

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } } | { type: "video_url"; video_url: { url: string; fps?: number } };

export async function completionText(response: Response) {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = await response.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
    if (data.choices?.[0]?.finish_reason === "length") throw new UpstreamError("模型输出被截断，请缩短视频片段后重试");
    return data.choices?.[0]?.message?.content || "";
  }
  if (!response.body) throw new UpstreamError("模型未返回内容流");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "", content = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = done ? "" : lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        const data = JSON.parse(raw);
        if (data.error) throw new UpstreamError(data.error.message || "模型流返回错误");
        if (data.choices?.[0]?.finish_reason === "length") throw new UpstreamError("模型输出被截断，请缩短视频片段后重试");
        content += data.choices?.[0]?.delta?.content || "";
      }
      if (done) break;
    }
  } finally { reader.releaseLock(); }
  return content;
}

const PRIVATE_HOST = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;

export class UpstreamError extends Error {
  status: number;
  details?: string;

  constructor(message: string, status = 502, details?: string) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.details = details;
  }
}

export function cleanApiKey(value: string) {
  return value.trim().replace(/^Bearer\s+/i, "");
}

export function validateEndpoint(value: string) {
  const target = new URL(value.trim());
  if (target.protocol !== "https:" || target.username || target.password || target.hostname.startsWith("[") || PRIVATE_HOST.test(target.hostname)) {
    throw new UpstreamError("接口地址必须是公开的 HTTPS 地址", 400);
  }
  return target;
}

function upstreamMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const record = data as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  const message = record.message;
  return typeof message === "string" ? message : fallback;
}

export function explainAuthFailure(provider: string | undefined, status: number, rawMessage: string) {
  if (status !== 401 && status !== 403 && !/authentication|api.?key|unauthori[sz]ed|invalid key/i.test(rawMessage)) {
    return rawMessage;
  }
  if (provider === "deepseek") {
    return "DeepSeek 拒绝了这个密钥。请在 platform.deepseek.com/api_keys 新建开放平台 API Key；不要使用 DeepSeek 网页版登录信息、第三方中转站密钥或已删除的 Key。复制后请确认前后没有空格。";
  }
  if (provider === "gemini") {
    return "Gemini 拒绝了这个密钥。请在 Google AI Studio 创建 Gemini API Key，并确认该项目已启用 Gemini API。";
  }
  if (provider === "qwen") {
    return "阿里云百炼拒绝了这个密钥。请确认 Key 来自当前调用地域的百炼控制台，并且已开通所选模型。";
  }
  return `服务商拒绝了 API Key：${rawMessage}`;
}

export async function chatCompletion(
  config: LlmConfig,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string | ContentPart[] }>,
  options: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {},
) {
  const target = validateEndpoint(config.endpoint);
  const apiKey = cleanApiKey(config.apiKey);
  if (!apiKey) throw new UpstreamError("API Key 不能为空", 400);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60000);
  const glmThinking = config.provider === "glm" && /^glm-5\.3/i.test(config.model);
  let response: Response;
  try {
    response = await fetch(target, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages,
        temperature: glmThinking ? 1 : options.temperature ?? 0.15,
        ...(config.provider === "gpt" ? { max_completion_tokens: options.maxTokens ?? 4096, reasoning_effort: "none" } : { max_tokens: glmThinking ? Math.max(8192, (options.maxTokens ?? 4096) + 4096) : options.maxTokens ?? 4096 }),
        ...(glmThinking ? { thinking: { type: "enabled", clear_thinking: false }, reasoning_effort: "low", top_p: 0.95, stream: true } : ["deepseek", "kimi", "glm", "doubao"].includes(config.provider || "") ? { thinking: { type: "disabled" } } : {}),
        ...(config.provider === "qwen" ? { enable_thinking: false, ...(config.model.includes("omni") ? { stream: true, modalities: ["text"] } : {}) } : {}),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === "AbortError") {
      throw new UpstreamError("模型请求超时，请稍后重试", 504);
    }
    throw new UpstreamError(error instanceof Error ? error.message : "模型请求失败");
  }
  try {
    if (!response.ok) {
      const raw = await response.text();
      let data: unknown = {};
      try { data = JSON.parse(raw); } catch { /* Upstream HTML must not reach the client. */ }
      const rawMessage = upstreamMessage(data, `上游接口返回 HTTP ${response.status}`).replaceAll(apiKey, "[密钥已隐藏]");
      throw new UpstreamError(explainAuthFailure(config.provider, response.status, rawMessage), response.status);
    }
    const content = await completionText(response);
    if (!content) throw new UpstreamError("模型返回成功，但响应中没有可用文本");
    return content;
  } finally { clearTimeout(timer); }
}

export function parseJsonText<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new UpstreamError("模型没有返回可解析的结构化结果，请重试或更换模型");
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof Error && /AbortError|TimeoutError/.test(error.name)) return Response.json({ ok: false, error: "请求超时，请稍后重试或缩短视频" }, { status: 504 });
  if (error instanceof UpstreamError) {
    return Response.json({ ok: false, error: error.message.replace(/sk-[a-zA-Z0-9_-]+/g, "[密钥已隐藏]") }, { status: error.status >= 400 && error.status < 600 ? error.status : 502 });
  }
  return Response.json({ ok: false, error: error instanceof Error ? error.message.replace(/sk-[a-zA-Z0-9_-]+/g, "[密钥已隐藏]") : "请求失败" }, { status: 500 });
}
