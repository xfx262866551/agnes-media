---
name: agnes-media
description: 生成图片与视频（文生图、图生图、图片编辑、多图合成、文生视频/关键帧/参考视频）。当用户要求生成/绘制/创作/编辑图片或生成视频时使用。插件不内置默认 baseUrl/apiKey/模型：首次使用需引导用户完成初始化配置（configure_media），中途可随时修改，支持 Agnes 及 OpenAI 兼容等其他厂商。
---

# Agnes Media：图片与视频生成

通过 MCP 工具调用图片/视频生成接口。**本插件没有任何内置默认 baseUrl、apiKey、模型**——所有连接信息由用户配置提供，配置一次后长期生效，中途可改。

## 第一次使用：初始化配置（一次性，三选一）

配置一次永久生效，按推荐顺序：

1. **插件详情配置区（官方机制，最简单）**：设置 → 插件 → 「Agnes 图片视频生成」→ 详情 → **配置** 区，填写 API Key、Base URL（Agnes 官方为 `https://apihub.agnes-ai.com`）、厂商形态、模型，保存后**完全退出并重开 ZCode** 生效。配置区的值会以环境变量注入 MCP 服务器，优先级高于配置文件。
2. **初始化命令**：`/agnes-media:init`——`media_config` 查缺失 → 一次性问清 → `configure_media` 写入配置文件。
3. **配置文件 / 环境变量**：手写 `~/.agnes-media/config.json`（Windows：`C:\Users\<用户名>\.agnes-media\config.json`）或设置 `AGNES_API_KEY` / `AGNES_BASE_URL`。

若用户不用命令、直接要求生成图片/视频且配置缺失，按上述顺序就地引导，不要反复重试生成工具。

## 中途修改配置

用户说"换 Key / 换地址 / 换模型 / 换厂商"时：引导运行 **`/agnes-media:config`** 命令，或直接再次调用 `configure_media`（只传要改的字段，增量合并）；支持 `unset:["字段"]` 移除某项、`reset:true` 清空重来。改完用 `media_config` 回读确认。

## 适配其他厂商

| 厂商形态 | provider | 说明 |
| - | - | - |
| Agnes 官方 | `agnes` | 图生图走 `extra_body.image`，视频查询走 `/agnesapi?video_id=...&model_name=...`；keyframe/reference 视频模式仅此形态支持 |
| OpenAI 兼容网关 | `openai` | 图片 `response_format` 顶层；视频创建 `POST /v1/videos`、查询 `GET /v1/videos/{id}` |
| 其他 | `custom` | 端点全部手动指定：`imageEndpoint` / `videoCreateEndpoint` / `videoQueryTemplate`（支持 `{video_id}`、`{model}` 占位符） |

- 请求形态也可用 `imageApiStyle`（agnes/openai）单独覆盖。
- 厂商特有参数用 `imageExtraBody` / `videoExtraBody`（JSON 对象）附加到请求体。
- 参数名（prompt/size/seconds/aspect_ratio/mode/first_frame/images 等）按 Agnes 文档形态发送；其他厂商参数名不同时，用 extraBody 补充或如实告知用户该参数对方不支持。

## 模型兜底（最多 3 个，第 2/3 个可选）

配置 `imageModels` / `videoModels` 数组（优先级从高到低），或初始化时通过 `configure_media` 传入。生效规则：

- 第一个模型遇到 **429 限流、5xx、请求超时、网络不通、404（模型/端点不存在）** 时，自动切换下一个模型重试；
- 最多尝试 3 个；只配 1 个也能正常工作（不强制第 2/3 个）；
- **400 参数错误、401/403 Key 无效**等不可重试错误立即失败，不切换（换了也没用）；
- 工具参数 `model` 显式指定时只用该模型，不走兜底；
- 视频查询（`video_status`）也会按链尝试——查询地址带模型名，必须与创建时成功的模型一致；
- 发生切换时结果里带「切换记录」，如实转告用户。

## 候选链 chains（跨厂商整体容灾，最多 3 项）

模型链只在同一地址+Key 下换模型；要**换厂商**（比如 Agnes 挂了切智谱/其他中转）用 `chains`：每一项可整体覆盖 `baseUrl`/`apiKey`/`provider`/`imageModels`/`videoModels`/各端点，第一项失败（429/5xx/超时/不通/404）时**地址+Key+模型一起切**到下一项。第 2/3 项可选。

```json
{
  "chains": [
    { "provider": "agnes", "baseUrl": "https://apihub.agnes-ai.com", "apiKey": "sk-agnes", "imageModels": ["agnes-image-2.5-flash"], "videoModels": ["agnes-video-2.5-flash"] },
    { "provider": "openai", "baseUrl": "https://open.bigmodel.cn/api/paas/v4", "apiKey": "zhipu-key", "imageModels": ["cogview-3-flash"], "videoModels": ["cogvideox-flash"] }
  ]
}
```

