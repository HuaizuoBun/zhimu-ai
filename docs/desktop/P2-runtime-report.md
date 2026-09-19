# P2 运行时报告：桌面骨架与首次打包验证

日期：2026-09-18 · 执行范围：P2（Electron 骨架、本地服务、会话校验、单实例、win-unpacked 打包验证）

## 阶段与范围

- 把 P1 修改后的界面接入 Electron：主进程、专用非持久化会话、utilityProcess 后台本地服务、就绪握手、单实例、正常退出与启动错误提示。
- 独立 Vite 前端构建复用原 `app/page.tsx` 与样式；Node/Hono 本地服务提供静态界面与 `/api/health`；未迁移业务接口返回明确 501 JSON。
- 生成并直接运行 Windows `win-unpacked` 可执行程序，验证资源路径、子进程入口、asar 与运行依赖。网页构建保持可用。

## 基线版本 / 当前分支 / 提交

- 分支 `desktop-migration`；P1 结束于 `9d824a4`，P2 提交见文末。
- 可执行产物：`desktop\release\win-unpacked\知幕 AI.exe`（electron-builder 26.15.3，--dir 模式）。

## 环境与版本

| 项目 | 值 |
| --- | --- |
| Windows | 10.0.26200（Windows 11），AMD64 |
| 开发 Node | v24.19.0 |
| npm | 11.17.0 |
| Electron | 44.4.2（新锁定为 devDependency） |
| Electron 内置 Node | 24.21.0（utilityProcess 实测上报） |
| electron-builder | 26.15.3 |
| Hono / @hono/node-server | 4.x / 1.x（esbuild 完全打包进服务 bundle，不随应用分发 node_modules） |

## 已实现（改动文件及用途）

| 文件 | 用途 |
| --- | --- |
| `desktop/main.ts` | 主进程：单实例锁、专用非持久化 session + HttpOnly/SameSite=Strict 会话 Cookie、utilityProcess.fork 启动服务、父端口就绪握手、CSP、外链交系统浏览器、下载保存对话框、渲染进程异常与启动错误提示、优雅退出（shutdown 消息 + 超时 kill） |
| `desktop/preload.ts` | 极小 preload：仅暴露只读桌面环境信息，无文件/命令/IPC 能力 |
| `desktop/server/index.ts` | 服务入口（utilityProcess 内运行）：127.0.0.1:0 随机端口、随机 64 hex 会话凭据、向父进程回报端口与凭据、shutdown 处理 |
| `desktop/server/routes.ts` | Hono 应用：全请求会话校验（Host 必须为本机地址、带 Origin 必须同源、Cookie 凭据）、`/api/health`、未迁移业务接口 501、静态文件流式服务 + 目录穿越防护 + CSP/nosniff |
| `desktop/renderer/index.html`、`main.tsx`、`desktop.css` | 桌面渲染入口：挂载原 Home 组件与原样式；`@source` 显式覆盖父目录 `app/` 的 Tailwind 4 扫描 |
| `desktop/vite.config.ts` | 桌面前端独立构建配置（与网页 vinext 构建互不影响） |
| `desktop/scripts/build.mjs` | JavaScript 构建流程：esbuild 打包 main/preload/server（CJS，server 完全自包含），Vite 构建渲染层，复制静态资源 |
| `electron-builder.yml` | appId `cn.zhimu.ai.desktop`、productName 知幕 AI、asar + server/renderer 解包、files 仅 `desktop/dist/**`（不分发 node_modules） |
| `package.json` | 新增 `main` 与 `desktop:build/dev/test/pack/dist` 脚本 |
| `tests/desktop-server.test.mjs` | 桌面服务测试：会话/Host/Origin 校验、501、静态 CSP、SPA 回退、穿越防护 |
| `.gitignore` | 排除 desktop/dist、desktop/release |

