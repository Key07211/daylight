# Daylight 产品演示

[打开交互导览](demo.html) · [使用指南](USER_GUIDE.md) · [Codex 接入](MCP_GUIDE.md)

下载演示压缩包后解压，打开其中的 `docs/demo.html`。也可以下载本仓库的 `docs` 文件夹，保留 `media` 子目录，使用 Edge、Chrome 或 Firefox 打开 `demo.html`。页面和所有素材均在本地，无需启动 Daylight、安装依赖或连接网络。

这是一份产品导览，不是任务客户端。点击章节、切换画面、中英文切换、放大截图与播放开场，只影响演示页面。它不会添加任务、发送提醒、修改应用配置或调用 Codex。

## 演示内容

| 章节 | 展示内容 |
| --- | --- |
| 任务与提醒 | 项目、优先级、到期与提醒时间、编辑窗口、完成确认 |
| 光线与天气 | 日光、夜晚、雨天，以及玻璃通透度、模糊、高光和动效设置 |
| 桌面里的细节 | 英文界面、原生窗口置顶；用户输入内容保持原文 |
| 与 Codex 协作 | MCP 对话管理任务与 CLI 工作调度的区别 |
| 每一天的开场 | 实际应用录制的晨光、月光和雨窗动画，可手动播放或停止 |
| 安心留在本地 | 本地保存、备份，以及提醒和调度的运行条件 |

导览提供约 45 秒的自动翻页，也可逐章阅读。页面支持窄屏、键盘操作和系统减少动态效果设置。开场动画不会自动播放，没有声音。

## 画面来源与边界

所有应用截图均由当前应用代码在一个全新的隔离资料目录中拍摄。六条任务、项目名称、日期、天气和城市均为公开演示准备的固定样例，不含真实用户任务、邮箱、课程资料或个人配置路径。界面中的“演示城市”与温度是拍摄用的天气样例，不代表实时天气。

任务编辑和完成确认对话框是真实界面。拍摄时取消了完成操作；示例任务未被标记为完成。英文截图通过应用自带的语言按钮切换，置顶状态通过真实窗口控制验证。

Codex 截图刻意保留未连接状态。调度草稿保持暂停，工作目录未设置，执行历史为空。没有配置真实 MCP、发送 Codex 指令或伪造工具数量、执行结果。

实际使用时：

- 任务、提醒和运行记录保存在本机，可导出备份。
- 天气查询需要网络；没有可用天气时，应用会呈现不可用或缓存状态。
- MCP 让已连接的 Codex 读取和管理这份任务清单。
- 定时调度通过本机 Codex CLI 在选定目录中执行工作；需要 CLI 已登录，应用运行、电脑唤醒，并使用 Codex 额度。
- Windows 通知还受系统通知与勿扰设置影响。

## 媒体文件

![Daylight 示例任务界面](media/tasks-day.webp)

| 文件 | 内容 |
| --- | --- |
| `media/tasks-day.webp` | 日光任务列表 |
| `media/task-editor.webp` | 编辑任务与提醒时间 |
| `media/complete-confirm.webp` | 完成确认 |
| `media/glass-settings.webp` | 玻璃参数设置 |
| `media/tasks-english.webp` | 英文界面与置顶状态 |
| `media/tasks-night.webp` | 夜晚任务列表 |
| `media/tasks-rain.webp` | 雨天任务列表 |
| `media/codex-workflow.webp` | 未连接的 Codex 状态与暂停草稿 |
| `media/opening-day.webp` | 晨光开场动画 |
| `media/opening-night.webp` | 月光开场动画 |
| `media/opening-rain.webp` | 雨窗开场动画 |
| `media/opening-*-still.webp` | 对应动画的静止预览图 |

动画素材只保留开场部分，不包含开场后的任务画面。使用 WebP 便于压缩包与 GitHub 页面直接离线播放，无需视频解码工具。

## 为维护者重新拍摄

在仓库根目录运行：

```powershell
npm install
npm run build
.\node_modules\.bin\electron.cmd desktop/product-demo.cjs
.\node_modules\.bin\electron.cmd desktop/product-demo.cjs --verify-docs
```

捕获工具只使用临时新建的 `.runtime/product-demo-*` 资料目录和随机本地端口。禁止外部网络请求，禁用调度器与 MCP 系统配置操作。输出为 `docs/media`；验证结果保存在不随发布分发的 `.runtime` 中。

请在重新拍摄后检查每张素材、移动端布局和英文导览，再发布。不要用真实资料目录或个人任务截图替换示例素材。

---

## English

Open [demo.html](demo.html) after extracting the demo archive. Keep the adjacent `media` folder. The walkthrough works offline and has a built-in English switch.

The page is a product demonstration, not a task client. Its controls select actual app captures and explanations. They do not edit tasks, send notifications, configure MCP or execute Codex.

All captures use a fresh, isolated profile with synthetic tasks and fixed weather/time examples. No personal tasks, email addresses, course materials or user configuration paths are included. The Codex capture remains disconnected, with a paused draft and no execution history. Opening recordings contain the introductory scene only.

For the real application, tasks are stored locally. Weather requires networking. Codex features require the local CLI and sign-in. Reminders and scheduled runs require the application to remain running and the computer to remain awake. See the [user guide](USER_GUIDE.md) and [Codex guide](MCP_GUIDE.md) for setup.
