import { secondsToTime, TranscriptSegment } from "../../_lib/analysis";
import { chatCompletion, ContentPart, errorResponse, LlmConfig, parseJsonText, UpstreamError } from "../../_lib/llm";
import { providerById } from "../../../lib/providers";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { config: LlmConfig; frames: Array<{ seconds: number; image: string }>; intervalSeconds?: number; endSeconds?: number; transcript?: TranscriptSegment[] };
    if (body.config?.multimodal !== true) throw new UpstreamError("多模态已关闭，不能发送视频画面", 400);
    if (!providerById(body.config.provider)) throw new UpstreamError("请选择支持多模态的服务商", 400);
    if (!Array.isArray(body.frames) || !body.frames.length || body.frames.length > 16) throw new UpstreamError("每批需要 1–16 张视频画面", 400);
    const interval = body.intervalSeconds ?? 5;
    if (!Number.isFinite(interval) || interval < 0.5 || interval > 60) throw new UpstreamError("识屏间隔需要在 0.5–60 秒之间", 400);
    const content: ContentPart[] = [{ type: "text", text: "按所附画面的真实时间逐项描述可见知识点、字幕、演示动作和图表。只依据可见内容和提供的字幕，不推测音轨，不声称听到声音。每条写具体事实。返回 JSON：{\"segments\":[{\"time\":\"MM:SS\",\"seconds\":0,\"text\":\"可见内容\"}]}。" }];
    for (const frame of body.frames) {
      if (!Number.isFinite(frame.seconds) || frame.seconds < 0 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(frame.image) || frame.image.length > 2_000_000) throw new UpstreamError("画面数据无效或过大", 400);
      content.push({ type: "text", text: `画面时间 ${secondsToTime(frame.seconds)}（${frame.seconds} 秒）` }, { type: "image_url", image_url: { url: frame.image } });
    }
    if (body.transcript?.length) content.push({ type: "text", text: `本时段已有字幕：${JSON.stringify(body.transcript).slice(0,24000)}` });
    const output = await chatCompletion(body.config, [{ role: "user", content }], { maxTokens: 5000, timeoutMs: 120000 });
    const parsed = parseJsonText<{ segments?: TranscriptSegment[] }>(output);
    const start = body.frames[0].seconds, end = Math.min(body.endSeconds ?? Infinity, body.frames.at(-1)!.seconds + interval);
    const segments = (parsed.segments || []).filter(s => typeof s.text === "string" && Number.isFinite(s.seconds) && s.seconds! >= start && s.seconds! <= end).map(s => ({ seconds: s.seconds!, time: secondsToTime(s.seconds!), text: `[画面] ${s.text}` }));
    if (!segments.length) throw new UpstreamError("视觉模型未返回带有效时间的内容，请重试");
    return Response.json({ ok: true, segments });
  } catch (error) { return errorResponse(error); }
}
