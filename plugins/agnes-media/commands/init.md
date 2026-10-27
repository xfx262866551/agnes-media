---
description: 初始化 Agnes Media 插件配置（首次安装后运行一次）：一次性配好厂商、Base URL、API Key 与模型
---

# Agnes Media 初始化配置

本命令**只需在插件安装后运行一次**。配置写入用户级配置文件（`~/.agnes-media/config.json`，Windows 为 `C:\Users\<用户名>\.agnes-media\config.json`），之后永久生效，无需每次配置。

## 执行步骤

1. 调用 `media_config` 查看当前状态。
   - 若显示**无缺失项**：告诉用户「已完成初始化，无需重复配置」，列出当前配置（API Key 脱敏），结束。
   - 若显示缺失项（通常是 apiKey / baseUrl / imageModel / videoModel 全部缺失）：继续第 2 步。
2. **一次性向用户问清**以下信息（不要逐条追问，可给出默认建议）：
   - **provider**：`agnes`（Agnes 官方）/ `openai`（OpenAI 兼容网关）/ `custom`（端点全手动）
   - **baseUrl**：接口地址，如 `https://apihub.agnes-ai.com`
   - **apiKey**：用户的 Key。提醒用户：通过对话传入会留在对话记录里；更稳妥的方式是自己写配置文件或设置环境变量 `AGNES_API_KEY` / `AGNES_BASE_URL`
   - **imageModel / videoModel**：模型 ID。Agnes 常用 `agnes-image-2.5-flash` / `agnes-video-2.5-flash`；智谱常用 `cogview-3-flash` / `cogvideox-flash`
   - （可选）多模型兜底 `imageModels` / `videoModels`（最多 3 个）、跨厂商候选链 `chains`（最多 3 项）——只在高可用场景需要，普通用户跳过
3. 调用 `configure_media` 把确认的值写入配置。
4. 再次调用 `media_config` 确认无缺失项，向用户汇报配置结果（Key 脱敏显示），并告知：现在可以直接说「生成一张图片」或「生成一段视频」了；中途修改配置用 `/agnes-media:config` 命令或直接说「改配置」。

## 注意

- 本插件**不内置任何默认 baseUrl / apiKey / 模型**，这是有意设计：凭据只来自用户自己，分享插件不会泄露 Key。
- 配置来源优先级：调用参数 > 环境变量 > 配置文件。用户改了环境变量后以环境变量为准。
