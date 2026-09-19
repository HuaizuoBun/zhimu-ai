import { anchorSlug, ArticlePoint, ArticleSection } from "../../lib/article";
import {
  ASSEMBLY_SYSTEM,
  assemblyUserPrompt,
  DRAFT_RESTRUCTURE_SYSTEM,
  EVIDENCE_EXTRACTION_SYSTEM,
  evidenceExtractionUserPrompt,
  normalizeAnalysis,
  SECTION_WRITING_SYSTEM,
  sectionWritingUserPrompt,
  TOPIC_MERGE_SYSTEM,
  topicMergeUserPrompt,
  TranscriptSegment,
} from "../_lib/analysis";
import { chatCompletion, errorResponse, LlmConfig, parseJsonText, UpstreamError } from "../_lib/llm";

type Body = {
  config?: LlmConfig;
  transcript?: TranscriptSegment[];
  metadata?: { title?: string; duration?: string; sourceLabel?: string };
  draft?: unknown;
};

type EvidenceItem = { id: string; time?: string; seconds?: number; text: string };
type Topic = { title: string; gist?: string; evidence: EvidenceItem[] };

function compactSegments(segments: TranscriptSegment[]) {
  return segments
    .filter((item) => item && typeof item.time === "string" && typeof item.text === "string" && item.text.trim());
}

function makeChunks(segments: TranscriptSegment[]) {
  const chunks: string[] = [];
  let current = "";
  for (const item of segments) {
    const line = `[${item.time}] ${item.text.trim()}\n`;
    if (current.length + line.length > 9000 && current) {
      chunks.push(current);
      current = "";
    }
    current += line;
  }
  if (current) chunks.push(current);
  if (chunks.length <= 10) return chunks;
  const merged: string[] = Array.from({ length: 10 }, () => "");
  chunks.forEach((chunk, index) => { merged[Math.min(9, Math.floor(index / (chunks.length / 10)))] += chunk; });
  return merged.filter(Boolean);
}

async function stageJson(config: LlmConfig, system: string, user: string, maxTokens: number) {
  const content = await chatCompletion(config, [
    { role: "system", content: system },
    { role: "user", content: user },
  ], { maxTokens, timeoutMs: 90000 });
  return parseJsonText<Record<string, unknown>>(content);
}

// Stage B validation: every evidence id must exist; evidence left uncovered is kept
// in a fallback topic so no information is silently dropped.
function buildTopics(merge: Record<string, unknown>, evidence: EvidenceItem[]): Topic[] {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const covered = new Set<string>();
  const topics: Topic[] = [];
  for (const item of Array.isArray(merge.topics) ? merge.topics : []) {
    if (!item || typeof item !== "object") continue;
    const topic = item as Record<string, unknown>;
    const title = typeof topic.title === "string" ? topic.title.trim() : "";
    const gist = typeof topic.gist === "string" && topic.gist.trim() ? topic.gist.trim() : undefined;
    const ids = Array.isArray(topic.evidenceIds)
      ? topic.evidenceIds.filter((id): id is string => typeof id === "string" && byId.has(id) && !covered.has(id))
      : [];
    if (!title || !ids.length) continue;
    ids.forEach((id) => covered.add(id));
    topics.push({ title, gist, evidence: ids.map((id) => byId.get(id)!) });
  }
  const leftover = evidence.filter((item) => !covered.has(item.id));
  if (leftover.length) topics.push({ title: "其他要点", gist: "未归入前面主题、但仍有信息量的补充证据", evidence: leftover });
  if (!topics.length) throw new UpstreamError("模型没有完成主题归并，请重试");
  return topics;
}