## 实际运行命令与结果

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm.cmd run desktop:build` | 0 | main/preload/server 打包 + 渲染层构建成功（CSS 45KB 含 Tailwind 工具类，`@source` 生效） |
| `npm.cmd run desktop:test` | 0 | 桌面服务测试通过 |
| `npm.cmd run desktop:pack` | 0 | win-unpacked 打包成功（后续 shell 报退出码 1 系沙箱拦截 builder 写系统 Recent 目录，产物完整） |
| `npm.cmd test`（网页） | 0 | 网页构建与 19 项测试全部通过（桌面化未破坏原路径） |
| `electron .`（开发模式） | — | 服务 9ms 就绪，窗口正常显示，无控制台错误 |

## P2 验收结果

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 打包程序可打开新主页、设置及演示文章 | 通过 | CDP 截图 `screenshot-p2-packaged-home/article/settings.png`（1600×900）；三视图切换零控制台错误、零异常 |
| 断网可用性 | 通过（间接） | CDP 网络审计：页面加载与三视图切换的全部资源均来自 `127.0.0.1`（4 条 performance 条目），外网请求数 0。未做物理断网测试，列入 P5 干净环境待办 |
| 只监听 127.0.0.1 随机端口 | 通过 | 多次启动分别得到 36329 / 19884 / 12903（每次随机），netstat 确认仅绑定 127.0.0.1 |
| 无凭据请求被拒绝 | 通过 | curl 无 Cookie 访问 `/api/health` 与 `/` 均 403；伪造 `Host: evil.example` 403 |
| 重复打开唤起已有窗口 | 通过 | 开发版与打包版各测一次：第二实例立即退出（码 0），第一实例保持运行并聚焦 |
| 连续启动/退出 3 次且后台/端口释放 | 通过 | 开发版 3 次 + 打包版 3 次循环：每次窗口就绪、退出后 electron 进程数 0、端口释放 |

截图与产物：`docs/desktop/screenshot-p2-dev-{home,article,settings}.png`（开发模式）、`docs/desktop/screenshot-p2-packaged-{home,article,settings}.png`（打包版）、可执行程序 `desktop\release\win-unpacked\知幕 AI.exe`。

## 安全实现核对（方案 3.3）

- `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webSecurity: true`；正式包只执行打包代码，CSP 限制 `default-src 'self'`（含 media blob: 用于本地视频解码、img data:）。
- 会话凭据每次启动随机生成，仅经父子进程消息传递；主进程在非持久化 session 设置 HttpOnly、SameSite=Strict Cookie；不进入 URL、日志或源码。
- 全部路由校验凭据与 Host；带 Origin 的请求要求同源；未向任意网页开放 CORS；静态与媒体请求同样需要凭据。
- 窗口仅允许自身页面导航；外部链接经协议校验后交系统浏览器；preload 不暴露任意读写或命令执行。
- 运行依赖检查：安装版运行路径仅加载 `desktop/dist` 构建产物与 Electron 运行时；`npm run dev`、Vite 开发服务器、系统 node.exe、Wrangler 均非运行依赖（打包产物无 `cloudflare:workers` 导入——P2 未引入任何含该导入的模块）。

## 未通过 / 未测试内容及原因

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 物理断网启动 | 未测 | 采用 CDP 网络审计替代（0 外网请求）；物理断网列入 P5 干净环境验收 |
| 一次打包版实例中途退出 | 已记录 | 首次 CDP 截图会话中一个实例在截图超时后退出，原因未定位（当时窗口疑似被遮挡/最小化）；其后 7 次启动（含 3+3 次循环与单实例测试）均未复现。留待观察，若复现将在 P3 排查 |
| 业务接口 | 未迁移（按计划） | debug/frames/analyze/ask/upload 等在 P3 接入；B 站、Gemini、通义在 P4 |

## 相对方案的偏离与依据

1. `desktop:dev` 实现为"构建后以系统 Electron 运行"而非连接 Vite 开发服务器——安装版生产路径必须直接加载构建产物，开发模式与生产同路径可更早暴露资源问题；如需 HMR 可后续补充。
2. 应用未分发 node_modules：React 打包进渲染层、Hono 打包进服务 bundle（esbuild），`files` 仅含 `desktop/dist/**`——满足"打包包括实际运行所需的资源"，且避免依赖目录膨胀。

## 下一阶段（P3）

video-store 抽象与 r2 重构（保持网页构建可用）、本地视频存储（分片/合并/Range/限额/清理）、接入 debug/frames/analyze/ask 与六个 upload 接口、桌面服务测试与内存观察。

## P2 提交

- `P2 桌面骨架`：desktop/{main,preload}.ts、desktop/server/{index,routes}.ts、desktop/renderer/*、desktop/vite.config.ts、desktop/scripts/build.mjs、electron-builder.yml、package.json、tests/desktop-server.test.mjs、.gitignore、本报告。
