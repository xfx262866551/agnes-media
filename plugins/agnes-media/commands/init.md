---
description: 初始化 Agnes Media 插件配置（首次安装后运行一次）：一次性配好厂商、Base URL、API Key 与模型
---

# Agnes Media 初始化配置

本命令**只需在插件安装后运行一次**。配置一次永久生效，三种方式按推荐顺序（也把这个选择告诉用户）：

1. **插件详情配置区（最简单）**：设置 → 插件 → 本插件详情 → **配置** 区填写 API Key / Base URL / 厂商形态 / 模型，保存后完全退出并重开 ZCode 生效；
2. **本命令写入配置文件**：`~/.agnes-media/config.json`（Windows 为 `C:\Users\<用户名>\.agnes-media\config.json`），下次调用立即生效；
3. **环境变量**：`AGNES_API_KEY` / `AGNES_BASE_URL`（优先级高于配置文件）。

## 执行步骤

0. **收集信息时直接在回复正文中向用户提问**（一次性列全要问的内容），不要调用交互式工具、不要等待、不要循环重试。
1. 调用 `media_config` 查看当前状态。
   - 若显示**无缺失项**：告诉用户「已完成初始化，无需重复配置」，列出当前配置（API Key 脱敏），结束。
   - 若显示缺失项（通常是 apiKey / baseUrl / imageModel / videoModel 全部缺失）：继续第 2 步。
   - **若 `media_config` 工具不可用**（插件 MCP 未加载，详见下方「MCP 不可用时的降级路径」）：直接走降级路径，不要反复重试工具。
2. **一次性向用户问清**以下信息（不要逐条追问，可给出默认建议）：
   - **provider**：`agnes`（Agnes 官方）/ `openai`（OpenAI 兼容网关）/ `custom`（端点全手动）
   - **baseUrl**：接口地址，如 `https://apihub.agnes-ai.com`
   - **apiKey**：用户的 Key。提醒用户：通过对话传入会留在对话记录里；更稳妥的方式是自己写配置文件或设置环境变量 `AGNES_API_KEY` / `AGNES_BASE_URL`
   - **imageModel / videoModel**：模型 ID。Agnes 常用 `agnes-image-2.5-flash` / `agnes-video-2.5-flash`；智谱常用 `cogview-3-flash` / `cogvideox-flash`
   - （可选）多模型兜底 `imageModels` / `videoModels`（最多 3 个）、跨厂商候选链 `chains`（最多 3 项）——只在高可用场景需要，普通用户跳过
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