// Program-assigned section metadata: ids, evidence refs and the earliest real evidence time.
// Times only come from evidence that actually carried a timecode; they are never fabricated.
function buildSection(topic: Topic, section: Record<string, unknown>, usedIds: Set<string>): ArticleSection {
  const title = typeof section.title === "string" && section.title.trim() ? section.title.trim() : topic.title;
  let id = anchorSlug(title);
  let suffix = 1;
  while (usedIds.has(id)) id = `${anchorSlug(title)}-${suffix++}`;
  usedIds.add(id);
  const timed = topic.evidence.filter((item) => item.seconds != null);
  const startSeconds = timed.length ? Math.min(...timed.map((item) => item.seconds as number)) : undefined;
  const normalizePoint = (value: unknown): ArticlePoint | null => {
    if (typeof value === "string") return value.trim() ? { label: "", text: value.trim() } : null;
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label.trim() : "";
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!label && !text) return null;
    const children = Array.isArray(record.children) ? record.children.map(normalizePoint).filter((point): point is ArticlePoint => point !== null) : undefined;
    return { label, text, children: children?.length ? children : undefined };
  };
  const points = (Array.isArray(section.points) ? section.points : []).map(normalizePoint).filter((point): point is ArticlePoint => point !== null);
  const subsections = (Array.isArray(section.subsections) ? section.subsections : [])
    .map((value) => {
      if (!value || typeof value !== "object") return null;
      const record = value as Record<string, unknown>;
      const subTitle = typeof record.title === "string" ? record.title.trim() : "";
      const subPoints = (Array.isArray(record.points) ? record.points : []).map(normalizePoint).filter((point): point is ArticlePoint => point !== null);
      return subTitle && subPoints.length ? { title: subTitle, points: subPoints } : null;
    })
    .filter((sub): sub is { title: string; points: ArticlePoint[] } => sub !== null);
  const gist = typeof section.gist === "string" && section.gist.trim() ? section.gist.trim() : topic.gist;
  return {
    id,
    title,
    startSeconds,
    gist,
    points,
    subsections: subsections.length ? subsections : undefined,
    evidenceRefs: topic.evidence.map((item) => item.id),
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Body;
    if (!body.config?.endpoint || !body.config.model || !body.config.apiKey) {
      throw new UpstreamError("请先在 API 设置中填写并测试摘要模型的 API Key", 400);
    }
    const metadata = body.metadata || {};

    if (body.draft) {
      const prompt = `下面是视频理解引擎从音频与画面得到的旧结构初稿。请重组成按主题组织的详细文章笔记：合并同主题内容、去除重复、保留数据与案例；evidenceRefs 引用 transcript 数组下标（如 "t0"）。不要发明初稿中没有的内容。transcript 原样保留。只返回 JSON。\n视频信息：${JSON.stringify(metadata)}\n初稿：${JSON.stringify(body.draft)}`;
      const parsed = await stageJson(body.config, DRAFT_RESTRUCTURE_SYSTEM, prompt, 7000);
      return Response.json({ ok: true, analysis: normalizeAnalysis(parsed, [], { requireArticle: true }) });
    }

    const transcript = compactSegments(body.transcript || []);
    if (!transcript.length) throw new UpstreamError("没有可分析的字幕或转写内容", 400);
    const chunks = makeChunks(transcript);

    // Stage A: extract evidence per chunk. No article writing happens here.
    const evidence: EvidenceItem[] = [];
    for (let index = 0; index < chunks.length; index += 2) {
      const batch = chunks.slice(index, index + 2);
      const results = await Promise.all(batch.map(async (chunk, offset) => {
        return stageJson(body.config!, EVIDENCE_EXTRACTION_SYSTEM, evidenceExtractionUserPrompt(index + offset + 1, chunks.length, chunk), 3000);
      }));
      for (const result of results) {
        for (const item of Array.isArray(result.evidence) ? result.evidence : []) {
          if (!item || typeof item !== "object") continue;
          const record = item as Record<string, unknown>;
          const text = typeof record.text === "string" ? record.text.trim() : "";
          if (!text) continue;
          const time = typeof record.time === "string" ? record.time.trim() : "";
          const seconds = /^\d{1,3}:\d{2}(:\d{2})?$/.test(time) ? time.split(":").map(Number).reduce((total, part) => total * 60 + part, 0) : undefined;
          evidence.push({ id: `e${evidence.length}`, time: seconds != null ? time : undefined, seconds, text });
        }
      }
    }
    if (!evidence.length) throw new UpstreamError("没有从字幕或转写中抽取到可用的证据，请重试");

    // Stage B: merge evidence into topics (same topic across time collapses into one).
    const merge = await stageJson(body.config, TOPIC_MERGE_SYSTEM, topicMergeUserPrompt(evidence.map(({ id, time, text }) => ({ id, time, text }))), 3000);
    const topics = buildTopics(merge, evidence);

    // Stage C: write one article section per topic, fed only with that topic's evidence.
    const sections: ArticleSection[] = [];
    const usedIds = new Set<string>();
    for (let index = 0; index < topics.length; index += 2) {
      const batch = topics.slice(index, index + 2);
      const results = await Promise.all(batch.map(async (topic) => {
        return stageJson(body.config!, SECTION_WRITING_SYSTEM, sectionWritingUserPrompt([topic]), 5000);
      }));
      results.forEach((result, offset) => {
        const topic = batch[offset];
        const raw = Array.isArray(result.sections) ? result.sections : [];
        const section = raw[0] && typeof raw[0] === "object" ? raw[0] as Record<string, unknown> : {};
        sections.push(buildSection(topic, section, usedIds));
      });
    }
    if (sections.length !== topics.length) {
      throw new UpstreamError(`文章章节生成不完整（${sections.length}/${topics.length}），请重试`);
    }

    // Stage D: title, one-line summary and conclusion are assembled exactly once.
    const assembly = await stageJson(body.config, ASSEMBLY_SYSTEM, assemblyUserPrompt(metadata, sections.map(({ title, gist }) => ({ title, gist }))), 3000);
    const conclusionRecord = assembly.conclusion && typeof assembly.conclusion === "object" ? assembly.conclusion as Record<string, unknown> : {};
    const paragraphs = Array.isArray(conclusionRecord.paragraphs)
      ? conclusionRecord.paragraphs.filter((paragraph): paragraph is string => typeof paragraph === "string" && Boolean(paragraph.trim())).map((paragraph) => paragraph.trim())
      : [];
    if (!paragraphs.length) throw new UpstreamError("模型没有生成文章总结，请重试");
    const conclusionPoints = (Array.isArray(conclusionRecord.points) ? conclusionRecord.points : [])
      .map((value) => {
        if (!value || typeof value !== "object") return null;
        const record = value as Record<string, unknown>;
        const label = typeof record.label === "string" ? record.label.trim() : "";
        const text = typeof record.text === "string" ? record.text.trim() : "";
        return label || text ? { label, text } : null;
      })
      .filter((point): point is ArticlePoint => point !== null);

    const articleTitle = typeof assembly.title === "string" && assembly.title.trim() ? assembly.title.trim() : metadata.title || "视频笔记";
    const parsed = {
      title: articleTitle,
      duration: metadata.duration || transcript.at(-1)?.time || "",
      sourceLabel: metadata.sourceLabel || "字幕",
      oneLineSummary: typeof assembly.oneLineSummary === "string" ? assembly.oneLineSummary.trim() : "",
      finalSummary: paragraphs.join("\n\n"),
      keywords: Array.isArray(assembly.keywords) ? assembly.keywords.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [],
      article: {
        version: 1,
        title: articleTitle,
        sections,
        conclusion: { paragraphs, points: conclusionPoints.length ? conclusionPoints : undefined },
      },
      transcript,
    };
    return Response.json({ ok: true, analysis: normalizeAnalysis(parsed, transcript, { requireArticle: true }) });
  } catch (error) {
    return errorResponse(error);
  }
}
