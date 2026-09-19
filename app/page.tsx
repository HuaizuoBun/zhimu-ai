"use client";

import { useMemo, useRef, useState } from "react";
import { ArticlePoint, ArticleSource, articleAnchors, articleFileName, buildArticleMarkdown, formatTimecode, sectionHeading, StructuredArticle } from "./lib/article";
import { providers } from "./lib/providers";
import { videoFrameBatches } from "./lib/video-frames";

type View = "home" | "analysis" | "api";
type AnalysisTab = "article" | "timeline" | "mindmap" | "transcript";
type TranscriptSegment = { time: string; seconds?: number; text: string };
type Chapter = { time: string; seconds?: number; tag: string; title: string; intro: string; points: string[] };
type MindNode = { label: string; time?: string; children?: MindNode[] };
type AnalysisResult = {
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

const sources = [
  { id: "bilibili", label: "Bilibili", mark: "哔", tone: "blue" },
  { id: "upload", label: "本地视频", mark: "↑", tone: "violet" },
];

const demoChapters: Chapter[] = [
  {
    time: "00:00", seconds: 0, tag: "背景", title: "为什么需要 AI Agent",
    intro: "从传统自动化的边界切入，解释 Agent 出现的根本原因。",
    points: ["传统自动化依赖预设流程，难以处理开放式目标", "大模型提供了自然语言理解与通用推理能力", "Agent 的核心价值是把“理解”推进到“自主行动”"],
  },
  {
    time: "04:18", seconds: 258, tag: "核心框架", title: "Agent 的四层运行架构",
    intro: "一套可复用的认知循环：感知、规划、行动、反思。",
    points: ["感知层负责接收文本、图像和环境状态", "规划层把目标拆解为可执行的步骤与依赖", "行动层调用工具，反思层检查结果并决定是否重试"],
  },
  {
    time: "10:42", seconds: 642, tag: "推理", title: "任务规划与动态决策",
    intro: "复杂任务不是一次回答，而是持续校正的决策过程。",
    points: ["先定义成功标准，再规划执行路径", "长任务需要阶段性检查点以控制错误扩散", "面对新证据时应允许重排计划，而非机械执行"],
  },
  {
    time: "18:30", seconds: 1110, tag: "工具", title: "工具调用与外部世界",
    intro: "Agent 通过工具获得数据、执行动作并产生可验证结果。",
    points: ["工具描述必须清晰限定输入、输出和副作用", "高风险动作需要权限边界与人工确认", "每次调用都应保存结果，供后续推理引用"],
  },
  {
    time: "28:15", seconds: 1695, tag: "记忆", title: "短期记忆、长期记忆与反馈",
    intro: "不同记忆层服务于当前上下文、经验复用和个性化。",
    points: ["上下文窗口承担短期工作记忆", "向量检索适合按语义召回历史知识", "反馈必须转化为可执行规则，才会真正改善下一次表现"],
  },
  {
    time: "36:48", seconds: 2208, tag: "落地", title: "从 Demo 到可靠系统",
    intro: "可靠性来自约束、观测和评估，而不是更长的提示词。",
    points: ["优先构建窄场景闭环，再逐步扩大自主范围", "记录每一步输入输出，才能定位失败原因", "用任务成功率、成本和人工接管率共同评估系统"],
  },
];

const demoTranscript: TranscriptSegment[] = [
  { time: "00:00", seconds: 0, text: "我们今天讨论的重点，不是让模型回答得更像人，而是让它能围绕目标持续采取行动。传统自动化的每条路径都要提前写好，一旦环境变化，流程就会中断。" },
  { time: "04:18", seconds: 258, text: "一个完整的 Agent 循环可以拆为四层：先感知环境，再规划步骤，然后调用工具行动，最后检查结果并反思。四层缺一不可。" },
  { time: "10:42", seconds: 642, text: "规划不是先列一张永远不变的清单。真正有效的规划会在获得新证据后重新排序，并在每个检查点判断离目标还有多远。" },
  { time: "18:30", seconds: 1110, text: "大模型本身不能访问实时世界，工具是它与外部环境之间的桥。工具越清楚，系统越可靠；权限越模糊，风险越大。" },
  { time: "28:15", seconds: 1695, text: "记忆不是把所有对话都塞进上下文。短期状态、长期知识和用户偏好应该分层存储，并按当前任务有选择地召回。" },
  { time: "36:48", seconds: 2208, text: "从演示到生产系统，最大的差距通常不是模型能力，而是可观测性、评估体系和失败后的恢复机制。" },
];

// 演示用文章笔记：结构与新分析生成的 article 完全一致，仅数据为示例。
const demoArticle: StructuredArticle = {
  version: 1,
  title: "AI Agent 的核心原理与工程实践",
  sections: [
    {
      id: "why-ai-agent", title: "为什么需要 AI Agent", startSeconds: 0,
      gist: "从传统自动化的边界切入，解释 Agent 出现的根本原因。",
      points: [
        { label: "传统自动化的边界", text: "依赖预设流程，一旦环境变化流程就会中断，难以处理开放式目标。" },
        { label: "大模型带来通用推理", text: "提供了自然语言理解与通用推理能力，让系统第一次可以“听懂任务”。", children: [
          { label: "关键跃迁", text: "Agent 的核心价值是把“理解”推进到“自主行动”。" },
        ] },
      ],
    },
    {
      id: "four-layer-architecture", title: "Agent 的四层运行架构", startSeconds: 258,
      gist: "一套可复用的认知循环：感知、规划、行动、反思。",
      points: [
        { label: "感知层", text: "负责接收文本、图像和环境状态。" },
        { label: "规划层", text: "把目标拆解为可执行的步骤与依赖，先定义成功标准，再规划执行路径。" },
        { label: "行动层与反思层", text: "行动层调用工具，反思层检查结果并决定是否重试；四层缺一不可。" },
      ],
    },
    {
      id: "planning-and-decisions", title: "任务规划与动态决策", startSeconds: 642,
      gist: "复杂任务不是一次回答，而是持续校正的决策过程。",
      points: [
        { label: "检查点控制错误扩散", text: "长任务需要阶段性检查点，避免早期偏差被放大。" },
        { label: "允许重排计划", text: "面对新证据时应允许重排计划，而非机械执行初始清单。", children: [
          { label: "案例", text: "演示任务在获得新检索结果后丢弃了两步旧计划，直接进入汇总。" },
        ] },
      ],
    },
    {
      id: "tool-calling", title: "工具调用与外部世界", startSeconds: 1110,
      gist: "Agent 通过工具获得数据、执行动作并产生可验证结果。",
      points: [
        { label: "工具描述要可验证", text: "必须清晰限定输入、输出和副作用。" },
        { label: "高风险动作需人工确认", text: "权限边界与人工确认是不可逆操作的安全网。" },
        { label: "调用留痕", text: "每次调用都应保存结果，供后续推理引用。" },
      ],
    },
    {
      id: "memory-and-feedback", title: "短期记忆、长期记忆与反馈", startSeconds: 1695,
      gist: "不同记忆层服务于当前上下文、经验复用和个性化。",
      points: [
        { label: "分层存储", text: "上下文窗口承担短期工作记忆，向量检索适合按语义召回历史知识。" },
      ],
      subsections: [
        { title: "反馈转化为规则", points: [
          { label: "可执行规则才有效", text: "反馈必须转化为可执行规则，才会真正改善下一次表现。" },
        ] },
      ],
    },
    {
      id: "reliable-system", title: "从 Demo 到可靠系统", startSeconds: 2208,
      gist: "可靠性来自约束、观测和评估，而不是更长的提示词。",
      points: [
        { label: "窄场景闭环优先", text: "优先构建窄场景闭环，再逐步扩大自主范围。" },
        { label: "记录每一步输入输出", text: "才能定位失败原因。" },
        { label: "三维评估", text: "用任务成功率、成本和人工接管率共同评估系统。" },
      ],
    },
  ],
  conclusion: {
    paragraphs: ["Agent 不是一个更会聊天的模型，而是一套围绕目标持续运行的系统。它用规划拆解复杂性，用工具连接外部世界，用记忆保存上下文，再借助反思和评估不断纠偏。真正可落地的 Agent 应从窄场景闭环开始，并把权限、观测、成本与人工接管设计进系统。"],
    points: [
      { label: "闭环系统", text: "感知、规划、行动、反思四层构成持续运行的认知循环。" },
      { label: "落地路径", text: "从窄场景闭环开始，把权限、观测、成本与人工接管设计进系统。" },
    ],
  },
};

const demoAnalysis: AnalysisResult = {
  title: "AI Agent 的核心原理与工程实践",
  duration: "45:02",
  sourceLabel: "Bilibili · 演示分析",
  oneLineSummary: "AI Agent 是以大模型为推理核心，通过感知、规划、工具调用与反馈记忆形成闭环，从而自主完成复杂目标的系统。",
  finalSummary: "Agent 不是一个更会聊天的模型，而是一套围绕目标持续运行的系统。它用规划拆解复杂性，用工具连接外部世界，用记忆保存上下文，再借助反思和评估不断纠偏。真正可落地的 Agent 应从窄场景闭环开始，并把权限、观测、成本与人工接管设计进系统。",
  keywords: ["Agent架构", "工具调用", "记忆系统", "可靠性工程"],
  chapters: demoChapters,
  transcript: demoTranscript,
  mindmap: { label: "AI Agent 原理与实践", children: [
    { label: "核心架构", time: "04:18", children: [{ label: "感知环境" }, { label: "规划任务" }, { label: "行动与反思" }] },
    { label: "工具与记忆", time: "18:30", children: [{ label: "工具协议" }, { label: "短期记忆" }, { label: "长期召回" }] },
    { label: "工程落地", time: "36:48", children: [{ label: "窄场景闭环" }, { label: "可观测性" }, { label: "评估指标" }] },
  ] },
  article: demoArticle,
};

const answerBank = [
  "视频把 Agent 的本质归纳为一个持续闭环：理解目标、拆解任务、调用工具、检查结果，再根据反馈调整下一步。关键不在一次回答，而在能否围绕目标持续推进。",
  "最适合先落地的是边界清晰、结果可验证、已有数字化工具的任务，例如资料研究、客服分流、报表生成和代码检查。高风险或不可逆动作应保留人工确认。",
  "视频给出的可靠性方法有三类：阶段性检查点、完整的调用记录，以及把成功率、成本和人工接管率放在一起评估。对应时间点是 10:42、18:30 和 36:48。",
];

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function timeToSeconds(value?: string) {
  if (!value) return 0;
  return value.split(":").map(Number).reduce((total, part) => total * 60 + (Number.isFinite(part) ? part : 0), 0);
}

function parseSubtitle(text: string): TranscriptSegment[] {
  const normalized = text.replace(/\r/g, "").replace(/^WEBVTT[^\n]*\n+/i, "");
  const segments: TranscriptSegment[] = [];
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split("\n").filter(Boolean);
    const timingIndex = lines.findIndex((line) => /\d{1,2}:\d{2}(?::\d{2})?[,.]\d{3}\s+-->/.test(line));
    if (timingIndex < 0) continue;
    const start = lines[timingIndex].split("-->")[0].trim().replace(",", ".");
    const seconds = start.split(":").reduce((total, part) => total * 60 + Number(part), 0);
    const whole = Math.max(0, Math.floor(seconds));
    const time = start.split(":").length > 2
      ? `${String(Math.floor(whole / 3600)).padStart(2, "0")}:${String(Math.floor((whole % 3600) / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`
      : `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
    const content = lines.slice(timingIndex + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (content) segments.push({ time, seconds: whole, text: content });
  }
  if (!segments.length && text.trim()) throw new Error("请提供带真实时间轴的 SRT / VTT 字幕，不能为普通文字编造时间点。");
  return segments;
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [source, setSource] = useState("bilibili");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pipelineStatus, setPipelineStatus] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>("article");
  const [articleNotice, setArticleNotice] = useState("");
  const [articleSource, setArticleSource] = useState<ArticleSource>({ kind: "label", text: "演示分析（示例数据，非真实视频分析）" });
  const [activeTime, setActiveTime] = useState(258);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult>(demoAnalysis);
  const [isDemo, setIsDemo] = useState(true);
  const [messages, setMessages] = useState<Array<{ role: "user" | "ai"; text: string }>>([
    { role: "ai", text: "视频已经读完了。你可以追问任何知识点，我会带着时间依据回答。" },
  ]);
  const [providerId, setProviderId] = useState("deepseek");
  const chosenProvider = useMemo(() => providers.find((p) => p.id === providerId) ?? providers[0], [providerId]);
  const [model, setModel] = useState<string>(chosenProvider.model);
  const [endpoint, setEndpoint] = useState<string>(chosenProvider.endpoint);
  const [apiKey, setApiKey] = useState("");
  const [multimodal, setMultimodal] = useState(true);
  const [frameInterval, setFrameInterval] = useState("5");
  const [debugPrompt, setDebugPrompt] = useState("请用一句话说明连接是否正常。只返回中文。");
  const [debugState, setDebugState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [debugResult, setDebugResult] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chapters = analysisResult.chapters;
  const transcript = analysisResult.transcript;
  const totalSeconds = Math.max(timeToSeconds(analysisResult.duration), chapters.at(-1)?.seconds || 1);
  const articleAnchorMap = useMemo(() => (analysisResult.article ? articleAnchors(analysisResult.article) : null), [analysisResult.article]);

  function renderArticlePoints(points: ArticlePoint[]) {
    if (!points.length) return null;
    return (
      <ul className="article-points">
        {points.map((point, index) => (
          <li key={`${point.label}-${index}`}>
            {point.label ? <><strong>{point.label}：</strong>{point.text}</> : point.text}
            {point.children?.length ? renderArticlePoints(point.children) : null}
          </li>
        ))}
      </ul>
    );
  }

  const modelConfig = () => ({ provider: providerId, endpoint, model: !multimodal && model === chosenProvider.model ? chosenProvider.textModel : model, apiKey: apiKey.trim(), multimodal });

  async function jsonRequest<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const raw = await response.text();
    let result: { error?: string } & T;
    try {
      result = JSON.parse(raw) as { error?: string } & T;
    } catch {
      const isHtml = /^\s*(?:<!doctype|<html)/i.test(raw);
      throw new Error(isHtml
        ? `站点接口返回了网页错误（HTTP ${response.status}）。服务端可能暂时不可用，或上游视频站触发了访问限制，请稍后重试。`
        : `接口返回了无法解析的数据（HTTP ${response.status}）`);
    }
    if (!response.ok) throw new Error(result.error || `请求失败（HTTP ${response.status}）`);
    return result;
  }

  function switchProvider(id: string) {
    if (id === providerId) return;
    const next = providers.find((item) => item.id === id)!;
    setProviderId(id);
    setModel(next.model);
    setEndpoint(next.endpoint);
    setApiKey("");
    setDebugState("idle");
    setDebugResult("");
  }

  function chooseFile(nextFile?: File) {
    setNotice("");
    if (!nextFile) return;
    if (!nextFile.type.startsWith("video/") && !/\.(mkv|flv|wmv|avi)$/i.test(nextFile.name)) {
      setNotice("请选择视频文件。支持 MP4、MOV、AVI、WEBM、WMV、FLV、MKV。");
      return;
    }
    if (nextFile.size > 2 * 1024 ** 3) {
      setNotice("文件超过 2GB，请压缩或裁剪后再上传。");
      return;
    }
    setFile(nextFile);
    setUploadProgress(0);
  }

  async function uploadInParts(video: File) {
    const initResponse = await fetch("/api/upload/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: video.name, type: video.type, size: video.size }),
    });
    if (!initResponse.ok) throw new Error("无法创建上传任务");
    const { key, uploadId } = await initResponse.json() as { key: string; uploadId: string };
    const chunkSize = 8 * 1024 * 1024;
    const total = Math.ceil(video.size / chunkSize);
    const parts: Array<{ partNumber: number; etag: string }> = new Array(total);
    let cursor = 0;
    let sent = 0;

    async function worker() {
      while (cursor < total) {
        const index = cursor++;
        const partNumber = index + 1;
        const chunk = video.slice(index * chunkSize, Math.min(video.size, (index + 1) * chunkSize));
        const response = await fetch(`/api/upload/part?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`, { method: "PUT", body: chunk });
        if (!response.ok) throw new Error(`第 ${partNumber} 个分片上传失败`);
        parts[index] = await response.json() as { partNumber: number; etag: string };
        sent += chunk.size;
        setUploadProgress(Math.min(99, Math.round((sent / video.size) * 100)));
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(3, total) }, () => worker()));
      const complete = await fetch("/api/upload/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, uploadId, parts }),
      });
      if (!complete.ok) throw new Error("合并视频分片失败");
      setUploadProgress(100);
      return key;
    } catch (error) {
      await fetch("/api/upload/abort", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, uploadId }) }).catch(() => undefined);
      throw error;
    }
  }

  async function understandStoredVideo(key: string, displayName: string, title: string, transcript: TranscriptSegment[] = []) {
    const subtitles = transcript.map(s => `[${s.time}] ${s.text}`).join("\n");
    const videoKey = apiKey.trim();
    if (!multimodal) throw new Error("多模态已关闭，请提供字幕");
    if (providerId === "qwen") {
      setPipelineStatus("正在上传到阿里云百炼临时空间…");
      const uploaded = await jsonRequest<{ file: { uri: string; mimeType: string; name: string; model: string } }>("/api/video/qwen/upload", {
        key, apiKey: videoKey, model, displayName,
      });
      setPipelineStatus("Qwen Omni 正在同时理解声音、画面和时间轴…");
      const understood = await jsonRequest<{ analysis: AnalysisResult }>("/api/video/qwen/analyze", {
        apiKey: videoKey, model, file: uploaded.file, title, subtitles,
      });
      return understood.analysis;
    }

    if (providerId !== "gemini") throw new Error("当前服务商使用画面抽帧分析");
    setPipelineStatus("正在把视频流式交给 Gemini（大文件会花几分钟）…");
    const uploaded = await jsonRequest<{ file: { name: string; uri: string; mimeType: string; state: string } }>("/api/video/gemini/upload", { key, apiKey: videoKey, displayName });
    let geminiFile = uploaded.file;
    for (let attempt = 0; geminiFile.state === "PROCESSING" && attempt < 120; attempt++) {
      setPipelineStatus(`Gemini 正在处理音轨与画面… ${Math.floor(attempt * 5 / 60)}:${String((attempt * 5) % 60).padStart(2, "0")}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const status = await jsonRequest<{ file: typeof geminiFile }>("/api/video/gemini/status", { name: geminiFile.name, apiKey: videoKey });
      geminiFile = status.file;
    }
    if (geminiFile.state !== "ACTIVE") throw new Error(geminiFile.state === "FAILED" ? "Gemini 无法处理这个视频格式" : "Gemini 视频处理超时，请稍后重试");
    setPipelineStatus("Gemini 正在生成带时间轴的转写与知识初稿…");
    const understood = await jsonRequest<{ analysis: AnalysisResult }>("/api/video/gemini/analyze", { source: "file", file: geminiFile, apiKey: videoKey, model, title, subtitles });
    return understood.analysis;
  }

  async function analyzeText(segments: TranscriptSegment[], title: string, duration: string, sourceLabel: string) {
    if (!segments.length) throw new Error("没有可分析的字幕。可以开启多模态识别画面，或添加 SRT / VTT 字幕。");
    setPipelineStatus(`正在用 ${chosenProvider.name} 整理时间轴、要点和思维导图…`);
    const result = await jsonRequest<{ analysis: AnalysisResult }>("/api/analyze", { config: modelConfig(), metadata: { title, duration, sourceLabel }, transcript: segments });
    return { ...result.analysis, sourceLabel };
  }

  async function analyzeFrames(input: File | string, title: string, subtitles: TranscriptSegment[], sourceLabel: string) {
    const visual: TranscriptSegment[] = [];
    let duration = 0;
    const interval = Number(frameInterval);
    for await (const batch of videoFrameBatches(input, interval)) {
      duration = batch.duration;
      setPipelineStatus(`${chosenProvider.name} 正在识别画面 ${batch.progress}%（每 ${interval} 秒抽帧）…`);
      const start = batch.frames[0].seconds, end = batch.endSeconds;
      const result = await jsonRequest<{ segments: TranscriptSegment[] }>("/api/video/frames", {
        config: modelConfig(), frames: batch.frames, intervalSeconds: interval, endSeconds: end,
        transcript: subtitles.filter(s => (s.seconds ?? timeToSeconds(s.time)) >= start && (s.seconds ?? timeToSeconds(s.time)) < end),
      });
      visual.push(...result.segments);
    }
    const evidence = [...subtitles, ...visual].sort((a,b) => (a.seconds ?? timeToSeconds(a.time)) - (b.seconds ?? timeToSeconds(b.time)));
    const label = `${sourceLabel} · 每 ${interval} 秒抽帧${subtitles.length ? " + 字幕" : " · 无音轨转写"}`;
    return analyzeText(evidence, title, `${Math.floor(duration / 60).toString().padStart(2,"0")}:${Math.floor(duration % 60).toString().padStart(2,"0")}`, label);
  }

  async function startAnalysis() {
    setNotice("");
    if (multimodal && chosenProvider.mode === "frames" && (!Number.isFinite(Number(frameInterval)) || Number(frameInterval) < 0.5 || Number(frameInterval) > 60)) {
      setNotice("请在 API 设置中将识屏间隔设为 0.5–60 秒。");
      return;
    }
    if (source === "upload" && !file) {
      setNotice("请先选择一个 2GB 以内的视频文件。");
      return;
    }
    if (source !== "upload") {
      if (!url || !/bilibili\.com|b23\.tv/i.test(url)) {
        setNotice("请输入有效的 B 站视频链接。");
        return;
      }
    }
    if (!apiKey.trim()) {
      setNotice("请先到 API 设置填写并测试摘要模型的 API Key。");
      return;
    }
    setBusy(true);
    setPipelineStatus("正在准备视频…");
    let uploadedKey: string | null = null;
    try {
      let finalAnalysis: AnalysisResult;
      const attachedSubtitles = subtitleFile ? parseSubtitle(await subtitleFile.text()) : [];
      if (source === "bilibili") {
        setArticleSource({ kind: "link", url });
        setPipelineStatus("正在读取 B 站公开字幕…");
        let sourceResult: { metadata: { title: string; duration: string; sourceLabel: string }; transcript: TranscriptSegment[] };
        try {
          sourceResult = await jsonRequest("/api/source/bilibili", { url });
        } catch (error) {
          if (!multimodal && !attachedSubtitles.length) throw error;
          sourceResult = { metadata: { title: "B 站视频", duration: "--:--", sourceLabel: "Bilibili" }, transcript: [] };
        }
        const subtitles = attachedSubtitles.length ? attachedSubtitles : sourceResult.transcript;
        if (!multimodal) {
          finalAnalysis = await analyzeText(subtitles, sourceResult.metadata.title, sourceResult.metadata.duration, "Bilibili · 仅字幕");
        } else {
          setPipelineStatus("正在获取视频画面与音轨…");
          const imported = await jsonRequest<{ key: string; name: string; metadata: { title: string; duration: string } }>("/api/source/bilibili/video", { url });
          uploadedKey = imported.key;
          finalAnalysis = chosenProvider.mode === "native"
            ? await understandStoredVideo(imported.key, imported.name, imported.metadata.title, subtitles)
            : await analyzeFrames(`/api/upload/media?key=${encodeURIComponent(imported.key)}`, imported.metadata.title, subtitles, "Bilibili");
        }
      } else {
        const video = file!;
        setArticleSource({ kind: "file", name: video.name });
        if (!multimodal) {
          finalAnalysis = await analyzeText(attachedSubtitles, video.name, attachedSubtitles.at(-1)?.time || "--:--", "本地视频 · 仅字幕");
        } else if (chosenProvider.mode === "frames") {
          finalAnalysis = await analyzeFrames(video, video.name, attachedSubtitles, "本地视频");
        } else {
          setPipelineStatus("正在分片上传视频…");
          const key = await uploadInParts(video);
          uploadedKey = key;
          finalAnalysis = await understandStoredVideo(key, video.name, video.name, attachedSubtitles);
        }
      }
      setAnalysisResult(finalAnalysis);
      setIsDemo(false);
      setArticleNotice("");
      setActiveTime(finalAnalysis.chapters[0]?.seconds || 0);
      setMessages([{ role: "ai", text: "真实视频已经处理完成。你可以追问任何知识点，我会只依据视频并引用时间回答。" }]);
      setAnalysisTab(finalAnalysis.article ? "article" : "timeline");
      setView("analysis");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "处理失败，请稍后重试。");
    } finally {
      if (uploadedKey) {
        await fetch("/api/upload/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: uploadedKey }), signal: AbortSignal.timeout(10000) }).catch(() => undefined);
      }
      setBusy(false);
      setPipelineStatus("");
    }
  }

  function openDemo() {
    setBusy(false);
    setAnalysisResult(demoAnalysis);
    setIsDemo(true);
    setArticleSource({ kind: "label", text: "演示分析（示例数据，非真实视频分析）" });
    setActiveTime(258);
    setAnalysisTab("article");
    setView("analysis");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function currentArticleMarkdown() {
    if (!analysisResult.article) return "";
    return buildArticleMarkdown(analysisResult.article, articleSource);
  }

  function exportArticleMarkdown() {
    const markdown = currentArticleMarkdown();
    if (!markdown) return;
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = articleFileName(analysisResult.article!);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(href);
    setArticleNotice(`已导出 ${link.download}`);
  }

  async function copyArticleMarkdown() {
    const markdown = currentArticleMarkdown();
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = markdown;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setArticleNotice("已复制 Markdown 到剪贴板");
  }

  async function ask(question?: string) {
    const text = (question ?? chatInput).trim();
    if (!text || chatBusy) return;
    setChatInput("");
    setMessages((current) => [...current, { role: "user", text }]);
    if (isDemo && !apiKey.trim()) {
      const answer = /可靠|生产|落地/.test(text) ? answerBank[2] : /适合|场景|应用/.test(text) ? answerBank[1] : answerBank[0];
      setMessages((current) => [...current, { role: "ai", text: answer }]);
      return;
    }
    setChatBusy(true);
    try {
      const result = await jsonRequest<{ answer: string }>("/api/ask", { config: modelConfig(), question: text, analysis: analysisResult });
      setMessages((current) => [...current, { role: "ai", text: result.answer }]);
    } catch (error) {
      setMessages((current) => [...current, { role: "ai", text: error instanceof Error ? `问答失败：${error.message}` : "问答失败，请稍后重试。" }]);
    } finally {
      setChatBusy(false);
    }
  }

  async function testApi() {
    if (!apiKey || !endpoint || !model) {
      setDebugState("error");
      setDebugResult("请完整填写 API Key、接口地址和模型名称。");
      return;
    }
    setDebugState("running");
    setDebugResult("");
    try {
      const result = await jsonRequest<{ ok?: boolean; latency?: number; content?: string }>("/api/debug", { ...modelConfig(), prompt: debugPrompt });
      if (!result.ok) throw new Error("连接失败");
      setDebugState("done");
      setDebugResult(`${result.content || "连接成功"}\n\nHTTP 200 · ${result.latency} ms`);
    } catch (error) {
      setDebugState("error");
      setDebugResult(error instanceof Error ? error.message : "连接失败");
    }
  }

  return (
    <main className={`app-shell ${view !== "home" ? "dashboard-shell" : ""}`}>
      <header className="topbar">
        <button className="brand brand-button" onClick={() => setView("home")} aria-label="知幕 AI 首页">
          <span className="brand-mark">知</span>
          <span>知幕 AI</span>
          <span className="brand-badge">BETA</span>
        </button>
        <nav className="main-nav" aria-label="主导航">
          <button className={view === "home" ? "active" : ""} onClick={() => setView("home")}>工作台</button>
          <button className={view === "analysis" ? "active" : ""} onClick={openDemo}>知识库</button>
          <button className={view === "api" ? "active" : ""} onClick={() => setView("api")}>API 设置</button>
        </nav>
        <div className="header-actions">
          <span className="api-dot" /> <span className="header-model">{chosenProvider.name} · {model}</span>
          <button className="round-button" onClick={() => setView("api")} aria-label="打开 API 设置">⚙</button>
        </div>
      </header>

      {view === "home" && (
        <>
          <section className="hero" id="workspace">
            <div className="hero-copy">
              <div className="eyebrow"><span className="pulse" /> AI 视频知识引擎</div>
              <h1>把长视频，变成<br /><em>可检索的知识</em></h1>
              <p>按主题整理成详细的文章笔记：目录、要点、数据与案例一目了然，还能看时间轴、追问知识点、生成思维导图。</p>
              <div className="proof-row"><span>✓ 文章笔记</span><span>✓ 精准时间轴</span><span>✓ 多模型自由切换</span></div>
              <button className="demo-link" onClick={openDemo}><span>▶</span> 先看一份分析示例</button>
            </div>

            <div className="import-panel">
              <div className="panel-heading">
                <div><span className="step-label">01 · 添加视频</span><h2>从哪里开始？</h2></div>
                <span className="secure-note">♢ 私密处理</span>
              </div>
              <div className="source-tabs" role="tablist" aria-label="视频来源">
                {sources.map((item) => (
                  <button key={item.id} className={`source-tab ${source === item.id ? "selected" : ""}`} onClick={() => { setSource(item.id); setNotice(""); }} role="tab" aria-selected={source === item.id}>
                    <span className={`source-mark ${item.tone}`}>{item.mark}</span>{item.label}
                  </button>
                ))}
              </div>
              {source === "upload" ? (
                <div className="upload-wrap">
                  <label className={`upload-zone ${file ? "has-file" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer.files[0]); }}>
                    <input ref={fileInputRef} type="file" accept="video/*,.mkv" onChange={(event) => chooseFile(event.target.files?.[0])} />
                    {file ? <><span className="file-icon">▶</span><strong>{file.name}</strong><small>{formatBytes(file.size)} · 已通过大小检查</small></> : <><span className="upload-icon">↑</span><strong>拖入视频，或点击选择</strong><small>MP4、MOV、AVI、WEBM、WMV、FLV · 最大 2GB</small></>}
                  </label>
                  {busy && <div className="upload-progress"><span style={{ width: `${uploadProgress}%` }} /><small>{pipelineStatus || `分片上传 ${uploadProgress}%`}</small></div>}
                </div>
              ) : (
                <div className="url-entry">
                  <label htmlFor="video-url">粘贴 B 站视频链接</label>
                  <div className="url-row"><input id="video-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.bilibili.com/video/BV..." /><button onClick={startAnalysis} disabled={busy}>{busy ? "真实处理中…" : "解析视频"} <span>→</span></button></div>
                  <p className="source-hint">{multimodal ? "多模态已开启：识别视频画面，并结合可用字幕。" : "多模态已关闭：只读取公开字幕或随附字幕。"}</p>
                  {busy && pipelineStatus && <p className="pipeline-status"><i /> {pipelineStatus}</p>}
                </div>
              )}
              <label className="subtitle-picker"><input type="file" accept=".srt,.vtt" onChange={(event) => setSubtitleFile(event.target.files?.[0] || null)} /><span>{subtitleFile ? `✓ ${subtitleFile.name}` : "+ 添加 SRT / VTT 字幕"}</span></label>
              {subtitleFile && <button className="clear-subtitle" onClick={() => setSubtitleFile(null)}>移除字幕</button>}
              <div className="workspace-mode"><span>{multimodal ? `多模态 · ${chosenProvider.capability}` : "仅文字 · 字幕摘要"}</span><button onClick={() => setView("api")}>修改设置</button></div>
              {source === "upload" && <button className="analyze-button" onClick={startAnalysis} disabled={busy}>{busy ? (pipelineStatus || `安全上传中 ${uploadProgress}%`) : "上传并开始真实分析"}<span>→</span></button>}
              {notice && <p className="form-notice">! {notice}</p>}
              <div className="panel-footer"><div className="mini-avatars"><i>豆</i><i>K</i><i>Q</i><i>G</i></div><span>DeepSeek、Kimi、通义、豆包、GLM、Gemini、GPT 任意切换</span></div>
            </div>
          </section>
          <section className="preview-strip" aria-label="产品能力预览">
            <div><span>00:42</span><strong>核心问题</strong><p>AI Agent 与传统自动化的本质区别</p></div>
            <div><span>03:18</span><strong>关键框架</strong><p>感知、规划、行动、反思四层架构</p></div>
            <div><span>08:56</span><strong>实践案例</strong><p>如何把复杂任务拆成可靠工作流</p></div>
            <div className="strip-action"><b>18</b><small>个知识节点</small><button onClick={openDemo}>查看完整分析 →</button></div>
          </section>
        </>
      )}

      {view === "analysis" && (
        <section className="analysis-page">
          <aside className="video-sidebar">
            <button className="back-link" onClick={() => setView("home")}>← 新建分析</button>
            <div className="video-card">
              <div className="fake-video">
                <span className="video-source">{analysisResult.sourceLabel.split("·")[0].trim().toUpperCase()}</span><div className="orb orb-one" /><div className="orb orb-two" /><b>VIDEO<br />KNOWLEDGE</b><button aria-label="定位当前时间">▶</button>
              </div>
              <div className="player-progress"><span style={{ width: `${Math.max(4, (activeTime / totalSeconds) * 100)}%` }} /></div>
              <div className="player-time"><span>{chapters.find((item) => item.seconds === activeTime)?.time || "00:00"}</span><span>{analysisResult.duration || "--:--"}</span></div>
              <div className="video-info"><span className="bili-pill">知</span><div><h3>{analysisResult.title}</h3><p>{analysisResult.sourceLabel}</p></div></div>
            </div>
            <div className="meta-card"><span><b>{analysisResult.duration || "--:--"}</b><small>视频时长</small></span><span><b>{chapters.length}</b><small>核心章节</small></span><span><b>{chapters.reduce((sum, chapter) => sum + chapter.points.length, 0)}</b><small>知识要点</small></span></div>
            <div className="model-card"><span className="provider-logo" style={{ background: chosenProvider.color }}>{chosenProvider.short}</span><div><small>本次分析模型</small><b>{chosenProvider.name} · {model}</b></div><button onClick={() => setView("api")}>切换</button></div>
          </aside>

          <div className="analysis-main">
            <div className="analysis-head">
              <div><span className="result-label"><i /> {isDemo ? "演示分析" : "真实分析已完成"}</span><h2>{analysisResult.title}</h2><p>{analysisResult.article ? `已按主题整理为 ${analysisResult.article.sections.length} 个章节的详细文章笔记，并联动时间轴、思维导图与问答。` : `已按时间顺序提取 ${chapters.reduce((sum, chapter) => sum + chapter.points.length, 0)} 个知识要点，并生成转写与知识图谱。`}</p></div>
              <div className="export-actions"><button>↗ 分享</button><button onClick={exportArticleMarkdown} disabled={!analysisResult.article}>↓ 导出笔记</button></div>
            </div>
            <div className="summary-card">
              <div className="summary-icon">✦</div><div><span>一句话总结</span><p>{analysisResult.oneLineSummary || analysisResult.article?.conclusion.paragraphs[0]}</p></div>
            </div>
            <div className="analysis-tabs" role="tablist">
              <button className={analysisTab === "article" ? "active" : ""} onClick={() => setAnalysisTab("article")}>✎ 文章笔记 {analysisResult.article && <span>{analysisResult.article.sections.length}</span>}</button>
              <button className={analysisTab === "timeline" ? "active" : ""} onClick={() => setAnalysisTab("timeline")}>◷ 要点时间轴 <span>{chapters.reduce((sum, chapter) => sum + chapter.points.length, 0)}</span></button>
              <button className={analysisTab === "mindmap" ? "active" : ""} onClick={() => setAnalysisTab("mindmap")}>⌘ 思维导图</button>
              <button className={analysisTab === "transcript" ? "active" : ""} onClick={() => setAnalysisTab("transcript")}>≡ 字幕 / 画面记录</button>
            </div>

            {analysisTab === "article" && (
              analysisResult.article ? (
                <div className="article-card">
                  <div className="article-toolbar">
                    <div><b>文章笔记</b><span>按主题整理的详细知识笔记 · 目录可点击跳转</span></div>
                    <div className="article-actions">
                      <button onClick={copyArticleMarkdown}>⧉ 复制 Markdown</button>
                      <button onClick={exportArticleMarkdown}>↓ 导出 .md</button>
                    </div>
                  </div>
                  {articleNotice && <p className="article-notice">✓ {articleNotice}</p>}
                  <div className="article-body">
                    {articleSource.kind === "link" ? (
                      /^https?:\/\//i.test(articleSource.url)
                        ? <blockquote className="article-source">来源链接：<a href={articleSource.url} target="_blank" rel="noreferrer">{articleSource.label || articleSource.url}</a></blockquote>
                        : <blockquote className="article-source">来源链接：{articleSource.url}</blockquote>
                    ) : articleSource.kind === "file" ? (
                      <blockquote className="article-source">来源文件：{articleSource.name}</blockquote>
                    ) : (
                      <blockquote className="article-source">来源：{articleSource.text}</blockquote>
                    )}
                    <h2 className="article-title">{analysisResult.article.title || analysisResult.title}</h2>
                    <nav className="article-toc" aria-label="文章目录">
                      <b>目录</b>
                      {analysisResult.article.sections.map((section, index) => (
                        <a key={section.id} href={`#${articleAnchorMap!.sections[index]}`}>{sectionHeading(index + 1, section)}</a>
                      ))}
                      <a href={`#${articleAnchorMap!.conclusion}`}>AI 总结</a>
                    </nav>
                    <div className="article-sections">
                      {analysisResult.article.sections.map((section, index) => (
                        <section key={section.id} id={articleAnchorMap!.sections[index]} className="article-section">
                          <h3>
                            {index + 1}. {section.title}
                            {section.startSeconds != null && <button className="article-time" onClick={() => setActiveTime(section.startSeconds!)} title="定位到该主题的开始时间">{formatTimecode(section.startSeconds)} ▶</button>}
                          </h3>
                          {renderArticlePoints(section.points)}
                          {(section.subsections || []).map((subsection) => (
                            <div key={subsection.title} className="article-subsection">
                              <h4>{subsection.title}</h4>
                              {renderArticlePoints(subsection.points)}
                            </div>
                          ))}
                        </section>
                      ))}
                      <section id={articleAnchorMap!.conclusion} className="article-conclusion">
                        <h3>AI 总结</h3>
                        {analysisResult.article.conclusion.paragraphs.map((paragraph, pIndex) => <p key={pIndex}>{paragraph}</p>)}
                        {!!analysisResult.article.conclusion.points?.length && (
                          <div className="article-key-conclusions">
                            <b>关键结论：</b>
                            <ol>
                              {analysisResult.article.conclusion.points.map((point, pIndex) => (
                                <li key={pIndex}>{point.label ? <><strong>{point.label}：</strong>{point.text}</> : point.text}</li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </section>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="article-card article-empty">
                  <b>当前结果为旧格式</b>
                  <p>这条结果不包含文章笔记。重新运行一次分析即可生成按主题组织的详细文章笔记。</p>
                </div>
              )
            )}

            {analysisTab === "timeline" && (
              <div className="timeline-list">
                {chapters.map((chapter, index) => (
                  <article key={`${chapter.title}-${index}`} className={`timeline-item ${activeTime === chapter.seconds ? "current" : ""}`}>
                    {chapter.time && chapter.seconds != null ? (
                      <button className="time-button" onClick={() => setActiveTime(chapter.seconds!)}>{chapter.time}<span>▶</span></button>
                    ) : (
                      <span className="time-button no-time" title="该主题没有可定位的时间证据">--:--</span>
                    )}
                    <div className="timeline-line"><i>{index + 1}</i></div>
                    <div className="chapter-card"><div className="chapter-title">{chapter.tag && <span>{chapter.tag}</span>}<h3>{chapter.title}</h3><button aria-label="收藏知识点">☆</button></div>{chapter.intro && <p>{chapter.intro}</p>}<ul>{chapter.points.map((point) => <li key={point}>{point}</li>)}</ul></div>
                  </article>
                ))}
                <article className="final-summary"><span>总结</span><div><h3>这段视频最终讲清了什么？</h3><p>{analysisResult.finalSummary}</p><div className="keyword-row">{analysisResult.keywords.map((keyword) => <i key={keyword}># {keyword}</i>)}</div></div></article>
              </div>
            )}

            {analysisTab === "mindmap" && (
              <div className="mindmap-card">
                <div className="map-toolbar"><div><b>知识结构图</b><span>点击节点定位对应时间</span></div><button onClick={() => window.print()}>↓ 打印 / 存为 PDF</button></div>
                <div className="mindmap-canvas">
                  <button className="map-root" onClick={() => setActiveTime(0)}>{analysisResult.mindmap.label}<br /><small>视频知识图谱</small></button>
                  <div className="map-trunk" />
                  <div className="map-branches">
                    {(analysisResult.mindmap.children || []).map((node, index) => <div key={`${node.label}-${index}`} className={`map-branch ${["purple", "blue", "lime"][index % 3]}`}><button onClick={() => { if (node.time) setActiveTime(timeToSeconds(node.time)); }}>{node.label} {node.time && <small>{node.time}</small>}</button><div>{(node.children || []).map((child) => <span key={child.label}>{child.label}</span>)}</div></div>)}
                  </div>
                </div>
                <p className="map-caption">思维导图按文章笔记的主题结构生成，节点保留可定位的原视频时间。</p>
              </div>
            )}

            {analysisTab === "transcript" && (
              <div className="transcript-card"><div className="transcript-search">≡ <b>带时间轴的文字稿</b><span>共 {transcript.reduce((sum, item) => sum + item.text.length, 0).toLocaleString()} 字</span></div>{transcript.map((item, index) => <article key={`${item.time}-${index}`}>{item.time && item.seconds != null ? <button onClick={() => setActiveTime(item.seconds!)}>{item.time}</button> : <span className="no-time">--:--</span>}<p>{item.text}</p></article>)}</div>
            )}
          </div>

          <aside className="chat-panel">
            <div className="chat-head"><div><span>✦</span><div><b>问问视频</b><small><i /> 基于本视频回答</small></div></div><button aria-label="更多">•••</button></div>
            <div className="chat-body">
              {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`message ${message.role}`}><span>{message.role === "ai" ? "知" : "我"}</span><p>{message.text}</p></div>)}
              {chatBusy && <div className="message ai"><span>知</span><p>正在检索视频时间轴并组织回答…</p></div>}
              {messages.length === 1 && <div className="suggested"><span>你可以这样问</span><button onClick={() => ask("这段视频的核心结论是什么？")}>这段视频的核心结论是什么？ <b>→</b></button><button onClick={() => ask("视频给出了哪些具体方法或步骤？")}>有哪些具体方法或步骤？ <b>→</b></button><button onClick={() => ask("视频里的关键概念之间是什么关系？")}>关键概念之间是什么关系？ <b>→</b></button></div>}
            </div>
            <div className="chat-input"><textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(); } }} placeholder="针对视频内容提问…" /><div><span>回答将引用时间点</span><button onClick={() => ask()} disabled={!chatInput.trim() || chatBusy}>↑</button></div></div>
          </aside>
        </section>
      )}

      {view === "api" && (
        <section className="api-page" id="api">
          <div className="settings-side">
            <button className="back-link" onClick={() => setView("home")}>← 返回工作台</button>
            <div className="settings-intro"><span className="eyebrow">模型设置</span><h1>一个 Key，<br />开始分析。</h1><p>选择服务商，填写它的 API Key。视频理解、摘要与问答共用这一把密钥。</p></div>
            <div className="security-note"><span>◇</span><div><b>密钥安全</b><p>API Key 不写入数据库或浏览器存储。关闭页面后即清除。</p></div></div>
          </div>
          <div className="settings-main">
            <div className="settings-heading"><div><span>01 · 选择服务商</span><h2>模型与 API 设置</h2></div><span className={`connection-badge ${debugState}`}><i /> {debugState === "done" ? "连接正常" : debugState === "error" ? "连接失败" : debugState === "running" ? "正在验证" : "等待调试"}</span></div>
            <div className="provider-grid">
              {providers.map((provider) => <button key={provider.id} className={providerId === provider.id ? "selected" : ""} onClick={() => switchProvider(provider.id)}><span style={{ background: provider.color }}>{provider.short}</span><div><b>{provider.name}</b><small>{provider.modelLabel}</small><em>{provider.capability}</em></div><i>{providerId === provider.id ? "✓" : ""}</i></button>)}
            </div>
            <div className="api-form">
              <div className="form-section-title"><span>02 · 填写密钥</span><small>模型信息核对于 2026-09-17</small></div>
              <div className="form-grid">
                <label className="wide"><span>{chosenProvider.name} API Key</span><div className="input-with-icon"><input type="password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setDebugState("idle"); }} placeholder={`粘贴 ${chosenProvider.name} 开放平台 API Key`} autoComplete="off" /><b>不保存</b></div><small className="key-help">用于当前服务商的分析与问答。切换服务商后，请填对应的 Key。</small></label>
              </div>
              <div className={`multimodal-control ${multimodal ? "enabled" : ""}`}>
                <div><b>开启多模态</b><p>{multimodal ? `已开启 · ${chosenProvider.capability}` : "已关闭 · 只分析字幕文字，不上传画面或音轨"}</p></div>
                <button type="button" role="switch" aria-checked={multimodal} aria-label="开启多模态" onClick={() => { setMultimodal(!multimodal); setDebugState("idle"); }}><span /></button>
              </div>
              {multimodal && (chosenProvider.mode === "frames" ? <div className="frame-interval"><label htmlFor="frame-interval">识屏间隔 <span>秒 / 帧</span></label><input id="frame-interval" type="number" min="0.5" max="60" step="0.5" value={frameInterval} onChange={(event) => setFrameInterval(event.target.value)} /><p>可设 0.5–60 秒，默认 5 秒。间隔越短越细致，也更慢、更费 Token；抽帧可能遗漏短暂画面，不等于完整语音转写。</p></div> : <p className="key-help">当前使用原生音画理解，由模型自动采样；自定义识屏间隔适用于 DeepSeek、GLM 等抽帧模型。</p>)}
              <p className="model-recommendation">{chosenProvider.help} <a href={chosenProvider.docs} target="_blank" rel="noreferrer">官方说明 ↗</a></p>
              <details className="advanced-settings"><summary>高级设置 <span>已自动填好推荐模型</span></summary><div className="form-grid"><label className="wide"><span>模型名称</span><input value={model} onChange={(event) => { setModel(event.target.value); setDebugState("idle"); }} /></label><label className="wide"><span>接口地址</span><input value={endpoint} onChange={(event) => { setEndpoint(event.target.value); setDebugState("idle"); }} /><small className="key-help">直接音画处理使用所选服务商的官方上传接口。自定义地址仅影响文字及抽帧请求。</small></label></div></details>
            </div>
            <div className="debug-console">
              <div className="console-head"><div><span>03 · 连接测试</span><b>{multimodal ? "验证文字与看图能力" : "验证文字模型"}</b></div><button onClick={testApi} disabled={debugState === "running"}>{debugState === "running" ? "正在连接…" : "▶ 测试连接"}</button></div>
              <div className="console-body"><div className="request-editor"><span>REQUEST</span><textarea value={debugPrompt} onChange={(event) => setDebugPrompt(event.target.value)} /></div><div className={`response-view ${debugState}`}><span>RESPONSE</span>{debugState === "idle" && <p className="response-placeholder">运行测试后，这里会显示模型返回、HTTP 状态与耗时。</p>}{debugState === "running" && <p className="response-placeholder loading">正在发送安全测试请求…</p>}{(debugState === "done" || debugState === "error") && <pre>{debugResult}</pre>}</div></div>
            </div>
            <div className="save-row"><p><b>当前模型</b><span>{chosenProvider.name} · {modelConfig().model}</span></p><button onClick={() => { setNotice("配置已应用到当前会话"); setView("home"); }}>应用并返回 <span>→</span></button></div>
          </div>
        </section>
      )}
    </main>
  );
}
