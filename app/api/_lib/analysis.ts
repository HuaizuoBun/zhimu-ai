import { anchorSlug, ArticlePoint, ArticleSection, StructuredArticle } from "../../lib/article";
import { UpstreamError } from "./llm";

export type TranscriptSegment = { time: string; seconds?: number; text: string };
export type Chapter = {
  time: string;
  seconds?: number;
  tag: string;
  title: string;
  intro: string;
  points: string[];
};
export type MindNode = { label: string; time?: string; children?: MindNode[] };
export type AnalysisResult = {
  title: string;
  duration: string;
  sourceLabel: string;
  oneLineSummary: string;
  finalSummary: string;
  keywords: string[];
  chapters: Chapter[];
  transcript: TranscriptSegment[];
  mindmap: MindNode;
  article?: StructuredArticle;
};

export function timeToSeconds(value: string) {
  const parts = value.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

// Returns undefined for empty/invalid timecodes so unknown times are never faked as 00:00.
export function parseTimecode(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{1,3}:\d{2}(:\d{2})?$/.test(value.trim())) return undefined;
  const seconds = timeToSeconds(value.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export function secondsToTime(value: number) {
  const safe = Math.max(0, Math.round(value));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeMindNode(value: unknown, fallback: string): MindNode {
  if (typeof value === "string" && value.trim()) return { label: value.trim() };
  if (!value || typeof value !== "object") return { label: fallback };
  const record = value as Record<string, unknown>;
  const children = Array.isArray(record.children)
    ? record.children.map((child) => normalizeMindNode(child, "知识点"))
    : undefined;
  return {
    label: stringValue(record.label, stringValue(record.name, stringValue(record.title, stringValue(record.text, fallback)))),
    time: typeof record.time === "string" && record.time.trim() ? record.time.trim() : undefined,
    children: children?.length ? children : undefined,
  };
}

function normalizePoint(value: unknown): ArticlePoint | null {
  if (typeof value === "string") return value.trim() ? { label: "", text: value.trim() } : null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const label = stringValue(record.label, "");
  const text = stringValue(record.text, "");
  if (!label && !text) return null;
  const children = Array.isArray(record.children)
    ? record.children.map(normalizePoint).filter((point): point is ArticlePoint => point !== null)
    : undefined;
  const evidenceRefs = Array.isArray(record.evidenceRefs)
    ? record.evidenceRefs.filter((ref): ref is string => typeof ref === "string" && Boolean(ref.trim())).map((ref) => ref.trim())
    : undefined;
  return {
    label,
    text,
    children: children?.length ? children : undefined,
    evidenceRefs: evidenceRefs?.length ? evidenceRefs : undefined,
  };
}

function normalizeSubsection(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const title = stringValue(record.title, "");
  const points = Array.isArray(record.points)
    ? record.points.map(normalizePoint).filter((point): point is ArticlePoint => point !== null)
    : [];
  if (!title && !points.length) return null;
  return { title, points };
}

function normalizeArticle(value: unknown, requireArticle: boolean): StructuredArticle | undefined {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawArticle = record.article && typeof record.article === "object" ? record.article as Record<string, unknown> : undefined;
  if (!rawArticle) {
    if (requireArticle) throw new UpstreamError("模型没有生成文章笔记（article），请重试");
    return undefined;
  }
  const rawSections = Array.isArray(rawArticle.sections) ? rawArticle.sections : [];
  const usedIds = new Set<string>();
  const sections: ArticleSection[] = [];
  for (const item of rawSections) {
    if (!item || typeof item !== "object") continue;
    const section = item as Record<string, unknown>;
    const title = stringValue(section.title, "");
    const points = Array.isArray(section.points)
      ? section.points.map(normalizePoint).filter((point): point is ArticlePoint => point !== null)
      : [];
    const subsections = Array.isArray(section.subsections)
      ? section.subsections.map(normalizeSubsection).filter((sub): sub is NonNullable<ReturnType<typeof normalizeSubsection>> => sub !== null)
      : [];
    if (!title && !points.length && !subsections.length) continue;
    // Subsections without titles keep their points by folding them into the section.
    const folded = subsections.filter((sub) => !sub.title);
    const titledSubsections = subsections.filter((sub) => sub.title);
    const allPoints = [...points, ...folded.flatMap((sub) => sub.points)];
    if (!title && !allPoints.length && !titledSubsections.length) continue;
    let id = stringValue(section.id, "");
    if (!id || usedIds.has(id)) {
      id = anchorSlug(title || `section-${sections.length + 1}`);
      let suffix = 1;
      while (usedIds.has(id)) id = `${anchorSlug(title || "section")}-${suffix++}`;
    }
    usedIds.add(id);
    const startSeconds = typeof section.startSeconds === "number" && Number.isFinite(section.startSeconds) && section.startSeconds >= 0
      ? section.startSeconds
      : undefined;
    const evidenceRefs = Array.isArray(section.evidenceRefs)
      ? section.evidenceRefs.filter((ref): ref is string => typeof ref === "string" && Boolean(ref.trim())).map((ref) => ref.trim())
      : undefined;
    sections.push({
      id,
      title,
      startSeconds,
      gist: stringValue(section.gist, "") || undefined,
      points: allPoints,
      subsections: titledSubsections.length ? titledSubsections.map((sub) => ({ title: sub.title, points: sub.points })) : undefined,
      evidenceRefs: evidenceRefs?.length ? evidenceRefs : undefined,
    });
  }
  const rawConclusion = rawArticle.conclusion && typeof rawArticle.conclusion === "object" ? rawArticle.conclusion as Record<string, unknown> : {};
  const paragraphs = Array.isArray(rawConclusion.paragraphs)
    ? rawConclusion.paragraphs.filter((paragraph): paragraph is string => typeof paragraph === "string" && Boolean(paragraph.trim())).map((paragraph) => paragraph.trim())
    : [];
  const conclusionPoints = Array.isArray(rawConclusion.points)
    ? rawConclusion.points.map(normalizePoint).filter((point): point is ArticlePoint => point !== null)
    : undefined;
  if (requireArticle && (!sections.length || !paragraphs.length)) {
    throw new UpstreamError("模型生成的文章笔记不完整（缺少章节或总结），请重试");
  }
  if (!sections.length) return undefined;
  return {
    version: 1,
    title: stringValue(rawArticle.title, ""),
    sections,
    conclusion: { paragraphs, points: conclusionPoints?.length ? conclusionPoints : undefined },
  };
}

export function normalizeAnalysis(value: unknown, transcriptFallback: TranscriptSegment[] = [], options: { requireArticle?: boolean } = {}): AnalysisResult {
  if (!value || typeof value !== "object") throw new UpstreamError("模型返回的分析结构无效");
  const record = value as Record<string, unknown>;
  const article = normalizeArticle(record, Boolean(options.requireArticle));

  const rawChapters = Array.isArray(record.chapters) ? record.chapters : [];
  let chapters: Chapter[] = rawChapters.map((item) => {
    const chapter = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const time = typeof chapter.time === "string" ? chapter.time.trim() : "";
    const validTime = parseTimecode(time) !== undefined ? time : "";
    return {
      time: validTime,
      seconds: Number.isFinite(chapter.seconds) && (chapter.seconds as number) >= 0
        ? chapter.seconds as number
        : validTime ? timeToSeconds(validTime) : undefined,
      tag: stringValue(chapter.tag, ""),
      title: stringValue(chapter.title, ""),
      intro: stringValue(chapter.intro, ""),
      points: Array.isArray(chapter.points)
        ? chapter.points.filter((point): point is string => typeof point === "string" && Boolean(point.trim()))
        : [],
    };
  }).filter((chapter) => chapter.title || chapter.points.length);

  if (!chapters.length && article) {
    // Derive the timeline from the article so both views tell the same story.
    chapters = article.sections.map((section) => ({
      time: section.startSeconds != null ? secondsToTime(section.startSeconds) : "",
      seconds: section.startSeconds,
      tag: "",
      title: section.title,
      intro: section.gist || "",
      points: section.points.map((point) => (point.label ? `${point.label}：${point.text}` : point.text)),
    })).filter((chapter) => chapter.title);
  }
  if (!chapters.length) throw new UpstreamError("模型没有生成可用的章节内容，请重试");

  const rawTranscript = Array.isArray(record.transcript) ? record.transcript : transcriptFallback;
  const transcript = rawTranscript.map((item) => {
    const segment = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const time = typeof segment.time === "string" ? segment.time.trim() : "";
    const validTime = parseTimecode(time) !== undefined ? time : "";
    return {
      time: validTime,
      seconds: Number.isFinite(segment.seconds) && (segment.seconds as number) >= 0
        ? segment.seconds as number
        : validTime ? timeToSeconds(validTime) : undefined,
      text: stringValue(segment.text, ""),
    };
  }).filter((item) => item.text);

  const keywords = Array.isArray(record.keywords)
    ? record.keywords.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 12)
    : [];
  const mindmap = normalizeMindNode(record.mindmap, stringValue(record.title, "视频知识图谱"));
  if (!mindmap.children?.length || mindmap.children.some(node => node.label === "知识点")) {
    mindmap.children = chapters.map(chapter => ({ label: chapter.title, time: chapter.time || undefined, children: chapter.points.map(label => ({ label, time: chapter.time || undefined })) }));
  }
  if (article && !article.title) article.title = stringValue(record.title, chapters[0].title);
  return {
    title: stringValue(record.title, article?.title || chapters[0].title),
    duration: stringValue(record.duration, ""),
    sourceLabel: stringValue(record.sourceLabel, "视频"),
    oneLineSummary: stringValue(record.oneLineSummary, ""),
    // finalSummary always matches the article conclusion when an article exists.
    finalSummary: article ? article.conclusion.paragraphs.join("\n\n") : stringValue(record.finalSummary, ""),
    keywords,
    chapters,
    transcript,
    mindmap,
    article,
  };
}

const POINT_SCHEMA = `{"label":"具体标签","text":"详细解释","children":[嵌套同结构],"evidenceRefs":["t0"]}`;

export const ARTICLE_RULES = `文章笔记写作规则：
1. 按主题组织：同一主题在视频不同时间出现的内容合并进同一章节，去除重复表述；不要按时间顺序逐段复述。
2. 详细保真：保留有区分度的数据、单位、前提条件、因果关系、对比、专有名词和实际案例；去掉寒暄、复读和无信息量的过渡语；不要把详细内容压成几句简介。
3. 要点写成 {"label":"具体标签","text":"详细解释"}；label 必须具体有内容（如"招聘看重实习与产出"），禁止"核心内容、重点分析、这一段"等空泛标题；需要分层解释、数据、案例时用 children 嵌套。
4. 归因准确：视频里的主观判断、广告自述写成"讲者认为/视频主张/视频举例"，不写成已核实的事实。
5. 时间：只有证据中真实存在的时间才允许出现在输出中；严禁编造或推算时间，没有时间证据就不写时间。
6. 章节数量服从内容信息量，不固定章数，不强制每章要点数相同；视频没有的内容不得编造。`;

export const VIDEO_ANALYSIS_PROMPT = `你是严谨的视频知识分析师。完整检查视频的语音、字幕、画面文字、图表与演示动作，产出一份按主题组织的详细文章笔记。不要补充视频没有表达的事实。

${ARTICLE_RULES}

输出要求：
1. article 是核心产物：sections 按主题组织（含要点分层与必要案例），conclusion 用 1-3 段连贯文字概括全片主旨与推理关系（不逐章复拆），points 列出真正独立的关键结论。
2. transcript 给出按时间排列的忠实摘录；长视频可合并连续句，但不能失去关键论证、定义、数字和结论。article 要点的 evidenceRefs 只能引用 transcript 数组下标（如 "t3"），不得编造引用。
3. chapters 不需要输出，程序会从 article 生成时间轴。
4. finalSummary 与 article.conclusion 的段落保持一致。
5. mindmap 生成 3-8 个一级主题，每个主题包含关键子节点，并在可定位时带 time。
6. 全部使用简体中文。只输出 JSON，结构如下（数组可扩展）：
{"title":"标题","duration":"MM:SS","sourceLabel":"视频","oneLineSummary":"一句话总结","finalSummary":"总结","keywords":["关键词"],"article":{"version":1,"title":"依据视频内容拟定的文章标题","sections":[{"title":"主题标题","startSeconds":0,"gist":"一句话概要","points":[${POINT_SCHEMA}],"subsections":[{"title":"小标题","points":[${POINT_SCHEMA}]}]}],"conclusion":{"paragraphs":["总结段落"],"points":[${POINT_SCHEMA}]}},"transcript":[{"time":"00:00","seconds":0,"text":"忠实摘录"}],"mindmap":{"label":"主题","children":[{"label":"分支","time":"00:00","children":[{"label":"要点"}]}]}}`;

export const EVIDENCE_EXTRACTION_SYSTEM = "你是视频证据抽取器。逐条保留有信息量的内容及其真实时间，不合并不同论点，不扩写，不编造时间。只返回 JSON。";

export function evidenceExtractionUserPrompt(index: number, total: number, chunk: string) {
  return `这是第 ${index}/${total} 段内容。提取全部有信息量的证据条目：保留具体数据、单位、前提条件、因果、案例和结论；原样保留时间，没有时间就不要输出 time 字段。\n只返回 JSON：{"evidence":[{"time":"MM:SS","text":"忠实内容"}]}\n\n${chunk}`;
}

export const TOPIC_MERGE_SYSTEM = "你是知识主题编辑器。把证据按主题归并，同一主题跨时间的内容必须合并。只输出严格 JSON。";

export function topicMergeUserPrompt(evidence: Array<{ id: string; time?: string; text: string }>) {
  return `把下面的证据归并为若干主题：\n- 同一主题的证据（即使时间相隔很远）归入同一主题；完全重复的条目只保留一次。\n- 主题数量服从内容（通常 3-10 个）；每个主题标题必须具体、有内容。\n- evidenceIds 必须使用给定 id，不得编造；每条证据至少归入一个主题。\n- 主题顺序按逻辑关系或首次出现时间。\n只返回 JSON：{"topics":[{"title":"主题标题","gist":"一句话概要","evidenceIds":["e0"]}]}\n\n证据：${JSON.stringify(evidence)}`;
}

export const SECTION_WRITING_SYSTEM = `${ARTICLE_RULES}\n只输出严格 JSON。`;

export function sectionWritingUserPrompt(topics: Array<{ title: string; gist?: string; evidence: Array<{ id: string; time?: string; text: string }> }>) {
  const body = topics.map((topic, index) => `主题 ${index + 1}：${topic.title}${topic.gist ? `（${topic.gist}）` : ""}\n证据：${JSON.stringify(topic.evidence)}`).join("\n\n");
  return `为下面的每个主题撰写一个文章章节。只依据各主题给定的证据，不得引入证据之外的信息；不要在每章重复全片背景。\n返回 JSON：{"sections":[{"title":"主题标题","gist":"一句话概要","points":[${POINT_SCHEMA}],"subsections":[{"title":"小标题","points":[${POINT_SCHEMA}]}]}]}\nsections 数量必须等于主题数量、顺序一致。\n\n${body}`;
}

export const ASSEMBLY_SYSTEM = "你是总编辑。只输出严格 JSON。";

export function assemblyUserPrompt(metadata: Record<string, unknown>, sections: Array<{ title: string; gist?: string }>) {
  return `基于章节概要生成整篇笔记的总括。标题依据视频内容拟定，具体、有信息量；conclusion 用 1-3 段连贯文字概括全片主旨与推理关系，不逐章复述；points 列出真正独立的关键结论。\n只返回 JSON：{"title":"文章标题","oneLineSummary":"一句话总结","finalSummary":"与 conclusion 段落一致的总结","keywords":["关键词"],"conclusion":{"paragraphs":["段落"],"points":[${POINT_SCHEMA}]}}\n\n视频信息：${JSON.stringify(metadata)}\n章节：${JSON.stringify(sections.map((section) => ({ title: section.title, gist: section.gist || "" })))}`;
}

export const DRAFT_RESTRUCTURE_SYSTEM = `你是视频知识编辑器。把视频理解引擎的初稿重组成按主题组织的详细文章笔记。${ARTICLE_RULES}\n只输出严格 JSON，字段必须保持为 title,duration,sourceLabel,oneLineSummary,finalSummary,keywords,article,transcript,mindmap。`;

const POINT_JSON_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string" },
    text: { type: "string" },
    children: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          text: { type: "string" },
          children: {
            type: "array",
            items: {
              type: "object",
              properties: { label: { type: "string" }, text: { type: "string" } },
              required: ["text"],
            },
          },
          evidenceRefs: { type: "array", items: { type: "string" } },
        },
        required: ["text"],
      },
    },
    evidenceRefs: { type: "array", items: { type: "string" } },
  },
  required: ["text"],
};

