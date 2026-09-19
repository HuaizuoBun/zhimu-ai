# P5 报告：Windows 安装版交付

日期：2026-09-18（1.0.0）· 2026-09-19 修订（1.0.1 / 1.0.2）· 执行范围：P5（NSIS 安装包、产品图标、本机安装实测、用户说明；干净环境验收列为用户待办）

## 交付物

| 交付物 | 位置 / 值 |
| --- | --- |
| Windows x64 NSIS 安装包（当前） | `desktop\release-p5-final\知幕AI-Setup-1.0.2-x64.exe` |
| 大小 | 107.7 MB |
| SHA-256（1.0.2） | `3F8BED4DE183CE93ED9EBB45685DA79F2597F5C1F35EC4C144CC7ED7FA938C67` |
| 历史版本 1.0.1 | `知幕AI-Setup-1.0.1-x64.exe` · SHA-256 `E632A46177DBE2D67C636E059E4CE71A3CFA334EEFEB0717BD1BA881AAAFFC46` |
| 历史版本 1.0.0 | `知幕AI-Setup-1.0.0-x64.exe` · SHA-256 `8159D4BF03D87F2070219FBBC7975632FE1EDEED97F51D473A61901192A293DE` |
| 版本 | 1.0.2（exe FileVersion 实测 1.0.2） |
| appId（固定） | `cn.zhimu.ai.desktop` |
| 产品图标 | `desktop/build/icon.png`（512×512，由现有 favicon.svg 蓝色四块 logo + 墨色圆角底生成，sharp 渲染；electron-builder 自动转换 ico 多尺寸） |
| 用户操作说明 | `docs/desktop/知幕AI-桌面版-使用说明.md` |
| 开发构建命令 | `npm run desktop:dist`（= desktop/scripts/build.mjs + electron-builder --win nsis） |

## 1.0.2 修订（用户反馈，录屏确认）

用户录屏反馈：点击「知识库」后下方页面已切换，但顶部导航高亮仍停留在「工作台」。原代码将分析页归入「工作台」高亮（`view === "home" || view === "analysis"`），且「知识库」按钮没有任何高亮态。

修复（`app/page.tsx`，网页版同步生效）：「工作台」仅在首页高亮；「知识库」在分析结果页（含演示与真实分析完成后的页面）高亮；「API 设置」不变。重新构建、重打包、静默覆盖安装，CDP 实测四个导航状态全部正确（首页→工作台高亮；点知识库→知识库高亮；点 API 设置→API 设置高亮；点回工作台→工作台高亮），截图 `docs/desktop/screenshot-p5-v1.0.2-nav-highlight.png`。网页 19 项测试回归通过。

## 1.0.1 修订（用户反馈）

用户报告：点击「知识库」后页面已切换，但窗口顶部仍有一条白色横条停留在界面之外——即 Electron 默认菜单栏（File/Edit/View/Window，网页版没有、桌面版首次出现的原生白条）。

修复：`desktop/main.ts` 增加 `Menu.setApplicationMenu(null)` 移除默认菜单栏（应用有自己的顶部导航，正式包也更符合只执行打包界面的边界）。重新构建、重打包、静默覆盖安装并实测：窗口顶部直接是应用自身导航栏，无菜单白条（`docs/desktop/screenshot-p5-v1.0.1-nomenu.png`，PrintWindow 原生窗口截图验证）。

安装配置：按当前用户安装（perMachine: false，无需管理员）、一键安装（oneClick）、桌面与开始菜单快捷方式「知幕 AI」、卸载不删除用户数据。

## 本机实测（开发机 Windows 11 10.0.26200 AMD64）