通过 `configure_media` 的 `chains` 参数（对象数组）写入，或手写配置文件。

## 提示词增强 enhance_prompt（可选）

配置 `textModel`（chat 模型名，走 `chatEndpoint`，默认 `/v1/chat/completions`）后，生成工具可传 `enhance_prompt: true`：先用 chat 模型把简短描述扩写成 `[主体]+[场景]+[风格]+[光照]+[构图]+[质量]` 结构化提示词再生成。增强失败（未配模型/接口报错）自动用原提示词，并在结果里注明，不阻塞生成。

## 工具选择

| 用户需求 | 工具 |
| - | --- |
| 文字描述生成新图片 | `generate_image` |
| 基于一张图改造/换风格/改颜色/编辑 | `edit_image`（传 1 张 `input_images`） |
| 多张图合成一张新图 | `edit_image`（传多张，提示词说明每张图角色） |
| 文字生成视频 | `generate_video`（mode=text） |
| 用首帧/尾帧图片生成视频 | `generate_video`（mode=keyframe） |
| 用参考图生成视频 | `generate_video`（mode=reference，提示词用 `<Picture N>` 引用） |
| 查询视频任务进度 | `video_status` |
| 查看/修改配置 | `media_config` / `configure_media` |

## 图片参数要点

- `size`：Agnes 形态用档位 `1K/2K/3K/4K` + `ratio`；OpenAI 兼容形态传精确尺寸（如 `1024x1024`），`ratio` 会被忽略。
- Agnes 形态常用组合：1:1→1024x1024(1K)/2048x2048(2K)；16:9→1312x736(1K)/2624x1472(2K)；9:16→736x1312(1K)/1472x2624(2K)。
- 用户要 1920x1080/2560x1440 时：Agnes 形态请求 `size=2K`+`ratio=16:9`（得 2624x1472）再下游裁剪，不要直接请求不支持的精确尺寸。
- `input_images` 支持公网 URL、本地路径（自动转 Data URI）、data URI。本地图片不可公网访问时优先传本地路径。
- `response_format`：默认 `url`（下载后存本地）；`b64` 直接保存 Base64。两者都落本地文件。

## 提示词结构

- 文生图：`[主体]+[场景/环境]+[风格]+[光照]+[构图]+[质量要求]`
- 图生图/编辑：`[改变要求]+[新风格/场景]+[需要添加或移除的元素]+[需要保留的元素]`（要保留构图就明确写"保留原始构图/主体布局/相机角度"）
- 多图合成：每张参考图的角色 + 目标场景 + 图像间关系 + 风格/光照/构图
- 视频：动作、镜头运动、节奏、氛围；reference 模式用 `<Picture 1>`、`<Picture 2>` 引用

## 视频参数要点

- `mode`：`text`（默认）/ `keyframe` / `reference`（后两者为 Agnes 形态能力）。
- `seconds`：字符串 `"4"`~`"12"`，不传由厂商默认。
- `size`：Agnes Flash 为 `"720P"`；OpenAI 兼容形态传精确尺寸。
- `aspect_ratio`：`21:9`/`16:9`/`4:3`/`1:1`/`3:4`/`9:16`（Agnes 形态）。
- `keyframe`：至少传 `first_frame` 或 `last_frame` 之一。`reference`：`images`≤5、`audios`≤3，至少一项非空。
- **异步流程**：`generate_video` 默认 `wait=false` 立即返回 `video_id`。之后用 `video_status` 轮询（间隔约 2 秒，最多约 5 分钟），或首次调用就 `wait=true`（可配 `poll_timeout_ms`）。`status=completed` 读 `url`；`failed` 如实转告原因。

## 输出与展示规范（必须遵守）

1. **保存位置**：默认存 `<当前工作目录>/ZcodeImage`。请求绑定具体项目时传 `save_dir=<项目根目录>/ZcodeImage`；无法确定项目根时先问用户存哪个项目，不要静默落到非项目目录。
2. **图片展示**：成功后立即用 Read 工具读取返回的本地文件路径，让图片直接显示在对话中，并把本地路径告知用户。
3. **视频展示**：把 `url` 作为下载链接给用户（Markdown 链接），说明链接有时效；不要反复打印旧链接，需要时重新 `video_status` 取新链接。用户要本地文件时用 `download=true`。
4. **失败处理**：如实转告工具返回的错误（HTTP 状态、detail），不编造原因；配置类错误先用 `media_config` 核实，引导走 `configure_media`。
