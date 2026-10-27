# MediaForge · 影匠

> ZCode 插件：一句话生成图片和视频。**图片与视频可以分别配置不同厂商**，自定义 API Key 与 Base URL，跨厂商容灾。

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE) [![version](https://img.shields.io/badge/version-0.9.3-blue)](plugins/agnes-media/.zcode-plugin/plugin.json)

给 [ZCode](https://zcode.ai) 装一个插件，以后"画张图""把这个视频做出来"都是一句话的事。基于 [Agnes AI](https://agnes-ai.com) 的图片/视频生成 API 设计，同时兼容 OpenAI 兼容形态的其他厂商（智谱、各类中转站等）。

## 特性一览

- **文生图 / 图生图 / 图片编辑 / 多图合成**：一句话出图，自动落盘、自动在对话里显示；
- **生视频**：文生视频、首尾帧、参考图（Agnes 形态），异步任务可轮询；
- **图片与视频分开配厂商**：图片用 A 家、视频用 B 家，各用各的 Base URL/Key/模型，互不影响（配置文件 `image` / `video` 分域）；
- **任意厂商**：Agnes 官方 / OpenAI 兼容网关（智谱、中转站等）/ 自定义端点，接口格式按 Base URL 自动判断，不用选"厂商形态"；
- **交互式初始化**：`/agnes-media:init` 用可点选卡片引导，先问"同一家还是分开"，分开则分别配两家的地址和模型；
- **容灾**：模型兜底链（最多 3 个，429/超时/不通自动切）+ 跨厂商候选链（最多 3 项，地址+Key+模型整体切换）；
- **提示词增强**（可选）：配 `textModel` 后自动把短句扩写成结构化提示词；
- **零依赖**：纯 Node 18+，不需要 `npm install`。

## 能力

| 你说 | 得到 |
| --- | --- |
| "画一张赛博朋克城市夜景，16:9，2K" | AI 图片，自动落盘到 `ZcodeImage/` 并在对话中显示 |
| "把这张图改成雪山，保留构图" | 图生图/图片编辑 |
| "把这两张图合成一张海报" | 多图合成 |
| "生成一段 5 秒海浪视频" | MP4 下载链接（异步任务，可轮询） |
| "用这张图做首帧生成视频" | 关键帧视频（Agnes 形态） |

底层工具（MCP）：`generate_image`（文生图）、`edit_image`（图生图/编辑/多图合成）、`generate_video`（文生视频/关键帧/参考视频）、`video_status`（任务查询）、`media_config` / `configure_media`（配置管理）。斜杠命令：`/agnes-media:init`（交互式初始化）、`/agnes-media:config`（中途修改）。

## 安装

**前置**：ZCode 桌面版 + Node.js 18+（`node` 命令可用）。插件不含任何密钥，每个人配自己的。

1. **插件市场 → 添加 → 添加插件市场**，粘贴本仓库地址；
2. 在 **个人** 找到「图片视频生成（任意厂商）」→ **安装**；
3. 按下面「配置」一节完成一次配置（最少只需 Key + Base URL）；
4. 直接说「画一张赛博朋克城市夜景」或「生成一段 5 秒海浪视频」。

> 插件 MCP 服务器在 ZCode 启动时注册：安装/更新插件或改完配置区后需**完全退出 ZCode（菜单 → 退出）再重开**；可在 **设置 → MCP → Plugin MCP 服务器** 确认 `agnes-media` 已出现。

## 配置（一次配好，永久生效）

**最少只需两项：API Key + Base URL**。接口格式按地址自动判断（含 `agnes-ai.com` → Agnes 官方，其余 → OpenAI 兼容），**不需要选"厂商形态"**。

| 项 | 配置方式 |
| --- | --- |
| API Key | `/agnes-media:init` 写入配置文件、手写配置文件、或环境变量 `AGNES_API_KEY`。⚠️ ZCode 配置区的敏感字段只能显示脱敏状态、填不了 |
| Base URL / 模型 / 兜底链 / 保存目录 | 插件详情**配置区**（保存后完全退出重开 ZCode 生效），或写配置文件（立即生效） |

配置文件：Windows `C:\Users\<用户名>\.agnes-media\config.json`；macOS/Linux `~/.agnes-media/config.json`。
优先级：调用参数 > 环境变量（含配置区注入）> 配置文件 > 自动推断。

```json
{
  "apiKey": "sk-你的key",
  "baseUrl": "https://apihub.agnes-ai.com",
  "imageModel": "agnes-image-2.5-flash",
  "videoModel": "agnes-video-2.5-flash"
}
```

Key 申请（Agnes）：<https://platform.agnes-ai.com/> 注册 → API Keys。Base URL 带不带 `/v1` 都行（插件会自动去重）。

### 图片与视频用不同厂商（分域配置）

顶层字段作为共同默认，`image` / `video` 子对象各自覆盖对应域（baseUrl/apiKey/模型/端点），互不影响：

```json
{
  "image": { "baseUrl": "https://厂商A地址", "apiKey": "A的key", "imageModel": "A的图片模型" },
  "video": { "baseUrl": "https://厂商B地址", "apiKey": "B的key", "videoModel": "B的视频模型", "videoQueryTemplate": "/v1/videos/{video_id}" }
}
```

未配置的域自动回落到顶层字段。配置区只有单一套字段（作为共同默认），**分域配置写配置文件**（`configure_media` 的 `image`/`video` 参数也可写）。

### 适配其他厂商

| 形态（自动判断） | 说明 |
| --- | --- |
| Agnes 官方 | 图生图走 `extra_body.image`，视频查询走 `/agnesapi`；keyframe/reference 视频模式仅此形态 |
| OpenAI 兼容网关 | 图片 `response_format` 顶层；视频 `POST /v1/videos` + `GET /v1/videos/{id}` |
| 自定义 | 端点全手动：`imageEndpoint` / `videoCreateEndpoint` / `videoQueryTemplate`（支持 `{video_id}`、`{model}` 占位符） |

请求形态可用 `imageApiStyle` 覆盖；厂商特有参数用 `imageExtraBody` / `videoExtraBody` 附加。

## 容灾（配了就不用管）

- **模型兜底链** `imageModels` / `videoModels`（最多 3 个，第 2/3 个可选）：第一个模型遇 **429 限流、5xx、超时、网络不通、404** 自动切下一个；**400/401/403** 等不可重试错误立即失败不切换。
- **候选链** `chains`（最多 3 项，跨厂商整体容灾）：每一项可整体覆盖 `baseUrl`/`apiKey`/`provider`/模型/端点，第一项失败时**地址+Key+模型一起切**到下一项：

```json
{
  "chains": [
    { "provider": "agnes", "baseUrl": "https://apihub.agnes-ai.com", "apiKey": "sk-agnes", "imageModels": ["agnes-image-2.5-flash"], "videoModels": ["agnes-video-2.5-flash"] },
    { "provider": "openai", "baseUrl": "https://open.bigmodel.cn/api/paas/v4", "apiKey": "zhipu-key", "imageModels": ["cogview-3-flash"], "videoModels": ["cogvideox-flash"] }
  ]
}
```

- **提示词增强**（可选）：配置 `textModel` 后，生成时传 `enhance_prompt: true`，先用 chat 模型把简短描述扩写成结构化提示词；失败自动降级用原提示词。

## 输出规范

- 图片默认保存到 `<当前目录>/ZcodeImage/`，生成后直接在对话中显示；
- 视频返回下载链接（有时效），也可 `download: true` 存本地；
- 发生模型/链路切换时，结果里会带「切换记录」。

## 目录结构

```
plugins/agnes-media/
├─ .zcode-plugin/plugin.json   # 插件清单（含 userConfig 配置区声明）
├─ .mcp.json                   # MCP 服务器声明（node server/index.mjs，零依赖；env 接收配置区的值）
├─ commands/                   # /agnes-media:init 初始化、/agnes-media:config 改配置
├─ hooks/                      # SessionStart：检测未配置并引导初始化
├─ server/
│  ├─ index.mjs                # MCP stdio 服务器（JSON-RPC，零第三方依赖）
│  └─ media-api.mjs            # Agnes/OpenAI 兼容 API 客户端、配置解析、兜底链
└─ skills/agnes-media/SKILL.md # Agent 使用规范
```

## 开发

```bash
node --check plugins/agnes-media/server/index.mjs   # 语法检查
```

无第三方依赖，不需要 `npm install`。

## 常见问题

- **市场刷新后没有更新提示？** 先看仓库根目录 marketplace.json 里的 version（线上版本源）。在 市场源 → 点该市场的刷新按钮；仍无提示就把这个市场源**删掉重新添加**仓库地址——客户端市场目录有缓存。
- **设置 → MCP 显示“插件声明了该 MCP 服务器，但当前未成功加载”？** 安装/更新插件后必须**完全退出 ZCode（菜单 → 退出，所有窗口）再重开**，MCP 服务器随启动注册。
- **配置区填不了 API Key？** ZCode 当前版本对 sensitive 字段只显示脱敏状态、不支持界面填写——Key 用 /agnes-media:init、配置文件或环境变量 AGNES_API_KEY。
- **Base URL 要不要带 /v1？** 都行，插件会自动去重。
- **图片想用 A 家、视频用 B 家？** 配置文件写 image / video 两个子对象（见上文「图片与视频用不同厂商」）。
- **插件标识 agnes-media 为什么不是中文名？** 那是稳定标识（更新依赖它，不能改）；界面显示名是 MediaForge · 影匠。

## License

[MIT](LICENSE)