| 步骤 | 结果 |
| --- | --- |
| 静默安装（`/S`） | 通过：exit 0，安装至 `%LOCALAPPDATA%\Programs\zhimu-ai`，桌面 + 开始菜单快捷方式创建，注册表卸载项「知幕 AI 1.0.0」 |
| 启动安装版 | 通过：窗口就绪、本地服务随机端口（50733/54499 两次实测）、标题「知幕 AI」 |
| 无凭据请求 | 通过：`/api/health` 与静态页无 Cookie 均 403 |
| 来源与文章视图 | 通过：首页仅 Bilibili + 本地视频两个来源；「知识库」默认文章笔记视图（来源行、6 章目录带时间、AI 总结） |
| 网络审计（CDP） | 通过：页面全部请求仅指向 127.0.0.1，外网请求 0 |
| 控制台 | 通过：0 错误 0 警告 0 异常（修复 meta CSP 中 header-only 的 frame-ancestors 指令后复检为零） |
| 卸载（`/S`） | 通过：exit 0，安装目录、快捷方式、注册表项全部清除 |
| 中文用户名/带空格路径 | 部分验证：本机用户名无中文，安装路径 `%LOCALAPPDATA%\Programs\zhimu-ai` 无空格；应用内部对带空格的源码路径在开发模式全程正常（构建/打包/运行），中文与空格路径专项列为干净环境待办 |
| 断网启动 | 间接通过（外网请求 0）；物理断网列入干净环境待办 |

截图证据：`docs/desktop/screenshot-p5-installed-home.png`、`screenshot-p5-installed-article.png`、`screenshot-p5-final-home.png`、`screenshot-p5-final-article.png`（最终版 1600×900）。

## 干净环境验收（用户待办）

按方案要求，完整安装验收需要在未装 Node.js/npm/TRAE 的环境（另一台电脑、干净虚拟机或 Windows Sandbox）进行：

1. 下载安装包并安装 → 启动 → 确认主页仅 B 站与本地视频两个来源。
2. 本地视频 + SRT/VTT 走一次真实分析（需在设置中填入你自己的模型 API Key），检查文章笔记、时间轴、问答、导出 .md。
3. 断网启动应用（应能打开界面，分析报网络错误）；验证中文用户名与带空格的安装/文件路径。
4. 卸载干净（安装目录、快捷方式、注册表）。

## 全量回归（P5 收尾）

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm.cmd test`（网页） | 0 | 构建 + 19 项测试通过 |
| `npm.cmd run desktop:test` | 0 | 12 项桌面测试通过 |
| `node typescript tsc --noEmit` | 0 | 无类型错误 |
| `npm.cmd run lint` | 0 | 0 错误 |
| `electron-builder --win nsis` | 0 | 安装包生成（见交付物） |

## 已知限制与说明

1. 真实模型生成质量未验证（无真实 Key）——用户填 Key 实测。
2. 旧输出目录（desktop/release、release-p3、release-p5 的部分文件）在开发机上被系统句柄锁定无法删除（无对应进程，疑似杀软/索引服务），不影响安装包本身；锁定释放后可手动清理，均已 gitignore。
3. 一次沙箱拦截导致安装中途失败并残留注册表项，已清理并复装成功（记录于过程，最终安装干净）。
4. GitHub 发布（仓库、Release 附件、版本标签）按方案属 P5 之后的独立步骤，目标账号/仓库名未定，本轮未执行。

## 桌面化阶段总览（P2–P5）

| 阶段 | 交付 | 状态 |
| --- | --- | --- |
| P2 骨架与首包 | Electron 主进程 + utilityProcess Hono 服务 + 会话校验 + win-unpacked，全部验收项通过 | 完成（480f2b1） |
| P3 本地后端与存储 | VideoBucket 抽象（桌面 bundle 无 cloudflare 导入）、本地存储（流式/限额/Range/清理）、10 接口接入、7 项测试、256MB 内存观察 | 完成（98572a2） |
| P4 B 站与原生视频 | 剩余 7 接口接入、duplex 流式、5 项协议测试（含 YouTube 410 回归） | 完成（ab6d22b） |
| P5 安装版 | NSIS 安装包 + 图标 + 本机实测 + 用户说明 | 完成（本报告提交） |
