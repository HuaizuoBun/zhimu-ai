# P1 产品修改报告：删除 YouTube 分析 · 文章笔记改造

日期：2026-09-18 · 执行范围：P1（在现有网页代码中完成两项产品修改；桌面化 P2 起未开始）

## 阶段与范围

- 修改一：完整删除 YouTube 分析（入口、请求分支、帮助文案、页面元数据、后端 YouTube 路径），保留 B 站、本地视频、SRT/VTT 字幕、Gemini 本地文件音画分析、通义原生音画、问答与思维导图。
- 修改二：视频总结改为附件风格的详细结构化文章笔记（来源 → 标题 → 可点击目录 → 编号主题章节 → 粗体要点及分级解释/数据/案例 → AI 总结），同步修改提示词、生成流程、共享数据结构、结果页面，新增默认文章视图与 Markdown 复制/导出。

## 基线版本 / 当前分支 / 提交

- 分支：`desktop-migration`（本地仓库，基线根提交 `b3c6046`）
- 提交序列：
  - `b3c6046` 基线（交接包源码，对应导出提交 2d861e3）
  - `ec3b658` 修改一：删除 YouTube 分析
  - `93f9a3c` 修改二：文章笔记生成流程、共享结构、界面与导出
  - `3e41f4f` 首页文案更新 + P1 证据产物（截图、导出样例）

## 环境

| 项目 | 值 |
| --- | --- |
| Windows | 10.0.26200（Windows 11），AMD64 |
| Node.js | v24.19.0 |
| npm | 11.17.0 |
| Electron | 未安装（P2 范围） |

## 修改一完成情况：删除 YouTube 分析

| 位置 | 处理 | 状态 |
| --- | --- | --- |
| `app/page.tsx` | sources 数组删除 youtube 项；startAnalysis 删除 `source === "youtube"` 全部分支与"当前服务商不能直接打开 YouTube"提示；URL 校验仅保留 B 站（bilibili.com / b23.tv）；输入区 label、placeholder、source-hint 全部改为 B 站文案 | 通过 |
| `app/lib/providers.ts` | Gemini capability `声音 + 画面 · YouTube` → `声音 + 画面`；help 删除"可直接分析公开 YouTube 链接"，改为"支持本地视频文件的直接音画理解" | 通过 |
| `app/layout.tsx` | description 更新为"支持 B 站与 2GB 本地视频的 AI 详细文章笔记、时间轴、知识问答和思维导图" | 通过 |
| `app/api/video/gemini/analyze/route.ts` | 删除 youtubeUrl() 与 youtube 分支；请求入口显式拒绝 `source: "youtube"`、url 字段及 file.uri 中伪装的 YouTube URL（HTTP 410，中文错误信息），且不调用上游；保留 `source: "file"` 本地文件路径与 upload/status/analyze 三接口 | 通过 |
| `tests/rendered-html.test.mjs` | 断言改为：Bilibili、本地视频、2GB 存在；`/youtube\|youtu\.be/i` 不出现在渲染 HTML | 通过 |
| `tests/api-pipeline.test.mjs` | "Gemini 未完成"测试改用合法 file 请求（generativelanguage.googleapis.com 文件 URI）；新增"旧 YouTube 请求在任何上游调用前被拒绝"回归（4 种伪装形态 × 410 + 上游调用数为 0） | 通过 |
| 内部测试说明 | 现行能力说明更新为"Gemini 原生音画（本地文件）"；历史记录注明 2026-09-17 曾接入 YouTube、2026-09-18 按产品决定删除 | 通过 |
| `app/globals.css` | 来源标签栅格 3 列 → 2 列 | 通过 |

- 验收核对：首页只剩 Bilibili 与本地视频两个入口（见截图）；接口仍为 17 个路径（Gemini analyze 继续服务本地文件）；B 站 URL 校验、本地视频、字幕、抽帧链路保留。
- 方案文档与拒绝旧请求的测试按方案 5.1 允许保留"YouTube"字样，未做全仓零匹配删除。

