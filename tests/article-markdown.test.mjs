import assert from "node:assert/strict";
import test from "node:test";
// Node 24 type stripping loads the shared TS module directly.
import { anchorSlug, articleAnchors, articleFileName, buildArticleMarkdown, sectionHeading } from "../app/lib/article.ts";

test("anchorSlug handles Chinese punctuation, time marks and duplicate titles", () => {
  assert.equal(anchorSlug("1. 法案本质与白宫宣传"), "1-法案本质与白宫宣传");
  assert.equal(anchorSlug("主题 [00:12]"), "主题-0012");
  assert.equal(anchorSlug("AI 总结"), "ai-总结");
  assert.equal(anchorSlug("///"), "section");
  const anchors = articleAnchors({
    sections: [
      { id: "a", title: "重复主题", points: [] },
      { id: "b", title: "重复主题", points: [] },
      { id: "c", title: "另一主题", points: [] },
    ],
  });
  // Section numbering keeps identical titles addressable; base slugs stay unique.
  assert.equal(anchors.sections[0], "1-重复主题");
  assert.equal(anchors.sections[1], "2-重复主题");
  assert.equal(anchors.sections[2], "3-另一主题");
  assert.equal(anchors.conclusion, "ai-总结");
  // A section deliberately colliding with the conclusion anchor still resolves uniquely.
  const collision = articleAnchors({ sections: [{ id: "x", title: "AI 总结", points: [] }] });
  assert.equal(collision.sections[0], "1-ai-总结");
  assert.equal(collision.conclusion, "ai-总结");
});

test("sectionHeading only includes a timecode when startSeconds exists", () => {
  assert.equal(sectionHeading(1, { title: "主题", startSeconds: 72 }), "1. 主题 [01:12]");
  assert.equal(sectionHeading(1, { title: "主题", startSeconds: 3672 }), "1. 主题 [01:01:12]");
  assert.equal(sectionHeading(2, { title: "主题" }), "2. 主题");
});

test("buildArticleMarkdown emits TOC links that match heading anchors", () => {
  const article = {
    version: 1,
    title: "测试文章",
    sections: [
      {
        id: "s1", title: "第一个主题", startSeconds: 12,
        points: [{ label: "核心概念", text: "说明", children: [{ label: "案例", text: "视频提到的例子" }] }],
        subsections: [{ title: "小标题", points: [{ label: "子要点", text: "解释" }] }],
      },
      { id: "s2", title: "第二个主题", points: [{ text: "无标签要点" }] },
    ],
    conclusion: { paragraphs: ["总结段落"], points: [{ label: "结论一", text: "内容" }] },
  };
  const markdown = buildArticleMarkdown(article, { kind: "link", url: "https://www.bilibili.com/video/BV1xx" });
  assert.match(markdown, /^> 来源链接：\[https:\/\/www\.bilibili\.com\/video\/BV1xx\]\(https:\/\/www\.bilibili\.com\/video\/BV1xx\)$/m);
  assert.match(markdown, /^# 测试文章$/m);
  assert.match(markdown, /- \[1\. 第一个主题 \[00:12\]\]\(#1-第一个主题-0012\)/);
  assert.match(markdown, /- \[2\. 第二个主题\]\(#2-第二个主题\)/);
  assert.match(markdown, /- \[AI 总结\]\(#ai-总结\)/);
  assert.match(markdown, /^## 1\. 第一个主题 \[00:12\]$/m);
  assert.match(markdown, /^- \*\*核心概念\*\*：说明$/m);
  assert.match(markdown, /^ {2}- \*\*案例\*\*：视频提到的例子$/m);
  assert.match(markdown, /^### 小标题$/m);
  assert.match(markdown, /^- \*\*子要点\*\*：解释$/m);
  assert.match(markdown, /^## 2\. 第二个主题$/m);
  assert.match(markdown, /^- 无标签要点$/m);
  assert.match(markdown, /^## AI 总结$/m);
  assert.match(markdown, /^总结段落$/m);
  assert.match(markdown, /^\*\*关键结论：\*\*$/m);
  assert.match(markdown, /^1\. \*\*结论一\*\*：内容$/m);
  // No fabricated timecode when startSeconds is absent.
  assert.doesNotMatch(markdown, /## 2\. 第二个主题 \[/);
});

test("source line variants and Windows-safe file names", () => {
  const article = { version: 1, title: "标题", sections: [], conclusion: { paragraphs: [] } };
  assert.match(buildArticleMarkdown(article, { kind: "file", name: "我的视频.mp4" }), /^> 来源文件：我的视频\.mp4$/m);
  assert.match(buildArticleMarkdown(article, { kind: "label", text: "演示分析" }), /^> 来源：演示分析$/m);
  assert.ok(buildArticleMarkdown(article).startsWith("# 标题"));
  const unsafe = articleFileName({ title: '视频: "精华"<>|/\\ 版' });
  assert.ok(!/[\\/:*?"<>|]/.test(unsafe));
  assert.match(unsafe, /^视频.+版\.md$/);
  assert.equal(articleFileName({ title: "" }), "视频笔记.md");
  assert.equal(articleFileName({ title: "   " }), "视频笔记.md");
});
