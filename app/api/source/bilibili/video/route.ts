import { secondsToTime } from "../../../_lib/analysis";
import { getBilibiliVideo, responseJson } from "../../../_lib/bilibili";
import { errorResponse, UpstreamError } from "../../../_lib/llm";
import { videoBucket } from "../../../_lib/video-store";

type PlayUrl = { url?: string; size?: number; length?: number };

export async function POST(request: Request) {
  try {
    const { url } = await request.json() as { url?: string };
    if (!url) throw new UpstreamError("请提供 B 站视频链接", 400);
    const { bvid, cid, headers, data: info } = await getBilibiliVideo(url);
    const api = new URL("https://api.bilibili.com/x/player/playurl");
    api.searchParams.set("bvid", bvid);
    api.searchParams.set("cid", String(cid));
    api.searchParams.set("qn", "16");
    api.searchParams.set("fnval", "0");
    api.searchParams.set("fnver", "0");
    api.searchParams.set("fourk", "0");
    api.searchParams.set("platform", "html5");
    const playResponse = await fetch(api, { headers });
    const play = await responseJson<{ code?: number; message?: string; data?: { durl?: PlayUrl[]; format?: string } }>(playResponse, "B 站视频流接口");
    if (!playResponse.ok || play.code !== 0) throw new UpstreamError(play.message || "无法获取 B 站视频流", 502);
    const parts = play.data?.durl || [];
    if (parts.length !== 1 || !parts[0].url) {
      throw new UpstreamError("这个 B 站视频是多段或分离音轨格式，当前无法无损拼接。若视频有字幕可直接解析；否则请下载后作为本地视频上传。", 422);
    }
    if ((parts[0].size || 0) > 2 * 1024 * 1024 * 1024) throw new UpstreamError("视频流超过 2GB，无法导入", 413);
    const mediaResponse = await fetch(parts[0].url, { headers });
    if (!mediaResponse.ok || !mediaResponse.body) throw new UpstreamError(`B 站视频流下载失败（HTTP ${mediaResponse.status}）`, 502);
    const headerType = mediaResponse.headers.get("content-type") || "";
    const contentType = /video\//i.test(headerType) ? headerType.split(";")[0] : "video/x-flv";
    const extension = contentType.includes("mp4") ? "mp4" : contentType.includes("webm") ? "webm" : "flv";
    const key = `videos/${crypto.randomUUID()}-${bvid}.${extension}`;
    const object = await videoBucket().put(key, mediaResponse.body, { httpMetadata: { contentType } });
    return Response.json({
      ok: true,
      key: object.key,
      size: object.size,
      mimeType: contentType,
      name: `${bvid}.${extension}`,
      metadata: {
        title: info.title || bvid,
        duration: secondsToTime(info.duration || Math.round((parts[0].length || 0) / 1000)),
        durationSeconds: info.duration || Math.round((parts[0].length || 0) / 1000),
        sourceLabel: "Bilibili · 直接音画识别",
        bvid,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
