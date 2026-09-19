import { geminiJson, geminiKey } from "../../../_lib/gemini";
import { errorResponse, UpstreamError } from "../../../_lib/llm";

export async function POST(request: Request) {
  try {
    const { name, apiKey } = await request.json() as { name?: string; apiKey?: string };
    if (!name || !/^files\/[A-Za-z0-9_-]+$/.test(name)) throw new UpstreamError("Gemini 文件标识无效", 400);
    const token = geminiKey(apiKey || "");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, { headers: { "x-goog-api-key": token }, signal: AbortSignal.timeout(30000) });
    const data = await geminiJson(response);
    return Response.json({ ok: true, file: { name: data.name, uri: data.uri, mimeType: data.mimeType, state: data.state } });
  } catch (error) {
    return errorResponse(error);
  }
}
