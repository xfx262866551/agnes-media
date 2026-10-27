# agnes-media

> ZCode 插件：一句话生成图片和视频。文生图、图生图、图片编辑、多图合成、文生视频/关键帧/参考视频，自定义 API Key 与 Base URL，跨厂商容灾。

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE) [![version](https://img.shields.io/badge/version-0.8.4-blue)](plugins/agnes-media/.zcode-plugin/plugin.json)

给 [ZCode](https://zcode.ai) 装一个插件，以后"画张图""把这个视频做出来"都是一句话的事。基于 [Agnes AI](https://agnes-ai.com) 的图片/视频生成 API 设计，同时兼容 OpenAI 兼容形态的其他厂商（智谱、各类中转站等）。

## 能力

| 你说 | 得到 |
| --- | --- |
| "画一张赛博朋克城市夜景，16:9，2K" | AI 图片，自动落盘到 `ZcodeImage/` 并在对话中显示 |
| "把这张图改成雪山，保留构图" | 图生图/图片编辑 |
| "把这两张图合成一张海报" | 多图合成 |
| "生成一段 5 秒海浪视频" | MP4 下载链接（异步任务，可轮询） |
| "用这张图做首帧生成视频" | 关键帧视频（Agnes 形态） |

底层工具（MCP）：`generate_image`（文生图）、`edit_image`（图生图/编辑/多图合成）、`generate_video`（文生视频/关键帧/参考视频）、`video_status`（任务查询）、`media_config` / `configure_media`（配置管理）。

## 安装

**前置**：ZCode 桌面版 + Node.js 18+（`node` 命令可用）。插件本身不含任何密钥，每个人配自己的 Key。

1. ZCode 里打开 **插件市场 → 添加 → 添加插件市场**；
2. 粘贴本仓库地址（或本地解压后的目录）；
3. 在 **个人** 找到「Agnes 图片视频生成」，点击 **安装**；
4. **配置一次（三选一，永久生效）**：
   - **插件详情配置区（推荐）**：设置 → 插件 → 本插件详情 → **配置** 区，填 API Key、Base URL、厂商形态、模型，保存后**完全退出并重开 ZCode** 生效；
   - 运行一次初始化命令 **`/agnes-media:init`**，按引导写入配置文件；
   - 手写配置文件 `~/.agnes-media/config.json` 或设置环境变量 `AGNES_API_KEY` / `AGNES_BASE_URL`；
5. 直接说「画一张赛博朋克城市夜景」或「生成一段 5 秒海浪视频」即可。中途换 Key/换厂商用 `/agnes-media:config` 或改配置区后重启。

> 提示：插件 MCP 服务器在 ZCode 启动时注册——安装/更新插件或改完配置区后，需**完全退出 ZCode（菜单 → 退出）再重开**才生效；可在 **设置 → MCP → Plugin MCP 服务器** 分组确认 `agnes-media` 已出现。

## 配置（无默认值，全部自己填）

按推荐顺序四种方式（实际优先级：调用参数 > 环境变量（含配置区注入）> 配置文件）：

1. **插件详情配置区（推荐）**：设置 → 插件 → 本插件详情 → **配置** 区，可填 6 项：`apiKey`、`baseUrl`、`provider`、`imageModel`、`videoModel`、`saveDir`（生成文件保存目录）。保存后**完全退出并重开 ZCode** 生效（值以环境变量注入 MCP 服务器）；
2. **初始化命令**：`/agnes-media:init` 一次性问清并写入；`/agnes-media:config` 中途修改——写配置文件，**立即生效无需重启**：
   - Windows：`C:\Users\<用户名>\.agnes-media\config.json`
   - macOS/Linux：`~/.agnes-media/config.json`
3. **环境变量**：`AGNES_API_KEY`、`AGNES_BASE_URL`、`AGNES_MEDIA_PROVIDER`、`AGNES_IMAGE_MODEL` / `AGNES_VIDEO_MODEL`（模型链用 `AGNES_IMAGE_MODELS` / `AGNES_VIDEO_MODELS`，逗号分隔）；
4. **一次性参数**：调用时传 `apiKey`/`baseUrl`（会留在对话记录，不推荐）。

配置文件示例（高级字段如模型兜底链 `imageModels`、候选链 `chains`、端点、`saveDir` 都写在这里）：

```json
{
  "provider": "agnes",
  "baseUrl": "https://apihub.agnes-ai.com",
  "apiKey": "sk-你的key",
  "imageModels": ["agnes-image-2.5-flash"],
  "videoModels": ["agnes-video-2.5-flash"]
}
```

Key 申请（Agnes）：<https://platform.agnes-ai.com/> 注册 → API Keys。

### 适配其他厂商

| 形态 | provider | 说明 |
| --- | --- | --- |
| Agnes 官方 | `agnes` | 图生图走 `extra_body.image`，视频查询走 `/agnesapi`；keyframe/reference 视频模式仅此形态 |
| OpenAI 兼容网关 | `openai` | 图片 `response_format` 顶层；视频 `POST /v1/videos` + `GET /v1/videos/{id}` |
| 其他 | `custom` | 端点全手动：`imageEndpoint` / `videoCreateEndpoint` / `videoQueryTemplate`（支持 `{video_id}`、`{model}` 占位符） |

请求形态也可用 `imageApiStyle` 单独覆盖；厂商特有参数用 `imageExtraBody` / `videoExtraBody` 附加。

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

## License

[MIT](LICENSE)