## 修改二完成情况：附件风格详细文章笔记

### 生成逻辑（`app/api/analyze/route.ts` + `app/api/_lib/analysis.ts`）

四阶段流程，替换原"分块抽章节 → 合并"两段式：

1. **证据抽取**（每字幕块）：只提取带时间的证据条目（数据、单位、条件、因果、案例），不写文章、不写总结；程序为每条证据分配 `e0…` id。
2. **主题归并**（一次调用）：把证据按主题聚类——同一主题即使时间相隔很远也归入同一主题并去重；返回主题标题、概要与证据 id。程序校验 id 真实性；未被任何主题覆盖的证据进入"其他要点"兜底主题，保证信息不丢失。
3. **分章撰写**（每主题一次调用，2 个并行）：仅喂给该章自己的证据，避免每章重复全片背景；输出层级要点（label + text + children 嵌套）与可选小节。
4. **组装**（一次调用）：标题、一句话总结、AI 总结段落与关键结论；目录、章节编号、来源行、章节 id、时间点全部由程序生成。

- 原生视频路径（Gemini 本地文件、Qwen Omni）与 draft 分支同样输出 article 结构：`VIDEO_ANALYSIS_PROMPT` 重写为按主题组织的文章规则（含归因要求"讲者认为/视频主张/视频举例"、时间仅限真实证据、章节数服从信息量），`ANALYSIS_SCHEMA` 新增 article 子模式并列为必填，draft 分支系统提示词同步重构。
- 截断处理：`chatCompletion` 对 `finish_reason: length` 显式抛错"模型输出被截断"；分章数量不足主题数时抛"文章章节生成不完整（N/M）"；article 缺失或章节/总结为空时按生成错误处理（`requireArticle`）。即达到限额时报错而非把截断内容当完整文章。

### 数据结构（`app/lib/article.ts`，前后端共享）

- `ArticlePoint { label, text, children?, evidenceRefs? }`、`ArticleSection { id, title, startSeconds?, gist?, points, subsections?, evidenceRefs? }`、`StructuredArticle { version: 1, title, sections, conclusion { paragraphs, points? } }`（在方案建议的最小结构上增加 `gist` 章节概要与章节级 `evidenceRefs`）。
- `AnalysisResult` 新增可选 `article` 字段；生成路径强制存在，旧演示/旧结果兼容（无 article 时文章标签页显示"旧格式，请重新分析"）。
- 证据引用：/api/analyze 路径的章节 `evidenceRefs` 由程序从主题-证据映射写入，指向真实证据 id；原生路径的要点 `evidenceRefs`（"tN" transcript 下标）经校验后保留、伪造引用被丢弃。
- `normalizeAnalysis` 修正：删除 `index * 60` 假时间、`"知识点 N"`/`"视频在这里提出了一个关键知识点。"` 占位文案行为——时间无效即为空、`seconds` 为 undefined，时间轴显示 `--:--` 且不提供跳转；`finalSummary` 在 article 存在时恒等于 conclusion 段落（`paragraphs.join("\n\n")`），杜绝两份矛盾结论；chapters 与 mindmap 在模型未提供时从 article 派生（时间轴/导图与文章同源）。

### 界面与导出（`app/page.tsx` + `app/globals.css`）

- 结果页新增"✎ 文章笔记"标签并设为分析完成后的默认视图（旧格式结果自动回退时间轴）；保留时间轴、思维导图、字幕视图。
- 文章视图实际渲染：来源行（B 站链接 / 本地文件名 / 演示标注，本地来源不显示磁盘路径）、标题、可点击目录、编号章节标题（有真实时间才显示 `[MM:SS]` 芳点按钮，可定位播放位置）、粗体要点与嵌套子要点、三级小节、AI 总结卡片与编号关键结论。文章为自定义 React 渲染，不执行任何原始 HTML；来源链接仅接受 http(s) 协议、目录链接仅为页内锚点。
- "⧉ 复制 Markdown"与"↓ 导出 .md"与屏幕文章共用同一 `buildArticleMarkdown()` 生成函数：标题文本、编号、锚点 slug（中文保留、标点去除、空格转连字符、重复加后缀）完全一致，预览与导出不会不同步；导出文件名经 Windows 非法字符清洗（`articleFileName`）。顶部"↓ 导出笔记"按钮同步接线。
- B 站来源链接取自用户输入的 URL 元数据；本地来源只显示文件名；新分析成功后替换整个结果对象，不沿用上一条结果的文章。
- 问答（`app/api/ask/route.ts`）上下文新增 article 全部要点（label：text，上限 120 条）与 conclusion，继续保留 chapters 与 transcript 原始证据。

