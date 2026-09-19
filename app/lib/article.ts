// Structured article notes: shared types, anchors and Markdown rendering.
// Used by both the result page (preview) and the .md export so the two never diverge.
// Keep this module pure (no server or browser-only APIs) so backend routes can import it too.

export type ArticlePoint = {
  label: string;
  text: string;
  children?: ArticlePoint[];
  evidenceRefs?: string[];
};

export type ArticleSubsection = { title: string; points: ArticlePoint[] };

export type ArticleSection = {
  id: string;
  title: string;
  startSeconds?: number;
  gist?: string;
  points: ArticlePoint[];
  subsections?: ArticleSubsection[];
  evidenceRefs?: string[];
};

export type StructuredArticle = {
  version: 1;
  title: string;
  sections: ArticleSection[];
  conclusion: { paragraphs: string[]; points?: ArticlePoint[] };
};

export type ArticleSource =
  | { kind: "link"; url: string; label?: string }
  | { kind: "file"; name: string }
  | { kind: "label"; text: string };

export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

// GitHub-style anchor: lowercase ASCII, drop punctuation (keep letters/numbers incl. CJK), spaces to hyphens.
export function anchorSlug(text: string): string {
  const slug = text
    .trim()
    .replace(/[A-Z]/g, (char) => char.toLowerCase())
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "section";
}

export function sectionHeading(index: number, section: Pick<ArticleSection, "title" | "startSeconds">): string {
  const time = section.startSeconds != null && Number.isFinite(section.startSeconds) ? ` [${formatTimecode(section.startSeconds)}]` : "";
  return `${index}. ${section.title}${time}`;
}

export const CONCLUSION_HEADING = "AI 总结";

// Anchor for every heading, with duplicate titles getting -1, -2 ... suffixes (GitHub behaviour).
export function articleAnchors(article: Pick<StructuredArticle, "sections">): { sections: string[]; conclusion: string } {
  const seen = new Map<string, number>();
  const unique = (text: string) => {
    const base = anchorSlug(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
  return {
    sections: article.sections.map((section, index) => unique(sectionHeading(index + 1, section))),
    conclusion: unique(CONCLUSION_HEADING),
  };
}

export function sourceLine(source?: ArticleSource): string {
  if (!source) return "";
  if (source.kind === "link") {
    const url = source.url.trim();
    if (!/^https?:\/\//i.test(url)) return "";
    const label = source.label?.trim() || url;
    return `> 来源链接：[${label}](${url})`;
  }
  if (source.kind === "file") {
    const name = source.name.trim().replace(/[\r\n]+/g, " ");
    return name ? `> 来源文件：${name}` : "";
  }
  const text = source.text.trim();
  return text ? `> 来源：${text}` : "";
}

function pointLine(point: ArticlePoint, indent: string): string[] {
  const label = typeof point.label === "string" ? point.label.trim() : "";
  const text = typeof point.text === "string" ? point.text.trim() : "";
  if (!label && !text) return [];
  const lines = [label ? `${indent}- **${label}**：${text}` : `${indent}- ${text}`];
  for (const child of point.children || []) {
    lines.push(...pointLine(child, `${indent}  `));
  }
  return lines;
}

// The single content-generation function for the exported .md document.
// The on-screen article view derives headings, numbering and anchors from the same helpers.
export function buildArticleMarkdown(article: StructuredArticle, source?: ArticleSource): string {
  const anchors = articleAnchors(article);
  const lines: string[] = [];

  const sourceText = sourceLine(source);
  if (sourceText) lines.push(sourceText, "");

  lines.push(`# ${article.title.trim() || "视频笔记"}`, "", "## 目录", "");
  article.sections.forEach((section, index) => {
    lines.push(`- [${sectionHeading(index + 1, section)}](#${anchors.sections[index]})`);
  });
  lines.push(`- [${CONCLUSION_HEADING}](#${anchors.conclusion})`, "", "---", "");

  article.sections.forEach((section, index) => {
    lines.push(`## ${sectionHeading(index + 1, section)}`, "");
    for (const point of section.points) {
      if (point.text.trim() || point.label.trim()) lines.push(...pointLine(point, ""));
    }
    for (const subsection of section.subsections || []) {
      if (!subsection.title.trim() && !subsection.points.length) continue;
      lines.push("", `### ${subsection.title.trim()}`, "");
      for (const point of subsection.points) {
        if (point.text.trim() || point.label.trim()) lines.push(...pointLine(point, ""));
      }
    }
    lines.push("");
  });

  lines.push("---", "", `## ${CONCLUSION_HEADING}`, "");
  for (const paragraph of article.conclusion.paragraphs) {
    if (paragraph.trim()) lines.push(paragraph.trim(), "");
  }
  const conclusions = (article.conclusion.points || []).filter((point) => point.text.trim() || point.label.trim());
  if (conclusions.length) {
    lines.push("**关键结论：**", "");
    conclusions.forEach((point, index) => {
      lines.push(point.label.trim() ? `${index + 1}. **${point.label.trim()}**：${point.text.trim()}` : `${index + 1}. ${point.text.trim()}`);
    });
    lines.push("");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// Windows-safe download file name derived from the article title.
export function articleFileName(article: Pick<StructuredArticle, "title">): string {
  const cleaned = (article.title || "视频笔记")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\p{Cc}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return `${cleaned || "视频笔记"}.md`;
}
