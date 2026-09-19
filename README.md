# 知幕 AI（Zhimu AI）

把长视频变成**按主题组织的详细文章笔记**：来源、可点击目录、编号主题章节、粗体要点与分级解释、数据与案例、AI 总结，并联动时间轴、思维导图、字幕与问答。

- 视频来源：**B 站链接** 与 **本地视频文件**（最大 2GB，支持附加 SRT/VTT 字幕）
- 模型自选：DeepSeek、阿里通义、Gemini、Kimi、字节豆包、智谱 GLM、GPT，任填一个你自己的 API Key
- 输出：屏幕阅读 + 复制 Markdown + 导出 `.md`（预览与导出同一内容）

> 模型调用需要联网并使用你自己的 API Key；Key 只在会话内存中使用，关闭应用即清除，不写入磁盘、日志或文章。

## 普通用户（Windows）

1. 到本仓库 **Releases** 页面下载 `知幕AI-Setup-x.x.x-x64.exe`。
2. 双击安装（按当前用户安装，无需管理员），桌面出现「知幕 AI」快捷方式。
3. 打开应用 → 「API 设置」选择服务商并填入 Key → 回到工作台粘贴 B 站链接或选择本地视频 → 开始分析。

不需要安装 Node.js、Python 或任何开发工具。卸载在 Windows「设置 → 应用」中操作。

详细说明见 [docs/desktop/知幕AI-桌面版-使用说明.md](docs/desktop/知幕AI-桌面版-使用说明.md)。

## 开发者

```bash
npm install            # Node.js >= 22.13（npm 11 需批准依赖安装脚本，见下）
npm run dev            # 网页版开发（vinext / Cloudflare Workers）
npm test               # 网页构建 + 19 项测试
npm run desktop:test   # 桌面服务 12 项测试
npm run desktop:build  # 构建桌面应用（main/preload/server + 渲染层）
npm run desktop:pack   # 打包 win-unpacked 直接运行版
npm run desktop:dist   # 生成 Windows NSIS 安装包
npm run lint           # ESLint
```

结构要点：

- `app/`：原网页应用（React 界面 + 17 个标准 Request/Response API 路由）
- `app/lib/article.ts`：前后端共享的文章笔记结构与 Markdown 生成（预览与导出同源）
- `desktop/`：Electron 桌面版（主进程、utilityProcess 本地 Node/Hono 服务、本地视频存储、构建脚本）
- `worker/index.ts`：Cloudflare Worker 入口（注册 R2 视频存储绑定）
- `docs/desktop/`：各阶段报告、测试证据与用户说明

npm 11 的 allow-scripts 会拦截依赖安装脚本，安装后如构建报错，运行 `npm approve-scripts` 批准 esbuild / electron 等即可。

## 功能与边界

| 能力 | 说明 |
| --- | --- |
| 文章笔记 | 按主题归并（跨时间去重）、保留数据/条件/案例、有真实时间证据才显示时间 |
| 时间轴 / 思维导图 / 字幕 / 问答 | 与文章同源联动；问答结合原始证据与文章要点 |
| 本地视频 | 浏览器内解码抽帧（0.5–60 秒间隔）或流式上传给通义/Gemini 原生音画理解 |
| 安全 | 本地服务仅监听 127.0.0.1 随机端口 + 每启动一次会话凭据；CSP；无 CORS 开放 |

已知限制：真实模型生成质量需自行填 Key 验证；B 站视频可能因权限/风控/多段音轨无法导入；浏览器抽帧要求 Chromium 可解码格式（建议 MP4/H.264、WebM）；无自动更新、账户、云同步。当前仅提供 Windows x64 安装包。

## License

私用与小范围试用项目，未指定开源许可证（如需开源请自行选择并添加 LICENSE）。