### 关键生成规则（集中在 `ARTICLE_RULES`，全部提示词共用）

1. 按主题组织，跨时间合并去重，不按时间逐段复述；2. 详细保真（数据、单位、前提、因果、对比、专名、案例），去寒暄复读；3. 要点 label 必须具体（如"招聘看重实习与产出"），禁止空泛标题；4. 归因准确（讲者认为/视频主张/视频举例）；5. 时间仅限真实证据，严禁编造推算；6. 章节数与每章条数服从信息量，不迎合格式编造内容。

## 实际运行命令与结果

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm.cmd test`（vinext build + node --test 三个测试文件） | 0 | 生产构建成功；**19 项测试全部通过**（pass 19 / fail 0） |
| `node node_modules/typescript/bin/tsc --noEmit` | 0 | 无类型错误 |
| `node node_modules/eslint/bin/eslint.js app tests db` | 0 | 无 lint 错误 |
| `npm.cmd run build` + `npm.cmd run start` | 0 | 生产服务器在 localhost:3000 运行，浏览器实测通过 |

自动测试明细（19 项）：DeepSeek 401 文案、B 站字幕转时间轴、B 站风控 HTML、B 站无字幕分支、Qwen SSE（新增 article 断言与提示词断言）、多模态关闭拒绝、抽帧间隔边界、GLM 强制思考流式、上传 init 校验、Gemini 未完成（改用 file 请求）、**旧 YouTube 请求拒绝（新增）**、**analyze 四阶段主题归并（重写：同主题合并、证据引用、无假时间、finalSummary 一致、分章只喂本章证据）**、**draft 分支输出 article（新增）**、**锚点 slug（新增）**、**标题时间标记（新增）**、**Markdown 目录锚一致（新增）**、**来源行与文件名（新增）**、首页渲染（改为断言无 YouTube）、社交元数据。

人工/浏览器测试：Chrome 无头模式（1920×1080）实测首页两来源 → 知识库默认文章视图 → 导出 .md → 时间轴视图，无控制台错误，导出提示与文件均确认。

## 证据产物

| 产物 | 路径 |
| --- | --- |
| 首页截图（仅 Bilibili + 本地视频，无 YouTube） | `docs/desktop/screenshot-home.png` |
| 文章笔记默认视图截图（目录/章节/要点/AI 总结） | `docs/desktop/screenshot-article.png` |
| 时间轴视图截图 | `docs/desktop/screenshot-timeline.png` |
| 实际导出的 Markdown（浏览器点击"导出 .md"得到，3201 字节） | `docs/desktop/P1-exported-article.md` |

导出样例结构核对：来源行 → `# 标题` → `## 目录`（6 章带时间 + AI 总结，锚点与标题 slug 一致）→ `## 1..6` 编号章节（`[00:00]` 等真实时间标记）→ 粗体要点与嵌套子要点 → `### 反馈转化为规则` 三级小节 → `## AI 总结` 段落 + `**关键结论：**` 编号列表。该文件为演示数据（源行已标注"演示分析（示例数据，非真实视频分析）"），不代表真实模型生成质量。

## 修改文件清单

