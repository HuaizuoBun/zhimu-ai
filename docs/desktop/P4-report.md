# P4 报告：B 站导入与 Gemini / 通义原生视频

日期：2026-09-18 · 执行范围：P4（B 站字幕与视频导入、Gemini 本地文件上传/状态/分析、通义上传/分析接入桌面服务）

## 阶段与范围

- 桌面服务接入剩余 7 个业务接口：`/api/source/bilibili`、`/api/source/bilibili/video`、`/api/video/gemini/{upload,status,analyze}`、`/api/video/qwen/{upload,analyze}`。至此原 17 个接口全部在桌面服务可用；未知 `/api/*` 路径返回 501。
- 流式请求体适配：Gemini 上传与通义 OSS 上传的 fetch 增加 `duplex: "half"`（Node/undici 对流式 body 的要求；worker 侧忽略该字段），并以变量化 init 对象保持 Cloudflare 类型兼容。
- P1 的 YouTube 拒绝回归在桌面路径同样验证（410、无上游调用）。

## 环境与版本

同 P2/P3：Windows 11 AMD64 · 开发 Node v24.19.0 · Electron 44.4.2（内置 Node 24.21.0，utilityProcess 实测上报）。

## 已实现（改动文件及用途）

| 文件 | 用途 |
| --- | --- |
| `app/api/video/gemini/upload/route.ts` | 流式上传 fetch 增加 `duplex: "half"`（init 变量化，平台类型兼容） |
| `app/api/video/qwen/upload/route.ts` | 同上（multipart 流式上传） |
| `desktop/server/routes.ts` | 注册 7 个 P4 接口；501 仅剩未知路径 |
| `tests/desktop-p4.test.mjs` | 新增 5 项测试（见下） |
| `tests/desktop-server.test.mjs`、`tests/desktop-storage.test.mjs` | 501 断言改用未知路径（bilibili 已迁移） |
| `package.json` | desktop:test 纳入 P4 测试；lint 忽略 release* 输出目录 |

## 实际运行命令与结果

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm.cmd run desktop:test` | 0 | **12 项桌面测试全部通过** |
| `npm.cmd test`（网页） | 0 | 构建 + 19 项测试全部通过 |
| `node typescript tsc --noEmit` | 0 | 无类型错误 |
| `npm.cmd run lint` | 0 | 0 错误（2 个既有警告） |
| `electron-builder --dir`（desktop/release-p4） | 0 | 打包成功；启动验证：窗口就绪、随机端口 20075、`/api/source/bilibili` 无凭据 403（已迁移而非 501）、退出进程 0 残留 |

P4 测试明细（5 项）：B 站字幕导入（view→player→hdslb 全链路模拟，转时间轴）；B 站视频导入落入本地存储且 `/api/upload/media` 字节一致（真实本地存储端到端）；Gemini 上传流式（`duplex === "half"`、content-length 与实际字节一致、上游收到的字节与存储完全一致）；Gemini 状态查询 + file 分析返回 article + YouTube 请求 410；通义上传（aliyuncs 域校验保留、multipart 包含全部字段与精确文件字节、content-length 与实际一致）。

## 来源 × 服务商测试表（桌面路径，模拟上游）

| 路径 | 协议测试（模拟上游） | 真实账号测试 |
| --- | --- | --- |
| B 站字幕导入 → /api/analyze 文章 | 通过 | 未测（无真实 Key；B 站公开接口可达性以用户网络为准） |
| B 站视频导入 → 本地存储 → 媒体读取 | 通过（字节级一致） | 未测（同上；风控/权限场景沿用网页版边界说明） |
| 本地视频 → upload 六接口 → Gemini upload → status → analyze | 通过（含流式/duplex/字节一致） | 未测（无 Gemini Key） |
| 本地视频 → 通义 upload → analyze | 通过（multipart 完整性） | 未测（无百炼 Key） |
| 旧 YouTube 请求 | 通过（410、零上游调用） | — |

## 未通过 / 未测试内容及原因

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 真实 B 站 / Gemini / 通义调用 | 未测 | 无真实账号 Key 与真实视频授权环境；按方案由用户在界面填 Key 验收，未测服务商单独标记。模拟测试验证协议、流式与字节正确性，不宣称真实链路已通过 |
| 取消传播 | 部分 | 服务端各上游请求均有 AbortSignal 超时（30s–20min）；前端无显式取消按钮（沿用原设计），整链路手动取消未实现 |
| `desktop/release/win-unpacked` 旧目录锁定 | 外部限制 | 同 P3；继续用 `--config.directories.output` 指定新目录输出 |

## 相对方案的偏离与依据

1. `duplex: "half"` 以条件类型变量注入而非运行时探测——该选项为 fetch 标准字段，Workers 运行时忽略之，避免了平台分支。
2. B 站视频导入的"远端下载累计字节限制"由本地存储 `put` 的实际字节计数执行（P3 实现），路由原有 size 预检保留。

## 下一阶段（P5）

Windows x64 NSIS 安装包：产品图标、版本信息、安装/卸载实测、SHA-256、用户操作说明；干净环境验收列为用户待办。
