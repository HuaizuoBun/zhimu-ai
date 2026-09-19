import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
register(new URL("./helpers/cloudflare-loader.mjs", import.meta.url));

async function loadWorker(label) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${label}-${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const execution = { waitUntil() {}, passThroughOnException() {} };

test("DeepSeek 401 is explained in actionable Chinese", async () => {
  const worker = await loadWorker("deepseek-auth");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { message: "Authentication Fails, Your api key is invalid" } }, { status: 401 });
  try {
    const response = await worker.fetch(new Request("http://localhost/api/debug", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "deepseek", endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-chat", apiKey: "  fake-key  ", prompt: "ping" }),
    }), {}, execution);
    assert.equal(response.status, 401);
    const data = await response.json();
    assert.match(data.error, /platform\.deepseek\.com\/api_keys/);
    assert.doesNotMatch(JSON.stringify(data), /fake-key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Bilibili source route turns public subtitle JSON into a timeline", async () => {
  const worker = await loadWorker("bilibili-source");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("x/web-interface/view")) return Response.json({ code: 0, data: { title: "测试视频", duration: 125, cid: 99 } });
    if (url.includes("x/player/v2")) return Response.json({ code: 0, data: { subtitle: { subtitles: [{ lan: "zh-CN", lan_doc: "中文", subtitle_url: "//i0.hdslb.com/bfs/subtitle/test.json" }] } } });
    if (url.includes("hdslb.com")) return Response.json({ body: [{ from: 1.2, to: 3.4, content: "第一条知识点" }, { from: 62, to: 65, content: "第二条知识点" }] });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/source/bilibili", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://www.bilibili.com/video/BV1xx411c7mD" }),
    }), {}, execution);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.hasSubtitle, true);
    assert.equal(data.metadata.title, "测试视频");
    assert.deepEqual(data.transcript.map((item) => item.time), ["00:01", "01:02"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Bilibili source route returns JSON when upstream sends an HTML risk-control page", async () => {
  const worker = await loadWorker("bilibili-html");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<!DOCTYPE html><html><title>412</title></html>", { status: 412, headers: { "content-type": "text/html" } });
  try {
    const response = await worker.fetch(new Request("http://localhost/api/source/bilibili", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://www.bilibili.com/video/BV1xx411c7mD" }),
    }), {}, execution);
    assert.equal(response.status, 502);
    assert.match(response.headers.get("content-type"), /application\/json/);
    const data = await response.json();
    assert.match(data.error, /风控拦截/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Bilibili source route allows no-subtitle videos to continue to vision analysis", async () => {
  const worker = await loadWorker("bilibili-no-subtitle");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const target = String(input);
    if (target.includes("x/web-interface/view")) return Response.json({ code: 0, data: { title: "无字幕视频", duration: 88, cid: 7 } });
    if (target.includes("x/player/v2")) return Response.json({ code: 0, data: { subtitle: { subtitles: [] } } });
    throw new Error(`Unexpected fetch: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/source/bilibili", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://www.bilibili.com/video/BV1xx411c7mD" }),
    }), {}, execution);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.hasSubtitle, false);
    assert.deepEqual(data.transcript, []);
    assert.equal(data.metadata.title, "无字幕视频");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qwen Omni video route sends the temporary video URI with audio-visual instructions", async () => {
  const worker = await loadWorker("qwen-video");
  const originalFetch = globalThis.fetch;
  let requestBody;
  let requestHeaders;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(init.body);
    requestHeaders = new Headers(init.headers);
    const content = JSON.stringify({
      title: "Qwen 视频测试", duration: "01:00", sourceLabel: "测试", oneLineSummary: "一句话",
      finalSummary: "总结", keywords: ["音画"],
      article: { version: 1, title: "Qwen 视频测试", sections: [{ title: "开场", startSeconds: 0, gist: "介绍", points: [{ label: "要点标签", text: "要点解释" }] }], conclusion: { paragraphs: ["总结"], points: [{ label: "结论", text: "内容" }] } },
      chapters: [{ time: "00:00", seconds: 0, tag: "主题", title: "开场", intro: "介绍", points: ["要点"] }],
      transcript: [{ time: "00:00", seconds: 0, text: "测试转写" }],
      mindmap: { label: "Qwen 视频测试", children: [{ label: "开场", time: "00:00" }] },
    });
    const chunks = [content.slice(0, 80), content.slice(80)];
    return new Response(chunks.map(text => `data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\n`).join("") + "data: [DONE]\n\n", {headers:{"content-type":"text/event-stream"}});
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/video/qwen/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "test-qwen", model: "qwen3.5-omni-flash", file: { uri: "oss://dashscope-instant/test.mp4" }, title: "测试" }),
    }), {}, execution);
    assert.equal(response.status, 200);
    assert.equal(requestHeaders.get("x-dashscope-ossresourceresolve"), "enable");
    assert.equal(requestBody.messages[0].content[0].type, "video_url");
    assert.equal(requestBody.messages[0].content[0].video_url.url, "oss://dashscope-instant/test.mp4");
    assert.equal(requestBody.stream, true);
    assert.deepEqual(requestBody.modalities, ["text"]);
    assert.match(requestBody.messages[0].content[1].text, /音频和画面/);
    assert.match(requestBody.messages[0].content[1].text, /按主题组织的详细文章笔记/);
    const data = await response.json();
    assert.equal(data.analysis.title, "Qwen 视频测试");
    assert.equal(data.analysis.article.sections[0].title, "开场");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("multimodal off refuses image analysis before any model call", async () => {
  const worker = await loadWorker("frames-disabled");
  const response = await worker.fetch(new Request("http://localhost/api/video/frames", {
    method:"POST", headers:{"content-type":"application/json"},
    body:JSON.stringify({config:{provider:"deepseek",multimodal:false},frames:[]}),
  }),{},execution);
  assert.equal(response.status,400);
  assert.match((await response.json()).error,/多模态已关闭/);
});

test("custom frame intervals preserve timestamped evidence and reject invalid values", async () => {
  const worker = await loadWorker("frames-interval");
  const originalFetch=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify({segments:[{seconds:0,text:"first"},{seconds:12,text:"second"},{seconds:25,text:"out of range"}]})}}]});};
  try {
    const payload={config:{provider:"deepseek",endpoint:"https://api.deepseek.com/chat/completions",apiKey:"test",model:"deepseek-flash",multimodal:true},frames:[{seconds:0,image:"data:image/png;base64,AAAA"},{seconds:10,image:"data:image/png;base64,AAAA"}],intervalSeconds:10,endSeconds:20};
    const send=body=>worker.fetch(new Request("http://localhost/api/video/frames",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),{},execution);
    const response=await send(payload);
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).segments.map(s=>s.seconds),[0,12]);
    assert.equal((await send({...payload,intervalSeconds:0})).status,400);
    assert.equal((await send({...payload,intervalSeconds:61})).status,400);
    assert.equal(calls,1);
  } finally {globalThis.fetch=originalFetch;}
});

test("GLM 5.3 Flash keeps mandatory thinking and parses streaming answers",async()=>{
  const worker=await loadWorker("glm-thinking");
  const originalFetch=globalThis.fetch;
  const requests=[];
  globalThis.fetch=async(_url,init)=>{
    const payload=JSON.parse(init.body);requests.push(payload);
    return new Response('data: '+JSON.stringify({choices:[{delta:{reasoning_content:"hidden reasoning"}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{content:"连接正常"}}]})+'\n\ndata: [DONE]\n\n',{headers:{"content-type":"text/event-stream"}});
  };
  try {
    const response=await worker.fetch(new Request("http://localhost/api/debug",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({provider:"glm",endpoint:"https://open.bigmodel.cn/api/paas/v4/chat/completions",apiKey:"test",model:"glm-5.3-flash",multimodal:false,prompt:"ping"})}),{},execution);
    assert.equal(response.status,200);
    assert.equal(requests.length,1);
    assert.equal(requests[0].thinking.type,"enabled");
    assert.ok(requests[0].max_tokens>=8192);
    assert.equal(typeof requests[0].messages[0].content,"string");
    assert.doesNotMatch((await response.json()).content,/hidden reasoning/);
  } finally {globalThis.fetch=originalFetch;}
});

test("video init rejects HTML content and sizes above 2GB",async()=>{
  const worker=await loadWorker("upload-validation");
  const send=body=>worker.fetch(new Request("http://localhost/api/upload/init",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),{},execution);
  assert.equal((await send({name:"a.html",type:"text/html",size:200})).status,400);
  assert.equal((await send({name:"a.mp4",type:"video/mp4",size:2*1024**3+1})).status,413);
});

test("Gemini incomplete output is not reported as a completed video",async()=>{
  const worker=await loadWorker("gemini-incomplete");
  const originalFetch=globalThis.fetch;
  let requestBody;
  globalThis.fetch=async(_url,init)=>{requestBody=JSON.parse(init.body);return Response.json({status:"incomplete",steps:[]});};
  try {
    const response=await worker.fetch(new Request("http://localhost/api/video/gemini/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({source:"file",file:{uri:"https://generativelanguage.googleapis.com/v1beta/files/test-video-123"},apiKey:"test",subtitles:"[00:01] supplied evidence"})}),{},execution);
    assert.equal(response.status,502);
    assert.match((await response.json()).error,/未完成全部分析/);
    assert.equal(requestBody.input[0].uri,"https://generativelanguage.googleapis.com/v1beta/files/test-video-123");
    assert.match(requestBody.input[1].text,/supplied evidence/);
  } finally {globalThis.fetch=originalFetch;}
});

test("legacy YouTube requests are rejected before any upstream call",async()=>{
  const worker=await loadWorker("gemini-youtube-rejected");
  const originalFetch=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({status:"completed",steps:[]});};
  const send=body=>worker.fetch(new Request("http://localhost/api/video/gemini/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),{},execution);
  try {
    for (const body of [
      {source:"youtube",url:"https://youtube.com/watch?v=test",apiKey:"test"},
      {source:"youtube",url:"https://youtu.be/test",apiKey:"test"},
      {source:"file",url:"https://www.youtube.com/watch?v=test",file:{uri:"https://generativelanguage.googleapis.com/v1beta/files/x"},apiKey:"test"},
      {source:"file",file:{uri:"https://youtube.com/watch?v=test"},apiKey:"test"},
    ]) {
      const response=await send(body);
      assert.equal(response.status,410);
      assert.match((await response.json()).error,/YouTube 分析已下线/);
    }
    assert.equal(calls,0);
  } finally {globalThis.fetch=originalFetch;}
});

test("analysis route merges same-topic evidence into structured article sections", async () => {
  const worker = await loadWorker("analysis");
  const originalFetch = globalThis.fetch;
  const stagePrompts = [];
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    const user = payload.messages.at(-1).content;
    stagePrompts.push(user);
    if (user.includes("提取全部有信息量的证据条目")) {
      const content = JSON.stringify({ evidence: [
        { time: "00:00", text: "观点甲首次出现，关键数据 42%" },
        { time: "01:02", text: "观点甲跨时间再次出现，补充条件 X" },
        { text: "没有时间标记的补充证据" },
      ] });
      return Response.json({ choices: [{ message: { content } }] });
    }
    if (user.includes("归并为若干主题")) {
      const content = JSON.stringify({ topics: [
        { title: "观点甲主题", gist: "同一观点跨时间合并", evidenceIds: ["e0", "e1"] },
      ] });
      return Response.json({ choices: [{ message: { content } }] });
    }
    if (user.includes("撰写一个文章章节")) {
      const title = (user.match(/主题 \d+：(.+?)(?:（|\n)/) || [])[1] || "章节";
      const content = JSON.stringify({ sections: [
        { title, gist: "概要", points: [{ label: "具体标签", text: "详细解释", children: [{ label: "子标签", text: "子解释" }] }] },
      ] });
      return Response.json({ choices: [{ message: { content } }] });
    }
    if (user.includes("生成整篇笔记的总括")) {
      const content = JSON.stringify({
        title: "测试文章标题", oneLineSummary: "一句话", finalSummary: "总结", keywords: ["测试"],
        conclusion: { paragraphs: ["第一段", "第二段"], points: [{ label: "结论一", text: "内容一" }] },
      });
      return Response.json({ choices: [{ message: { content } }] });
    }
    throw new Error(`Unexpected prompt: ${user.slice(0, 80)}`);
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        config: { provider: "deepseek", endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-chat", apiKey: "test" },
        metadata: { title: "测试" },
        transcript: [{ time: "00:00", text: "第一条" }, { time: "01:02", text: "第二条" }],
      }),
    }), {}, execution);
    assert.equal(response.status, 200);
    const data = await response.json();
    const analysis = data.analysis;
    // Four stages: 1 evidence extraction + 1 topic merge + 2 section writings + 1 assembly.
    assert.equal(stagePrompts.length, 5);
    // Same topic across time is merged into one section with real evidence refs.
    assert.equal(analysis.article.sections.length, 2);
    const merged = analysis.article.sections[0];
    assert.equal(merged.title, "观点甲主题");
    assert.deepEqual(merged.evidenceRefs, ["e0", "e1"]);
    assert.equal(merged.startSeconds, 0);
    // Uncovered evidence lands in a fallback topic instead of being dropped.
    const fallback = analysis.article.sections[1];
    assert.equal(fallback.title, "其他要点");
    assert.deepEqual(fallback.evidenceRefs, ["e2"]);
    assert.equal(fallback.startSeconds, undefined);
    // Evidence without a time never becomes a fabricated timecode.
    assert.equal(analysis.chapters[1].time, "");
    assert.equal(analysis.chapters[1].seconds, undefined);
    // finalSummary matches the article conclusion.
    assert.equal(analysis.finalSummary, "第一段\n\n第二段");
    assert.equal(analysis.title, "测试文章标题");
    assert.equal(analysis.transcript.length, 2);
    // Section writing is fed only the evidence of its own topic.
    const sectionPrompts = stagePrompts.filter((prompt) => prompt.includes("撰写一个文章章节"));
    assert.equal(sectionPrompts.length, 2);
    assert.match(sectionPrompts[0], /观点甲首次出现/);
    assert.match(sectionPrompts[0], /观点甲跨时间再次出现/);
    assert.doesNotMatch(sectionPrompts[0], /没有时间标记的补充证据/);
    assert.match(sectionPrompts[1], /没有时间标记的补充证据/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("analyze draft branch restructures into the article format", async () => {
  const worker = await loadWorker("analysis-draft");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    assert.match(payload.messages[0].content, /文章笔记/);
    const content = JSON.stringify({
      title: "重组标题", duration: "01:00", sourceLabel: "草稿", oneLineSummary: "一句话", finalSummary: "总结", keywords: ["k"],
      article: { version: 1, title: "重组标题", sections: [{ title: "主题", points: [{ label: "标签", text: "解释" }] }], conclusion: { paragraphs: ["总结段"] } },
      transcript: [{ time: "00:00", text: "草稿转写" }],
      mindmap: { label: "重组标题", children: [{ label: "主题" }] },
    });
    return Response.json({ choices: [{ message: { content } }] });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        config: { provider: "deepseek", endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-chat", apiKey: "test" },
        draft: { title: "旧草稿", chapters: [{ time: "00:00", tag: "a", title: "旧章节", intro: "i", points: ["p"] }], transcript: [{ time: "00:00", text: "草稿转写" }] },
      }),
    }), {}, execution);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.analysis.article.sections.length, 1);
    assert.equal(data.analysis.finalSummary, "总结段");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
