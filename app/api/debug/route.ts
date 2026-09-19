import { chatCompletion, cleanApiKey, errorResponse, LlmConfig, UpstreamError } from "../_lib/llm";

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const body = await request.json() as LlmConfig & { prompt?: string };
    const { provider, endpoint, model, prompt } = body;
    const apiKey = cleanApiKey(body.apiKey || "");
    if (!endpoint || !model || !apiKey || !prompt) {
      return Response.json({ ok: false, error: "缺少必要的调试参数" }, { status: 400 });
    }
    const content = await chatCompletion(
      { provider, endpoint, model, apiKey },
      [{ role: "user", content: prompt }],
      { maxTokens: 128, temperature: 0.2, timeoutMs: 60000 },
    );
    let vision = "";
    if (body.multimodal) {
      vision = await chatCompletion({ provider, endpoint, model, apiKey }, [{ role: "user", content: [
        { type: "text", text: "请只说这张图片的主要颜色，使用中文。" },
        { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAoElEQVRoge2SQQkAQRDDKuLe9a8sOlbEPcJAIQLS0PD1NNEN2IDqFdmFepfoBmxA9YrsQr1LdAM2oHpFdqHeJboBG1C9IrtQ7xLdgA2oXpFdqHeJbsAGVK/ILtS7RDdgA6pXZBfqXaIbsAHVK7IL9S7RDdiA6hXZhXqX6AZsQPWK7EK9S3QDNqB6RXah3iW6ARtQvSK7UO8S3YANqF7xDw9vO4EA8AfzYwAAAABJRU5ErkJggg==" } },
      ] }], { maxTokens: 128, timeoutMs: 60000 });
      if (!/红|red/i.test(vision)) throw new UpstreamError("文字连接成功，但看图测试没有识别出测试图颜色；请确认所选模型支持图片", 422);
    }
    return Response.json({ ok: true, content: content + (body.multimodal ? "\n看图测试通过：已识别红色测试图。" : "\n仅文字模式测试通过。"), latency: Date.now() - started });
  } catch (error) {
    const response = errorResponse(error);
    const payload = await response.json() as Record<string, unknown>;
    return Response.json({ ...payload, latency: Date.now() - started }, { status: response.status });
  }
}
