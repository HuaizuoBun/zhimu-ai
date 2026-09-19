# P0 基线审计报告

日期：2026-09-18 · 执行范围：P0（确认本地基线，不含产品修改）

## 阶段与范围

- 确认项目根目录、Windows 版本与架构、Node/npm/Git 状态。
- 核对开发方案（1.1 版）中列出的文件与接口。
- 读取依赖配置，运行生产构建与原有自动测试，记录实际结果。

## 基线版本 / 当前分支 / 提交

- 源码来源：上游交接包（标注源自提交 `2d861e339fda2859c44e490ee51a74b1a466aa52`）。
- ZIP 内不含 Git 仓库，按方案在本地新建仓库并提交基线：`b3c6046`（master 根提交），随后创建并切换到 `desktop-migration` 分支工作。
- 仓库本地身份为 `TRAE <trae-agent@local>`（仅仓库级配置，未改动全局 Git 配置）。
- 本地代码与方案 1.1 版描述的源码事实一致，未发现差异。

## 环境基线

| 项目 | 结果 |
| --- | --- |
| Windows | Microsoft Windows NT 10.0.26200（Windows 11），AMD64 |
| Node.js | v24.19.0（P0 期间由 winget 安装；初始环境未安装） |
| npm | 11.17.0 |
| Git | 2.55.0.windows.3（P0 期间由 winget 安装；初始环境未安装） |
| Electron | 未安装（P2 起引入，本轮不涉及） |

环境备注：本机 PowerShell 执行策略禁止运行脚本，`npm` 需通过 `npm.cmd` 调用；每条命令前需刷新 PATH。npm 11 的 allow-scripts 安全机制默认拦截依赖安装脚本，已显式批准 `sharp`、`workerd`、`esbuild` 后依赖才可构建。

## 文件与接口核对

- `app/page.tsx`（590 行）：含主页、结果页（时间轴/思维导图/字幕三视图）、API 设置页、B 站 / YouTube / 本地视频三种来源及 startAnalysis 分支。与方案一致。
- API 路由共 17 个（`app/api/**/route.ts` 实测计数），与方案表格一致。
- `app/api/_lib/analysis.ts`：`VIDEO_ANALYSIS_PROMPT` 按时间顺序提取章节；`normalizeAnalysis` 存在方案 5.2.C 指出的占位行为：缺时间时以 `index * 60` 补假时间、缺 intro 时填“视频在这里提出了一个关键知识点。”、缺标题时填“知识点 N”。
- `app/lib/providers.ts`：7 个服务商，Gemini capability/help 含 “YouTube” 文案。
- `app/layout.tsx`：description 含 “YouTube”。
- `app/api/video/gemini/analyze/route.ts`：Body 联合类型含 `source: "youtube"` 与 YouTube URL 分支。
- `docs/reference-format/` 两份格式样例存在且可读。
- 全仓含 “YouTube” 字样的现行代码/说明文件：`app/page.tsx`、`app/lib/providers.ts`、`app/layout.tsx`、`app/api/video/gemini/analyze/route.ts`、`tests/rendered-html.test.mjs`、`tests/api-pipeline.test.mjs`、内部测试说明文档（未随公开仓库分发）。

## 实际运行命令与结果

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `winget install OpenJS.NodeJS.LTS`（24.19.0） | 0 | 安装成功 |
| `winget install Git.Git`（2.55.0.3） | 0 | 安装成功 |
| `npm.cmd install --no-audit --no-fund` | 0 | 依赖安装成功（含 allow-scripts 批准步骤） |
| `npm.cmd approve-scripts sharp workerd esbuild` | 0 | 依赖安装脚本批准成功 |
| `npm.cmd test`（= vinext build + node --test 两个测试文件） | 0 | 生产构建成功；13 项测试全部通过（pass 13 / fail 0） |

原有 13 项测试明细：DeepSeek 401 文案、B 站字幕转时间轴、B 站风控 HTML 返回 JSON、B 站无字幕继续视觉分析、Qwen Omni 视频指令、多模态关闭拒绝图像分析、自定义抽帧间隔、GLM thinking 流式解析、上传 init 校验、Gemini 未完成不报成功、analyze 抽取+合并两段流程、渲染首页 HTML、社交元数据。

## 已存在的环境问题（非本轮修改造成）

1. 初始环境无 Node.js / Git，属开发机环境缺口，已通过 winget 安装解决。
2. npm allow-scripts 默认拦截安装脚本，需人工批准（已处理并记录，后续安装新依赖时需注意）。
3. PowerShell 执行策略限制脚本运行（`npm.ps1` 不可用），统一改用 `npm.cmd`，不影响功能。

## 预计修改清单（P1）

1. 删除 YouTube：`app/page.tsx`（sources、startAnalysis 分支、URL 校验、占位与提示文案）、`app/lib/providers.ts`（Gemini capability/help）、`app/layout.tsx`（description）、`app/api/video/gemini/analyze/route.ts`（删除 youtube 分支、显式拒绝 `source: "youtube"` 与 YouTube URL 伪装请求且不调用上游）、`tests/rendered-html.test.mjs`（改为验证入口已删除）、`tests/api-pipeline.test.mjs`（Gemini 未完成测试改用合法 file 请求 + 新增旧请求拒绝回归）、内部测试说明文档（本地保留）。
2. 文章笔记改造：`app/api/_lib/analysis.ts`（新增结构化 `article` 类型、ANALYSIS_SCHEMA、normalizeAnalysis、文章提示词；修正假时间与占位文案行为）、`app/api/analyze/route.ts`（抽取证据 → 主题归并 → 文章组装的生成流程，draft 分支同步）、`app/api/video/gemini/analyze/route.ts`、`app/api/video/qwen/analyze/route.ts`（提示词与 schema 同步）、`app/api/ask/route.ts`（问答上下文加入文章要点）、`app/page.tsx`（结果页新增“文章笔记”默认视图、复制 Markdown、导出 .md）、`app/globals.css`（文章视图样式）、测试（文章结构、锚点、导出一致性、旧结果兼容）。

## 结论

P0 通过：环境就绪、基线构建与 13 项原有测试全部通过、文件与接口与方案 1.1 版一致。进入 P1 产品修改。
