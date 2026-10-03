# Daylight 原始设计记录

原始可编辑 [Figma v1 文件](https://www.figma.com/design/UHEyr1qqi1WspOuH8QJVvP) 包含 Today、任务详情和组件样例；主要节点为 Today 3:43、详情 3:44、组件 3:45。原始画布使用语义图层与可编辑文字，并非截图平铺。

设计参考 Things 的日常任务组织、Todoist 的 Today/Upcoming 层级和 Linear 的紧凑导航；未复制品牌素材。液态玻璃材质参考 [Endless animation](https://liquidglassdesign.com/gallery/endless-animation)，采用应用原创的程序化 SVG 与 CSS 实现。

Figma v1 的尺寸与早期字体建议已被当前实现取代。当前主题、天气、动效、可访问性和 Windows 行为统一记录在 [界面与动效说明](day-night-spec.md)，以实际桌面应用为准。日夜主题按电脑系统时间切换，不跟随远程天气城市的时区；手动选择仅在当前窗口会话中临时生效。

公开 [产品演示](../docs/demo.html) 和 `docs/media/` 中的媒体使用独立示例数据，下载仓库后可离线浏览。具体操作及 Codex 连接见[使用手册](../docs/USER_GUIDE.md)和 [MCP 指南](../docs/MCP_GUIDE.md)。
