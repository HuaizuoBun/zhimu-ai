import { UpstreamError } from "./llm";

const BILI_HOST = /(^|\.)bilibili\.com$|^b23\.tv$/i;
export const BILI_HEADERS = { referer: "https://www.bilibili.com/", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36" };

export async function responseJson<T>(response: Response, label: string): Promise<T> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    const isHtml = /^\s*</.test(raw) || /<!doctype|<html/i.test(raw);
    throw new UpstreamError(
      isHtml ? `${label}被对方风控拦截，返回了网页而不是接口数据。请稍后重试，或下载视频后从“本地视频”分析。` : `${label}返回的数据格式异常。`,
      502,
      raw.slice(0, 300),
    );
  }
}

export async function resolveBvid(input: string) {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new UpstreamError("B 站链接格式不正确", 400); }
  if (url.protocol !== "https:" || !BILI_HOST.test(url.hostname)) throw new UpstreamError("只支持公开的 B 站 HTTPS 视频链接", 400);
  let resolved = url;
  if (url.hostname.toLowerCase() === "b23.tv") {
    const response = await fetch(url, { method: "HEAD", redirect: "manual", headers: BILI_HEADERS });
    const location = response.headers.get("location");
    if (!location) throw new UpstreamError("无法解析 B 站短链接，请粘贴完整视频地址", 400);
    resolved = new URL(location, url);
    if (!BILI_HOST.test(resolved.hostname)) throw new UpstreamError("B 站短链接跳转目标无效", 400);
  }
  const match = `${resolved.pathname}${resolved.search}`.match(/BV[0-9A-Za-z]{10}/i);
  if (!match) throw new UpstreamError("链接中没有找到 BV 号", 400);
  return match[0];
}

type ViewData = { title?: string; duration?: number; cid?: number; pages?: Array<{ cid?: number }> };

export async function getBilibiliVideo(input: string) {
  const bvid = await resolveBvid(input);
  const headers = { ...BILI_HEADERS, referer: `https://www.bilibili.com/video/${bvid}` };
  const response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, { headers });
  const json = await responseJson<{ code?: number; message?: string; data?: ViewData }>(response, "B 站视频信息接口");
  if (!response.ok || json.code !== 0 || !json.data) throw new UpstreamError(json.message || "B 站视频信息读取失败", 502);
  const cid = json.data.cid || json.data.pages?.[0]?.cid;
  if (!cid) throw new UpstreamError("没有找到视频分 P 信息", 502);
  return { bvid, cid, headers, data: json.data };
}
