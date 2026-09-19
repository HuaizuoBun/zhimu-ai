export type VideoFrame = { seconds: number; image: string };

function mediaReady(video: HTMLVideoElement, event: string) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("读取视频画面超时，请换用 MP4 / WebM 文件")), 30000);
    const ready = () => finish();
    const failed = () => finish(new Error("浏览器无法解码此视频，请转为 MP4 / WebM，或选择 Gemini / 阿里音画模型"));
    function finish(error?: Error) {
      clearTimeout(timeout);
      video.removeEventListener(event, ready);
      video.removeEventListener("error", failed);
      if (error) reject(error); else resolve();
    }
    video.addEventListener(event, ready, { once: true });
    video.addEventListener("error", failed, { once: true });
  });
}

// Decode locally and send bounded batches; never buffer a 2GB video on the server.
export async function* videoFrameBatches(input: File | string, intervalSeconds = 5) {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0.5 || intervalSeconds > 60) throw new Error("识屏间隔需要在 0.5–60 秒之间");
  const ownedUrl = typeof input !== "string" ? URL.createObjectURL(input) : null;
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  const canvas = document.createElement("canvas");
  try {
    const loaded = mediaReady(video, "loadeddata");
    video.src = ownedUrl || input as string;
    await loaded;
    // Some browser recordings omit WebM duration metadata. Seeking to the end
    // lets the decoder determine the duration without buffering the file in JS.
    if (video.duration === Infinity) {
      const seeked = mediaReady(video, "seeked");
      video.currentTime = 1e10;
      await seeked;
    }
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取视频时长");
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持画面提取");
    let frames: VideoFrame[] = [];
    const times = Array.from({ length: Math.ceil(duration / intervalSeconds) }, (_, i) => i * intervalSeconds);
    if (duration - times.at(-1)! > 1) times.push(Math.max(0, duration - 0.1));
    for (const seconds of times) {
      if (Math.abs(video.currentTime - seconds) > 0.01) {
        const seeked = mediaReady(video, "seeked");
        video.currentTime = seconds;
        await seeked;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push({ seconds, image: canvas.toDataURL("image/jpeg", 0.82) });
      if (frames.length === 16 || seconds === times.at(-1)) {
        yield { frames, duration, endSeconds: Math.min(duration, seconds + intervalSeconds), progress: Math.min(100, Math.round((seconds + intervalSeconds) / duration * 100)) };
        frames = [];
      }
    }
  } finally {
    video.removeAttribute("src");
    video.load();
    if (ownedUrl) URL.revokeObjectURL(ownedUrl);
  }
}
