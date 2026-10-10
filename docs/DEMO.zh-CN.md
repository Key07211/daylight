# Daylight 产品演示

[English](DEMO.md) · **简体中文**

[打开演示](https://key07211.github.io/daylight/demo.html?lang=zh) · [下载离线演示](https://github.com/Key07211/daylight/releases/latest) · [开始使用](../README.zh-CN.md#开始使用) · [连接 Codex](../README.zh-CN.md#连接-codex)

## 浏览演示

演示涵盖任务、提醒、液态玻璃、日夜天气、桌面控制、Codex 工作流与开场动画。可以点击章节自由浏览，也可以启动自动导览。

- 日光、夜晚与雨天会自动播放真实应用的录制画面；切入开场章节也会自动播放。
- 点击**暂停动态**显示静止预览，点击**播放动态**恢复。系统开启“减少动态效果”时，默认显示静止画面，也可主动播放。
- 切换 **English / 中文**，会同时切换页面文案、应用画面与示例任务语言。
- 点击画面可以放大；使用关闭按钮或 Escape 退出。

演示没有声音。语言、导航和播放按钮只影响当前页面，不会修改任务、发送提醒、改变 MCP 设置或执行 Codex。

## 离线查看

解压 `Daylight-Demo-0.4.0.zip`，用 Edge、Chrome 或 Firefox 打开其中的 `docs/demo.html`。保留随附文件与 `media` 文件夹，无需安装应用、启动本地服务、安装依赖或连接网络。

也可以下载本仓库，直接打开 `docs/demo.html`。默认使用英文，离线时也能切换中文。

## 画面说明

所有画面均来自真实应用，并使用全新、隔离的资料目录。任务、项目、日期、城市与天气均为固定的公开示例；演示中的天气不是实时预报。中文素材位于 `media/`，对应英文素材位于 `media/en/`。

任务编辑器与完成确认弹窗均为真实界面。Codex 画面保持未连接，调度是没有执行历史的暂停草稿。演示制作过程中没有登记真实 MCP 连接或运行 AI 作业。开场录制仅保留介绍场景。

在正式应用中，任务保存在本机。天气需要网络；Codex 功能需要本机 CLI 与有效登录，自动执行还需联网并使用 Codex 账户用量。提醒与调度需要应用运行、电脑唤醒。切换应用语言不会翻译已有任务内容。

## 更新与检查演示

在仓库根目录运行：

```powershell
npm ci
npm run build
.\node_modules\.bin\electron.cmd desktop/product-demo.cjs
.\node_modules\.bin\electron.cmd desktop/product-demo.cjs --english
```

只更新应用循环录制画面：

```powershell
.\node_modules\.bin\electron.cmd desktop/product-demo.cjs --motion-only
.\node_modules\.bin\electron.cmd desktop/product-demo.cjs --motion-only --english
```

检查演示页面与可见动态：

```powershell
.\node_modules\.bin\electron.cmd desktop/product-demo.cjs --verify-docs
.\node_modules\.bin\electron.cmd desktop/demo-motion-smoke.cjs
```

录制使用临时 `.runtime/product-demo-*` 资料目录和随机本地端口，禁用外部网络请求、调度与系统 MCP 登记。素材输出到 `docs/media`；运行报告保存在 `.runtime`，不随演示分发。动态检查会比较不同时间实际渲染的画面像素。

发布前检查两种语言、各个场景、暂停与播放、减少动态、键盘操作及窄屏布局。重新录制时继续使用示例资料目录。
