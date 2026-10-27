---
description: 初始化 Agnes Media 插件配置（首次安装后运行一次）：一次性配好厂商、Base URL、API Key 与模型
---

# Agnes Media 初始化配置

本命令**只需在插件安装后运行一次**。配置一次永久生效，三种方式按推荐顺序（也把这个选择告诉用户）：

1. **插件详情配置区（最简单）**：设置 → 插件 → 本插件详情 → **配置** 区填写 API Key / Base URL / 厂商形态 / 模型，保存后完全退出并重开 ZCode 生效；
2. **本命令写入配置文件**：`~/.agnes-media/config.json`（Windows 为 `C:\Users\<用户名>\.agnes-media\config.json`），下次调用立即生效；
3. **环境变量**：`AGNES_API_KEY` / `AGNES_BASE_URL`（优先级高于配置文件）。

## 执行步骤

0. **用交互选择器引导，不要只发纯文字问题**：调用 AskUserQuestion 工具（会渲染成可点选的选项卡片）发起「厂商形态」选择——header 写"厂商形态"，三个选项各带一句说明：
   - `Agnes 官方`：用 Agnes 的 apihub 接口（sk- 开头 Key）
   - `OpenAI 兼容网关`：智谱、各类中转站等，接口格式与 OpenAI 相同
   - `自定义端点`：端点全手动指定
   选完后在回复正文里继续收集其余信息（Key 这类自由文本只能用正文输入）。若 AskUserQuestion 工具不可用，再退回正文一次性提问。
1. 调用 `media_config` 查看当前状态。
   - 若显示**无缺失项且无 provider 警告**：告诉用户「已完成初始化，无需重复配置」，列出当前配置（API Key 脱敏），结束。
   - 若显示缺失项（通常是 apiKey / baseUrl / imageModel / videoModel 全部缺失）：继续第 2 步。
   - 若出现 **provider 未设置警告**：即使其他项齐全也要引导——单独问用户所用厂商（baseUrl 是 `apihub.agnes-ai.com` 时建议 `provider=agnes`；OpenAI 兼容网关用 `openai`），确认后用 `configure_media` 补写 provider，再结束。provider 缺失时请求会按 openai 兼容形态发送，Agnes 官方的图生图参数、宽高比会不生效。
   - **若 `media_config` 工具不可用**（插件 MCP 未加载，详见下方「MCP 不可用时的降级路径」）：直接走降级路径，不要反复重试工具；降级读取配置文件时同样要检查 `provider` 字段是否存在。
2. **按选择收集，最少提问**：
   - **Agnes 官方**：只需要用户提供 **API Key**（sk- 开头）。其余采用 Agnes 官方对应值（在回复中列出供确认）：`baseUrl=https://apihub.agnes-ai.com`、`provider=agnes`、`imageModels=["agnes-image-2.5-flash"]`、`videoModels=["agnes-video-2.5-flash"]`；用户没异议就直接写入，不用逐项确认。
   - **其他厂商**：再问 **baseUrl**、**apiKey**、**imageModel / videoModel**（provider 按形态判断：OpenAI 兼容网关用 `openai`，端点特殊用 `custom`）。
   - 无论哪种，都提醒一句：Key 通过对话传入会留在对话记录里；更稳妥的方式是插件详情配置区或配置文件。
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