const SUBSECTION_JSON_SCHEMA = {
  type: "object",
  properties: { title: { type: "string" }, points: { type: "array", items: POINT_JSON_SCHEMA } },
  required: ["title"],
};

export const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    duration: { type: "string" },
    sourceLabel: { type: "string" },
    oneLineSummary: { type: "string" },
    finalSummary: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    article: {
      type: "object",
      properties: {
        version: { type: "number" },
        title: { type: "string" },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              startSeconds: { type: "number" },
              gist: { type: "string" },
              points: { type: "array", items: POINT_JSON_SCHEMA },
              subsections: { type: "array", items: SUBSECTION_JSON_SCHEMA },
            },
            required: ["title", "points"],
          },
        },
        conclusion: {
          type: "object",
          properties: { paragraphs: { type: "array", items: { type: "string" } }, points: { type: "array", items: POINT_JSON_SCHEMA } },
          required: ["paragraphs"],
        },
      },
      required: ["title", "sections", "conclusion"],
    },
    chapters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          time: { type: "string" },
          seconds: { type: "number" },
          tag: { type: "string" },
          title: { type: "string" },
          intro: { type: "string" },
          points: { type: "array", items: { type: "string" } },
        },
        required: ["title", "points"],
      },
    },
    transcript: {
      type: "array",
      items: {
        type: "object",
        properties: { time: { type: "string" }, text: { type: "string" } },
        required: ["time", "text"],
      },
    },
    mindmap: {
      type: "object",
      properties: {
        label: { type: "string" },
        children: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              time: { type: "string" },
              children: {
                type: "array",
                items: { type: "object", properties: { label: { type: "string" }, time: { type: "string" } }, required: ["label"] },
              },
            },
            required: ["label"],
          },
        },
      },
      required: ["label", "children"],
    },
  },
  required: ["title", "duration", "sourceLabel", "oneLineSummary", "finalSummary", "keywords", "article", "transcript", "mindmap"],
};