| 文件 | 用途 |
| --- | --- |
| `app/lib/article.ts` | **新增**：前后端共享的文章类型、锚点 slug、标题/编号、Markdown 生成、Windows 文件名清洗 |
| `app/api/_lib/analysis.ts` | 重写：article 归一化、ANALYSIS_SCHEMA 扩展、共享 ARTICLE_RULES 与四阶段提示词、VIDEO_ANALYSIS_PROMPT 文章化、假时间/占位修正、chapters/mindmap 从 article 派生 |
| `app/api/analyze/route.ts` | 重写：四阶段生成流程（证据→主题→分章→组装）、程序生成 id/时间/证据引用、draft 分支重构 |
| `app/api/video/gemini/analyze/route.ts` | 删除 YouTube 分支、显式拒绝旧请求（410 无上游调用）、requireArticle |
| `app/api/video/qwen/analyze/route.ts` | requireArticle（提示词经共享 VIDEO_ANALYSIS_PROMPT 自动更新） |
| `app/api/ask/route.ts` | 问答上下文加入文章要点与结论 |
| `app/page.tsx` | 删除 YouTube 入口/分支/文案；新增文章笔记默认视图、复制/导出、演示文章、来源跟踪；时间轴/字幕无时间适配 |
| `app/globals.css` | 来源栅格 2 列；文章视图全套样式 |
| `app/layout.tsx` | 元数据描述更新（无 YouTube、突出文章笔记） |
| `app/lib/providers.ts` | Gemini capability/help 去 YouTube |
| `tests/api-pipeline.test.mjs` | Gemini 未完成测试改 file 请求；新增 YouTube 拒绝回归；analyze 测试重写为四阶段验证；新增 draft 测试 |
| `tests/rendered-html.test.mjs` | 断言无 YouTube、两来源存在 |
| `tests/article-markdown.test.mjs` | **新增**：锚点/标题/Markdown 导出/来源行/文件名 |
| `package.json` | test 脚本纳入新测试文件 |
| 内部测试说明 | 现行能力说明更新 + 历史记录标注（本地保留） |
| `docs/desktop/P0-audit.md`、`docs/desktop/P1-product-report.md` | 阶段报告 |

## 真实接口调用

- **无任何真实模型 API 调用**（无真实 API Key）。所有模型交互均为测试内模拟上游（mock fetch 返回构造 JSON/SSE）。
- **真实生成质量尚未验证**：四阶段流程、主题归并质量、要点标签具体度、时间点真实性、原生视频路径（Gemini 文件 / Qwen Omni）的实际输出，均需用户在界面填写真实 Key 后用真实视频验收。模拟测试仅证明契约、流程与结构正确。

## 未通过 / 未测试内容及原因

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 真实模型端到端生成 | 未测 | 无真实 API Key（按方案由用户后续在界面填写测试） |
| 真实 B 站视频导入 → 文章全链路 | 未测 | 依赖上一项；B 站接口本身沿用原有实现并有既有测试 |
| 长视频达到模型输出限额后的续写 | 部分实现 | 采用方案允许的"明确报错"分支（截断即报错、章节不完整即报错）；"自动继续生成缺失章节"未实现，如评审要求可下轮补充 |
| 桌面化（Electron 等） | 未开始 | 属 P2–P5 范围，本轮按方案止步 P1 |

## 相对方案的偏离与依据

1. `ArticleSection` 增加了 `gist`（章节概要）与章节级 `evidenceRefs` 字段——方案说明其为"建议最小结构"；gist 用于时间轴 intro 与组装阶段，章节级证据引用用于跨时间合并后保存证据位置。
2. 导图与时间轴在模型未单独提供时由程序从 article 派生（而非额外模型调用）——保证三视图与文章同源一致，减少输出限额压力。
3. 章节标题时间点取该主题全部证据中最早的真实时间——"有证据才显示"原则的程序化实现。

## 下一阶段（P2 起，待评审后执行）

Electron 桌面骨架、本地 Node/Hono 服务与静态资源、就绪握手与会话校验、单实例与退出清理、win-unpacked 首次打包验证；P1 的文章生成逻辑将原样复用。
