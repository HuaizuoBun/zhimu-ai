# P3 报告：本地后端、存储与文章分析流程

日期：2026-09-18 · 执行范围：P3（video-store 抽象、本地视频存储、debug/frames/analyze/ask 与六个 upload 接口接入桌面服务）

## 阶段与范围

- 提取平台无关的 `VideoBucket` 契约：R2 绑定改为 worker 入口请求期注册，路由模块不再导入 `cloudflare:workers`（原 `app/api/_lib/r2.ts` 删除）。
- 实现本地视频存储：分片上传、流式合并、Range 读取、限额、取消与启动清理。
- 桌面服务接入 debug、analyze、ask、video/frames 与 upload init/part/complete/abort/delete/media 全部 10 个业务接口；B 站与 Gemini/通义上传分析仍按计划返回 501（P4）。
- 写接口增加同源 Origin 与 application/json 内容类型校验（分片 PUT 例外）。

## 环境与版本

同 P2：Windows 11 AMD64 · 开发 Node v24.19.0 · Electron 44.4.2（内置 Node 24.21.0）。

## 已实现（改动文件及用途）

| 文件 | 用途 |
| --- | --- |
| `app/api/_lib/video-store.ts` | 新增：VideoBucket/MultipartUpload/StoredVideo 契约与注入注册表（纯平台无关） |
| `app/api/_lib/r2.ts` | 删除：R2 注册移至 `worker/index.ts` 请求期（env 参数保证可用），9 个路由全部改从 video-store 导入 |
| `worker/index.ts` | Worker 入口首次 fetch 时注册 `env.VIDEO_BUCKET`（幂等） |
| `desktop/storage/local-video-store.ts` | 本地存储：8MiB 分片上限、2GiB 累计/单文件上限（按实际字节计数，不信任声明值）、分片 SHA-256 etag 校验、流式顺序合并 + 原子替换、key/uploadId 格式校验（防路径逃逸、uploadId 绑定 key）、启动清理（遗留分片任务全清、超过 24h 的完成对象清除，Windows 文件占用用重试容忍） |
| `desktop/server/routes.ts` | 接入 10 个业务接口（薄包装复用原 Request→Response 处理函数）；写接口同源 + JSON 校验；onError 将 UpstreamError 映射为原状态码 |
| `desktop/server/index.ts` | 启动时创建 LocalVideoStore、执行清理并注入 |
| `desktop/test-exports.ts`、`desktop/scripts/build-test.mjs` | 测试专用 ESM 打包入口（Node 直连加载 TS 图需要显式扩展名，改为打包导入；测试束不进入应用包） |
| `desktop/scripts/memory-check.mjs` | 可复现的内存观察脚本（合成大文件流式上传 + 采样） |
| `tests/desktop-storage.test.mjs` | 新增 7 项测试（见下） |
| `tests/desktop-server.test.mjs` | 增补 415/403 写方法校验断言；501 断言改用尚未迁移的 bilibili 接口 |

## Range 与存储语义（实现与测试一致）

- `bytes=start-end` / `bytes=start-` / `bytes=-suffix` → 206 + Content-Range + Content-Length；end 超界收敛；suffix 大于文件收敛为全文件；start≥size 或 suffix=0 → 416；多段 Range 返回完整 200（文档化选择）；畸形 Range 头忽略（200）。
- 分片：编号 1–256；重复提交覆盖；缺片/编号不连续 → 400（列出缺失编号）；etag 不一致 → 409；合并后字节数与记录不一致 → 500；合并用流式追加 + 原子改名，未整段读入内存。

## 实际运行命令与结果

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm.cmd run desktop:test` | 0 | **7 项测试全部通过** |
| `npm.cmd test`（网页） | 0 | vinext 构建 + 19 项测试全部通过（r2 重构未破坏 worker 路径） |
| `node typescript tsc --noEmit` | 0 | 无类型错误 |
| `npm.cmd run lint` | 0 | 0 错误（2 个既有警告） |
| `node desktop/scripts/memory-check.mjs 256` | 0 | 见下节 |
| `electron-builder --dir`（输出 desktop/release-p3） | 0 | 打包成功；启动验证：窗口就绪、随机端口 18989、`/api/upload/init` 无凭据 403（路由已迁移而非 501）、退出后进程 0 残留 |

自动测试明细（desktop 7 项）：会话/Host/Origin/写方法校验（更新）、本地存储字节级合并与全 Range 语义、分片校验/etag/限额/取消/路径逃逸、启动清理、HTTP 全流程（init→parts→complete→206/416→delete→404、abort、415、403、501）、ask 问答上下文含文章要点与原始证据、analyze 四阶段文章流程。

## 内存观察（可复现：`node desktop/scripts/memory-check.mjs 256`）

| 指标 | 值 |
| --- | --- |
| 载荷 | 256 MB 合成文件，32 个 8 MiB 分片，1326 ms 完成 |
| 基线 RSS / heap | 59.8 MB / 12.5 MB |
| 峰值 RSS / heap | 97.8 MB / 10.9 MB |
| 结束 RSS / heap | 67.2 MB / 10.1 MB |
| 结论 | 峰值 RSS 仅比基线高约 38 MB（载荷的 15%），heap 恒定约 10 MB——分片上传/合并均为流式，未把视频整段读入内存 |

2 GiB 上限：未做接近 2 GiB 的实测（已测最大 256 MB，如实记录）；上限逻辑通过可配置限额（构造器注入小限额）在单元测试中验证——分片超限 413、累计超限 413、put 实际字节超限 413。

## 受控模拟上游说明

按方案 4.3，模拟上游通过测试内替换 `globalThis.fetch` 注入（与既有 api-pipeline 测试同一模式），未放宽任何正式地址校验，测试 transport 不进入正式运行路径。桌面测试中的 analyze/ask 流程即"受控模拟上游走完整流程"：真实 Hono 服务 + 真实本地存储 + 真实 HTTP 分片上传 + 模拟模型上游。界面层为 P2 已验证的同一 React 代码。

## 未通过 / 未测试内容及原因

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 真实模型端到端（真实视频 + SRT → 文章） | 未测 | 无真实 API Key；按方案由用户填 Key 后验收，未测服务商单独标记 |
| 接近 2 GiB 的实际上传 | 未测 | 已测 256 MB；上限逻辑经注入小限额验证 |
| `desktop/release/win-unpacked` 目录被系统句柄锁定 | 外部限制 | 旧输出目录无法删除（无对应进程，疑似杀软/索引句柄）；本轮改用 `--config.directories.output=desktop/release-p3` 输出并验证，旧目录待锁释放后清理 |
| B 站 / Gemini / 通义上传分析 | 未迁移（按计划） | P4 范围，当前返回 501 |

## 相对方案的偏离与依据

1. R2 注册从"路由副作用导入"改为 worker 入口请求期注册——副作用导入会使桌面 bundle 携带 `cloudflare:workers` 导入（方案明令禁止）；请求期注册同样保证绑定可用。桌面服务 bundle 经检查无任何 `cloudflare:workers` 引用（仅依赖文档注释含 "Cloudflare" 字样，非导入）。
2. 测试通过 esbuild 打包的 `desktop/dist/test/wires.mjs` 导入桌面服务——Node 类型剥离要求导入图显式扩展名，直接导入 TS 源不可行；测试束不进入应用包。

## 下一阶段（P4）

B 站字幕/视频导入、Gemini 本地文件上传/状态/分析、通义上传/分析接入桌面；流式转发（Node fetch duplex）、取消传播与模拟上游协议测试。
