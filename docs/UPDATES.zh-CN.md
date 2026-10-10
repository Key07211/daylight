# 版本更新

[English](UPDATES.md) · **简体中文**

Windows 安装版启动后检查 GitHub Releases，运行期间每六小时再检查一次。检查时只获取版本信息，点击**下载并立即重启**后才下载安装包。

## 使用更新

1. 有新的正式版本时，**置顶**右侧出现蓝色圆点。点击可查看版本号和更新说明。
2. 点击**下载并立即重启**，圆点显示下载进度。开始前请先完成或保存正在编辑的任务。
3. 下载并校验完成后，Daylight 立即安装更新并重新打开，不显示倒计时，也不再二次确认。若仍在编辑任务或有 Codex 任务正在执行，会等待这些操作结束后自动继续。

设置中也可**检查更新**。已是最新版时，蓝色圆点隐藏。检查或下载失败不会替换正在运行的应用，可以重试或稍后再检查。任务仍保存在 `%APPDATA%\Daylight\data\store.json`。

首次需要手动安装一次带更新功能的版本：**0.4.0 之前的版本**不能自行升级。从[官方发布页](https://github.com/Key07211/daylight/releases/latest)下载 Setup 安装包，退出 Daylight 后安装即可。免安装版提供发布页入口，由用户手动下载替换，不覆盖安装自身。源码、预览和测试会话不会运行正式安装版的更新器。

## 发布新版本

发布流程位于 [`.github/workflows/release.yml`](../.github/workflows/release.yml)。在 `Key07211/daylight` 推送 `v*` 标签时执行，也可手动补发既有标签。普通代码推送和本地构建不会发布更新。

1. 选择高于上个正式版本的新版本号，同时更新 `package.json` 与 `package-lock.json`，修改相应发布文档并提交。
2. 推送该提交及完全一致的标签，例如包版本 `0.4.1` 对应 `v0.4.1`。
3. Windows 流程安装锁定依赖、运行测试、构建安装版和免安装版，验证打包后的启动、安装器载荷以及更新清单。
4. 所有文件先上传为草稿，逐一核对上传后的大小和 SHA-256，全部通过后才公开。公开前失败的版本不会被更新器发现；可重新运行流程，继续同一提交对应的草稿。已经公开的版本不会被覆盖。

若推送标签后没有启动流程，可打开 **Actions → Windows release → Run workflow**，选择 `main`，填入已有标签，例如 `v0.4.0`。手动流程会检出该标签，核对 `HEAD` 与标签提交及包版本一致，并在发布记录和验证报告中使用实际源码提交。它不会使用较新的 `main` 应用代码构建，不会创建或移动标签，也不会覆盖已公开版本。

完整动画界面检查会在 GitHub 托管的临时 Windows 会话中启用客户端区域动画，并核对 Electron 未报告减少动态。这用于适配运行器的无障碍默认设置，不改变应用的减少动态行为，也不修改本机 Windows 设置。

以下更新文件由 electron-builder 生成，必须配套上传：

| 文件 | 用途 |
| --- | --- |
| `latest.yml` | 版本号、安装包文件名、大小与 SHA-512 |
| `Daylight-Setup-<version>.exe` | NSIS 更新安装器 |
| `Daylight-Setup-<version>.exe.blockmap` | 差分下载数据 |

流程还会发布免安装程序与 ZIP、双语离线演示 ZIP、SHA-256 列表和验证报告。只有发布步骤使用流程临时 `GITHUB_TOKEN`，应用不会携带 GitHub 令牌。构建时生成的内部 `resources/app-update.yml` 指向公开仓库。更新器只使用正式版本，不执行降级。

本地构建与清单验证：

```powershell
npm ci
npm test
npm run package:win -- --publish never
node scripts/verify-update-release.mjs
.\node_modules\.bin\electron.cmd desktop/update-download-smoke.cjs
```

`verify-update-release.mjs` 会拒绝版本不一致、错误或不安全的文件名、错误的大小或 SHA-512、缺失或不完整的 blockmap，以及指向其他仓库的应用内更新配置。下载检查使用真实 Electron 更新器和本机回环服务，将已构建的安装包下载到独立缓存，验证仅检查不会下载、主动下载有进度、成功后立即请求安装重启、错误校验值不会触发安装。安装由测试替身拦截，不会执行安装器，也不影响实际应用。差分下载与实际安装重启，仍需在独立 Windows 测试账户或虚拟机中，使用已支持更新的旧安装版和较新的发布版验证，并单独记录结果。

## 签名与故障处理

目前的 Windows 发行程序**尚未签名**。HTTPS 和校验值用于核对下载内容完整性，并不等于经过验证的发布者身份。Windows 可能显示未知发布者或 SmartScreen 提示，应用不会关闭 Windows 的防护措施。

将来使用签名发行时，应在构建中配置 Windows 代码签名，通过 GitHub 安全保存证书或签名服务凭据，并核对打包后的更新配置中的发布者名称。还需要测试未签名安装版升级到签名版、以及签名版之间的更新。不能将目前的未签名版本描述为已经验证发布者。

更新失败时可以继续使用当前版本，之后重试。也可退出 Daylight，手动运行最新官方安装器；任务数据位于安装目录之外。若已发布版本存在问题，应发布更高版本修复，而不是替换现有安装包或修改其校验值。

实现参考：[electron-builder 自动更新](https://www.electron.build/v26/docs/features/auto-update/)与 [GitHub Release 创建](https://cli.github.com/manual/gh_release_create)。
