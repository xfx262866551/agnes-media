---
description: 初始化 Agnes Media 插件配置（首次安装后运行一次）：一次性配好厂商、Base URL、API Key 与模型
---

# Agnes Media 初始化配置

本命令**只需在插件安装后运行一次**。配置一次永久生效，三种方式（注意：ZCode 配置区**不支持填敏感值**，API Key 只能走下面 2/3）：

1. **本命令写入配置文件**：`~/.agnes-media/config.json`（Windows 为 `C:\Users\<用户名>\.agnes-media\config.json`），下次调用立即生效；
2. **手动编辑配置文件**：同上，直接把 apiKey/baseUrl/模型填进去；
3. **环境变量**：`AGNES_API_KEY` / `AGNES_BASE_URL`（优先级高于配置文件）。
   Base URL/模型等非敏感项也可以放插件详情配置区（保存后完全退出重开生效），但 **API Key 别指望配置区**——当前版本只显示脱敏状态。

## 执行步骤

0. **必须用交互选择器引导**：调用 AskUserQuestion 工具（渲染为可点选卡片 + Other 自由输入），一次发起最多 4 个问题（示意）：
   - Q1「Base URL」：选项「Agnes 官方」（描述给地址）/「其他厂商」（提示在 Other 里粘贴地址）；
   - Q2「图片模型」：选项 agnes-image-2.5-flash / agnes-image-2.1-flash（其他模型走 Other）；
   - Q3「视频模型」：选项 agnes-video-2.5-flash（其他走 Other）；
   - Q4「API Key」：选项「稍后我自己填」（配置文件生成后自己补 Key，不留存对话记录）/「现在输入」（在 Other 里粘贴）。
   AskUserQuestion 不可用时才退回正文一次性提问。**厂商形态不要问**——接口格式按 Base URL 自动判断。
1. 调用 `media_config` 查看当前状态。
   - 若显示**无缺失项**：告诉用户「已完成初始化，无需重复配置」，列出当前配置（接口格式会显示"自动判断"结果，API Key 脱敏），结束。
   - 若缺少 apiKey（最常见）：引导用户运行本命令写入配置文件（立即生效），或手动编辑 `~/.agnes-media/config.json` 的 apiKey，或设环境变量 `AGNES_API_KEY`；**不要引导去配置区填 Key**（当前版本不支持填写敏感值）。
   - 若显示缺失项：继续第 2 步。
   - **若 `media_config` 工具不可用**（插件 MCP 未加载，详见下方「MCP 不可用时的降级路径」）：直接走降级路径，不要反复重试工具。
2. **按需收集，最少提问**：
   - **Agnes 官方**（baseUrl 为 `apihub.agnes-ai.com`）：只需要用户提供 **API Key**（sk- 开头）。其余采用 Agnes 官方对应值（在回复中列出供确认）：`imageModels=["agnes-image-2.5-flash"]`、`videoModels=["agnes-video-2.5-flash"]`；用户没异议就直接写入，不用逐项确认。
   - **其他厂商**：问清 **baseUrl**、**apiKey**、**imageModel / videoModel**（接口格式自动判断，不用提 provider）。
   - 无论哪种，都提醒一句：Key 通过对话传入会留在对话记录里；更稳妥的方式是自己编辑配置文件或设置环境变量。
   - （可选）多模型兜底 `imageModels` / `videoModels`（最多 3 个）、跨厂商候选链 `chains`（最多 3 项）——只在高可用场景需要，用户不提就不问；也提示这两个兜底链现在可以直接在插件详情配置区用逗号分隔填写。
3. 调用 `configure_media` 把确认的值写入配置。
4. 再次调用 `media_config` 确认无缺失项，向用户汇报配置结果（Key 脱敏显示），并告知：现在可以直接说「生成一张图片」或「生成一段视频」了；中途修改配置用 `/agnes-media:config` 命令或直接说「改配置」。

## MCP 不可用时的降级路径

如果本会话调不到 `media_config` / `configure_media`（插件自带的 MCP 工具没有加载——通常是安装插件后没有完全退出重启 ZCode 导致），**用文件工具直接写配置，效果完全一致**：

1. 用 Write 工具写入 `~/.agnes-media/config.json`（Windows 为 `C:\Users\<用户名>\.agnes-media\config.json`），内容示例：
   ```json
   {
     "provider": "agnes",
     "baseUrl": "https://apihub.agnes-ai.com",
     "apiKey": "用户给的Key",
     "imageModels": ["agnes-image-2.5-flash"],
     "videoModels": ["agnes-video-2.5-flash"]
   }
   ```
2. 告诉用户：配置已写入，立即生效；并建议**完全退出 ZCode 再重开**，之后插件自带 MCP 工具（media_config / configure_media 等）就会恢复，生图/生视频也依赖它们。
3. 不要用 shell 的 `cat`/`echo`  Heredoc 拼 JSON（容易转义出错）；不要反复重试 MCP 工具。

## 注意

- 本插件**不内置任何默认 baseUrl / apiKey / 模型**，这是有意设计：凭据只来自用户自己，分享插件不会泄露 Key。
- 配置来源优先级：调用参数 > 环境变量 > 配置文件。用户改了环境变量后以环境变量为准。
