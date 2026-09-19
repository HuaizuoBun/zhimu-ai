import { secondsToTime } from "../../_lib/analysis";
import { getBilibiliVideo, responseJson } from "../../_lib/bilibili";
import { errorResponse, UpstreamError } from "../../_lib/llm";

export async function POST(request: Request) {
  try {
    const { url } = await request.json() as { url?: string };
    if (!url) throw new UpstreamError("请提供 B 站视频链接", 400);
    const { bvid, cid, headers, data: info } = await getBilibiliVideo(url);

    const playerResponse = await fetch(`https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${cid}`, { headers });
    const playerJson = await responseJson<{
      code?: number;
      message?: string;
      data?: { subtitle?: { subtitles?: Array<{ lan?: string; lan_doc?: string; subtitle_url?: string }> } };
    }>(playerResponse, "B 站字幕索引接口");
    if (!playerResponse.ok || playerJson.code !== 0) throw new UpstreamError(playerJson.message || "B 站字幕索引读取失败", 502);
    const subtitles = playerJson.data?.subtitle?.subtitles || [];
    if (!subtitles.length) {
      return Response.json({
        ok: true,
        hasSubtitle: false,
        metadata: { title: info.title || bvid, duration: secondsToTime(info.duration || 0), durationSeconds: info.duration || 0, sourceLabel: "Bilibili · 无公开字幕", bvid },
        transcript: [],
      });
    }
    const preferred = subtitles.find((item) => /^zh/i.test(item.lan || "")) || subtitles[0];
    const subtitleUrl = new URL(preferred.subtitle_url?.startsWith("//") ? `https:${preferred.subtitle_url}` : preferred.subtitle_url || "");
    if (subtitleUrl.protocol !== "https:" || !/(^|\.)hdslb\.com$/i.test(subtitleUrl.hostname)) throw new UpstreamError("B 站返回了无效的字幕地址", 502);
    const subtitleResponse = await fetch(subtitleUrl, { headers });
    const subtitleJson = await responseJson<{ body?: Array<{ from?: number; to?: number; content?: string }> }>(subtitleResponse, "B 站字幕文件");
    const transcript = (subtitleJson.body || []).filter((item) => typeof item.content === "string" && typeof item.from === "number").map((item) => ({
      time: secondsToTime(item.from || 0),
      seconds: item.from || 0,
      text: item.content!.trim(),
    }));
    if (!transcript.length) throw new UpstreamError("字幕文件为空，无法分析", 422);
    return Response.json({
      ok: true,
      metadata: {
        title: info.title || bvid,
        duration: secondsToTime(info.duration || transcript.at(-1)?.seconds || 0),
        durationSeconds: info.duration || 0,
        sourceLabel: `Bilibili · ${preferred.lan_doc || preferred.lan || "公开字幕"}`,
        bvid,
      },
      hasSubtitle: true,
      transcript,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
