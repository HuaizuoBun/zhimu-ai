import { AnalysisResult } from "../_lib/analysis";
import { chatCompletion, errorResponse, LlmConfig, UpstreamError } from "../_lib/llm";

type Body = { config?: LlmConfig; question?: string; analysis?: AnalysisResult };

export async function POST(request: Request) {
  try {
    const body = await request.json() as Body;
    if (!body.config?.apiKey || !body.config.endpoint || !body.config.model) throw new UpstreamError("请先配置可用的问答模型 API", 400);
    if (!body.question?.trim() || !body.analysis) throw new UpstreamError("问题或视频知识上下文为空", 400);
    const context = {
      title: body.analysis.title,
      summary: body.analysis.finalSummary,
      articlePoints: body.analysis.article
        ? body.analysis.article.sections
            .flatMap((section) => [
              ...section.points.map((point) => (point.label ? `${point.label}：${point.text}` : point.text)),
              ...(section.subsections || []).flatMap((sub) => sub.points.map((point) => (point.label ? `${point.label}：${point.text}` : point.text))),
            ])
            .slice(0, 120)
        : undefined,
      conclusion: body.analysis.article?.conclusion,
      chapters: body.analysis.chapters,
      transcript: body.analysis.transcript.slice(0, 1200),
    };
    const answer = await chatCompletion(body.config, [
      { role: "system", content: "只依据给定视频知识回答。结论后必须用 [MM:SS] 标注依据时间；证据不足时明确说视频没有说明。使用简体中文，简洁但完整。" },
      { role: "user", content: `视频知识：${JSON.stringify(context)}\n\n问题：${body.question.trim()}` },
    ], { maxTokens: 1500, timeoutMs: 60000 });
    return Response.json({ ok: true, answer });
  } catch (error) {
    return errorResponse(error);
  }
}
