#!/usr/bin/env node
// Agnes Media MCP Server（零依赖，stdio 传输，换行分隔 JSON-RPC 2.0）
// 工具：generate_image / edit_image / generate_video / video_status / media_config / configure_media
import {
  IMAGE_RATIOS,
  IMAGE_SIZE_TIERS,
  MAX_CHAIN,
  PROVIDERS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_MODES,
  MediaError,
  resolveCandidates,
  maskKey,
  writeConfig,
  generateImage,
  createVideoTask,
  getVideoTask,
  pollVideoTask,
  downloadVideo,
} from "./media-api.mjs";

const SERVER_INFO = { name: "agnes-media", version: "0.4.0" };
const PROTOCOL_VERSION = "2024-11-05";

const ENHANCE_DESC = "true 时先用 chat 模型把提示词扩写成结构化生成提示词（需配置 textModel；失败自动用原提示词）。";

const TOOLS = [
  {
    name: "generate_image",
    description:
      "文生图：根据文本提示词生成图片。返回本地文件路径与下载链接。首次使用需先配置（调用 media_config 检查，缺失时用 configure_media 初始化）。",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "图像生成提示词。建议结构：[主体]+[场景/环境]+[风格]+[光照]+[构图]+[质量要求]。" },
        size: {
          type: "string",
          description: `输出尺寸。Agnes 形态推荐档位 ${IMAGE_SIZE_TIERS.join("/")}（配合 ratio）；OpenAI 兼容形态传精确尺寸如 1024x1024。`,
        },
        ratio: {
          type: "string",
          enum: IMAGE_RATIOS,
          description: "宽高比（Agnes 形态有效；OpenAI 兼容形态会被忽略）。",
        },
        response_format: {
          type: "string",
          enum: ["url", "b64"],
          description: "输出格式。url=先下载再存本地；b64=直接保存 Base64 到本地。两者最终都会写入本地文件。",
        },
        enhance_prompt: { type: "boolean", description: ENHANCE_DESC },
        save_dir: { type: "string", description: "本地保存目录，默认 <当前工作目录>/ZcodeImage。项目场景建议传 <项目根>/ZcodeImage。" },
        file_name: { type: "string", description: "保存文件名（可选，不含路径）。" },
        model: { type: "string", description: "覆盖配置里的图片模型（单次调用）。指定后只用该模型，不走兜底链。" },
        apiKey: { type: "string", description: "一次性覆盖 API Key（会出现在对话记录，不推荐；优先 configure_media 或环境变量）。" },
        baseUrl: { type: "string", description: "一次性覆盖 API Base URL。" },
        provider: { type: "string", enum: PROVIDERS, description: "一次性覆盖厂商预设（agnes/openai/custom）。" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "edit_image",
    description:
      "图生图 / 图片编辑 / 多图合成：基于输入图片（URL 或本地路径）按提示词转换、重绘、风格化编辑，尽量保留原始构图；也可传多张参考图合成新图。是否支持图生图取决于所配置厂商的接口形态。",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "编辑指令。建议结构：[改变要求]+[新风格/场景]+[需要添加或移除的元素]+[需要保留的元素]。多图合成时说明每张参考图的角色。",
        },
        input_images: {
          type: "array",
          items: { type: "string" },
          description: "输入图片数组：公网 http(s) URL、data URI 或本地文件路径（本地路径自动转 Data URI）。至少 1 张。",
        },
        size: { type: "string", description: "输出尺寸（档位或精确尺寸，取决于厂商形态）。" },
        ratio: { type: "string", enum: IMAGE_RATIOS, description: "宽高比（Agnes 形态有效）。" },
        response_format: {
          type: "string",
          enum: ["url", "b64"],
          description: "输出格式，默认 url（下载后存本地）；b64 直接保存 Base64 到本地。",
        },
        enhance_prompt: { type: "boolean", description: ENHANCE_DESC },
        save_dir: { type: "string", description: "本地保存目录，默认 <当前工作目录>/ZcodeImage。" },
        file_name: { type: "string", description: "保存文件名（可选，不含路径）。" },
        model: { type: "string", description: "覆盖配置里的图片模型（单次调用）。指定后不走兜底链。" },
        apiKey: { type: "string", description: "一次性覆盖 API Key（不推荐）。" },
        baseUrl: { type: "string", description: "一次性覆盖 API Base URL。" },
        provider: { type: "string", enum: PROVIDERS, description: "一次性覆盖厂商预设。" },
      },
      required: ["prompt", "input_images"],
    },
  },
  {
    name: "generate_video",
    description:
      "生视频（异步任务）。mode=text 文生视频；keyframe 用首/尾帧图片控制；reference 用最多 5 张参考图（提示词中用 <Picture N> 引用）。wait=false 立即返回 video_id；wait=true 内部轮询直到完成或超时。keyframe/reference 为 Agnes 形态能力，其他厂商支持情况以对方文档为准。",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "视频生成提示词。reference 模式下用 <Picture N> 引用参考图。" },
        mode: { type: "string", enum: VIDEO_MODES, description: "生成模式：text 文生视频 / keyframe 首尾帧 / reference 参考图。默认 text。" },
        seconds: { type: "string", description: '时长（秒），字符串 "4"~"12"；不传则由厂商默认。' },
        size: { type: "string", description: '分辨率。Agnes Flash 为 "720P"；OpenAI 兼容形态传精确尺寸如 1280x720。不传由厂商默认。' },
        aspect_ratio: {
          type: "string",
          enum: VIDEO_ASPECT_RATIOS,
          description: "宽高比（Agnes 形态有效）。",
        },
        seed: { type: "integer", description: "随机种子（可选）。" },
        first_frame: { type: "string", description: "keyframe 模式：首帧图片 URL 或本地路径。" },
        last_frame: { type: "string", description: "keyframe 模式：尾帧图片 URL 或本地路径。" },
        images: {
          type: "array",
          items: { type: "string" },
          description: "reference 模式：参考图 URL 或本地路径，最多 5 张。",
        },
        audios: {
          type: "array",
          items: { type: "string" },
          description: "reference 模式：参考音频 URL，最多 3 段（提示词中用 <Audio N> 引用）。",
        },
        enhance_prompt: { type: "boolean", description: ENHANCE_DESC },
        wait: { type: "boolean", description: "是否等待任务完成。true=轮询直到完成/失败/超时；false=立即返回 video_id。默认 false。" },
        poll_timeout_ms: { type: "integer", description: "wait=true 时的最长轮询时间（毫秒），默认 300000。" },
        download: { type: "boolean", description: "完成后是否把视频下载到本地，默认 false（仅返回链接）。" },
        save_dir: { type: "string", description: "download=true 时的保存目录，默认 <当前工作目录>/ZcodeImage。" },
        model: { type: "string", description: "覆盖配置里的视频模型（单次调用）。指定后不走兜底链。" },
        apiKey: { type: "string", description: "一次性覆盖 API Key（不推荐）。" },
        baseUrl: { type: "string", description: "一次性覆盖 API Base URL。" },
        provider: { type: "string", enum: PROVIDERS, description: "一次性覆盖厂商预设。" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "video_status",
    description: "查询视频生成任务状态与进度。status 为 completed 时返回可下载的 url；failed 时返回错误信息。",
    inputSchema: {
      type: "object",
      properties: {
        video_id: { type: "string", description: "generate_video 返回的任务 ID。" },
        model: { type: "string", description: "覆盖视频模型（单次查询）。指定后不走兜底链。" },
        apiKey: { type: "string", description: "一次性覆盖 API Key（不推荐）。" },
        baseUrl: { type: "string", description: "一次性覆盖 API Base URL。" },
        provider: { type: "string", enum: PROVIDERS, description: "一次性覆盖厂商预设。" },
      },
      required: ["video_id"],
    },
  },
  {
    name: "media_config",
    description:
      "查看当前配置状态：API Key 是否已配置（脱敏）、Base URL、provider 预设、请求形态、各端点、模型链、候选链（chains）、缺失项与配置文件路径。不返回完整 Key。",
    inputSchema: {
      type: "object",
      properties: {
        apiKey: { type: "string", description: "可选：检查某个一次性 Key 的解析结果（仅显示脱敏）。" },
        baseUrl: { type: "string", description: "可选：检查某个一次性 Base URL 的解析结果。" },
      },
    },
  },
  {
    name: "configure_media",
    description:
      "写入/更新配置文件（初始化配置与中途修改都用它）。可设置 apiKey、baseUrl、provider（agnes/openai/custom）、模型与模型链、请求形态与端点、提示词增强模型；也支持 chains 候选链（跨厂商整体切换）、unset 移除某项、reset 清空重来。配置立即生效（下次调用读取）。注意：通过对话传入的 apiKey 会出现在记录中，介意的话请让用户手写配置文件或改用环境变量。",
    inputSchema: {
      type: "object",
      properties: {
        apiKey: { type: "string", description: "API Key（写入用户级配置文件）。" },
        baseUrl: { type: "string", description: "API Base URL，如 https://apihub.agnes-ai.com 或其他厂商地址。" },
        provider: {
          type: "string",
          enum: PROVIDERS,
          description: "厂商预设：agnes=Agnes 官方形态；openai=OpenAI 兼容形态；custom=端点全手动。设置后可用下面的端点参数覆盖。",
        },
        imageModel: { type: "string", description: "图片模型名（单个）。需要兜底时改用 imageModels。" },
        videoModel: { type: "string", description: "视频模型名（单个）。需要兜底时改用 videoModels。" },
        imageModels: {
          type: "array",
          items: { type: "string" },
          description: "图片模型兜底链，优先级从高到低，最多 3 个（第 2/3 个可选）。第一个遇 429/5xx/超时/不通/404 自动切下一个。",
        },
        videoModels: {
          type: "array",
          items: { type: "string" },
          description: "视频模型兜底链，优先级从高到低，最多 3 个（第 2/3 个可选）。",
        },
        imageApiStyle: {
          type: "string",
          enum: ["agnes", "openai"],
          description: "图片请求形态：agnes=extra_body/return_base64 风格；openai=顶层 response_format 风格。",
        },
        imageEndpoint: { type: "string", description: "图片生成端点路径，默认按 provider 预设（如 /v1/images/generations）。" },
        videoCreateEndpoint: { type: "string", description: "视频创建端点路径，默认按 provider 预设（如 /v1/videos）。" },
        videoQueryTemplate: {
          type: "string",
          description:
            "视频查询端点模板，支持 {video_id} 与 {model} 占位符。Agnes 预设：/agnesapi?video_id={video_id}&model_name={model}；OpenAI 预设：/v1/videos/{video_id}。",
        },
        chatEndpoint: { type: "string", description: "chat 补全端点路径（enhance_prompt 用），默认 /v1/chat/completions。" },
        textModel: { type: "string", description: "提示词增强所用 chat 模型名（配了之后 generate_* 才可用 enhance_prompt）。" },
        imageExtraBody: { type: "object", description: "图片请求额外附加字段（JSON 对象，厂商特有参数）。" },
        videoExtraBody: { type: "object", description: "视频请求额外附加字段（JSON 对象，厂商特有参数）。" },
        chains: {
          type: "array",
          items: { type: "object" },
          description:
            "候选链（最多 3 个，跨厂商整体容灾）：每项可覆盖 baseUrl/apiKey/provider/imageModels/videoModels/各端点等；第一项失败（429/5xx/超时/不通/404）时整体切到下一项（地址+Key+模型一起换）。例：[{\"provider\":\"agnes\",\"baseUrl\":\"...\",\"apiKey\":\"...\",\"imageModels\":[\"...\"]},{\"provider\":\"openai\",\"baseUrl\":\"...\",\"apiKey\":\"...\",\"imageModels\":[\"...\"]}]",
        },
        saveDir: { type: "string", description: "生成文件默认保存目录（绝对路径）。" },
        unset: {
          type: "array",
          items: { type: "string" },
          description: "要移除的配置键，如 [\"saveDir\"]。",
        },
        reset: { type: "boolean", description: "true=先清空现有配置再写入（慎用）。" },
      },
    },
  },
];

function toolResult(text) {
  return { content: [{ type: "text", text }] };
}

function errorResult(err) {
  const lines = [`❌ ${err.message}`];
  if (err.hint) lines.push("", err.hint);
  return { content: [{ type: "text", text: lines.join("\n") }], isError: true };
}

function formatModelChain(chain, source) {
  if (!chain || chain.length === 0) return "未配置";
  const label = chain.length > 1 ? `（兜底链 ${chain.length} 个）` : "";
  return `${chain.join(" → ")}${label}（来源：${source}）`;
}

function formatCandidateLine(cfg, index) {
  const parts = [`#${index + 1}`, cfg.baseUrl || "(无 baseUrl)"];
  parts.push(`key=${cfg.apiKey ? maskKey(cfg.apiKey) : "无"}`);
  parts.push(`provider=${cfg.provider || "custom"}`);
  parts.push(`图片=${cfg.imageModels.join("/") || "未配"}`);
  parts.push(`视频=${cfg.videoModels.join("/") || "未配"}`);
  return parts.join(" · ");
}

function formatConfigStatus(candidates) {
  const cfg = candidates[0];
  const lines = ["Agnes Media 配置状态", ""];
  lines.push(`- 候选链：共 ${candidates.length} 项（最多 ${MAX_CHAIN} 项；失败时按顺序整体切换）`);
  candidates.forEach((c, i) => lines.push(`  - ${formatCandidateLine(c, i)}`));
  lines.push(`- 图片请求形态：${cfg.imageApiStyle}（来源：${cfg.imageApiStyleSource}）`);
  lines.push(`- 图片端点：${cfg.imageEndpoint}`);
  lines.push(`- 视频创建端点：${cfg.videoCreateEndpoint}`);
  lines.push(`- 视频查询模板：${cfg.videoQueryTemplate}`);
  if (cfg.textModel) lines.push(`- 提示词增强模型：${cfg.textModel}（chat 端点：${cfg.chatEndpoint}）`);
  else lines.push("- 提示词增强模型：未配置（enhance_prompt 不可用）");
  if (cfg.saveDir) lines.push(`- 默认保存目录：${cfg.saveDir}`);
  lines.push(`- 配置文件路径：${cfg.configPath}${cfg.configFile.exists ? "（存在）" : "（不存在）"}`);
  if (cfg.configFile.error) lines.push(`- 配置文件错误：${cfg.configFile.error}`);
  if (candidates.length === 1 && cfg.missing.length > 0) {
    lines.push("", `⚠️ 配置不完整，缺少：${cfg.missing.join("、")}`);
    lines.push("请调用 configure_media 完成初始化（provider/baseUrl/apiKey/imageModel/videoModel），或让用户手写配置文件/设置环境变量。");
  }
  return lines.join("\n");
}

function formatFallback(attempts) {
  if (!Array.isArray(attempts) || attempts.length < 2) return null;
  const parts = attempts.map((a) => `${a.chain}/${a.model}${a.ok ? " ✅" : ` ❌${a.status ? `(HTTP ${a.status})` : ""}`}`);
  return `- 切换记录：${parts.join(" → ")}`;
}

function formatImageResult(r) {
  const lines = ["✅ 图片生成成功", ""];
  lines.push(`- 模型：${r.model}（size=${r.size}，ratio=${r.ratio}，形态=${r.style}）`);
  if (r.input_count > 0) lines.push(`- 输入参考图：${r.input_count} 张`);
  const fb = formatFallback(r.attempts);
  if (fb) lines.push(fb);
  if (r.enhanced) {
    lines.push(`- 提示词已增强：${r.final_prompt}`);
  } else if (r.enhance_note) {
    lines.push(`- 提示词增强：${r.enhance_note}`);
  }
  lines.push(`- 本地文件：${r.saved_path}`);
  lines.push(`- 文件大小：${r.bytes} 字节`);
  if (r.url) lines.push(`- 下载链接：${r.url}（链接有时效，请及时使用）`);
  if (r.revised_prompt) lines.push(`- 修订后提示词：${r.revised_prompt}`);
  lines.push("", "提示：请用 Read 工具读取本地文件，让图片直接显示在对话中。");
  return lines.join("\n");
}

function formatVideoTask(r) {
  const lines = ["✅ 视频任务已创建", ""];
  lines.push(`- video_id：${r.video_id}`);
  lines.push(`- 模型：${r.model}（mode=${r.mode}，seconds=${r.seconds}，size=${r.size}，aspect_ratio=${r.aspect_ratio}）`);
  const fb = formatFallback(r.attempts);
  if (fb) lines.push(fb);
  if (r.enhanced) {
    lines.push(`- 提示词已增强：${r.final_prompt}`);
  } else if (r.enhance_note) {
    lines.push(`- 提示词增强：${r.enhance_note}`);
  }
  lines.push("", "任务为异步执行，可调用 video_status 查询进度；status=completed 时即可拿到下载链接。");
  return lines.join("\n");
}

function formatVideoStatus(s) {
  const status = String(s.status || "unknown").toLowerCase();
  const lines = [`视频任务状态：${status}`];
  if (s.progress !== undefined && s.progress !== null) lines.push(`- 进度：${s.progress}%`);
  if (s.id) lines.push(`- video_id：${s.id}`);
  const fb = formatFallback(s.attempts);
  if (fb) lines.push(fb);
  if (status === "completed" && s.url) lines.push(`- 下载链接：${s.url}（链接有时效，请及时使用）`);
  if (status === "failed") {
    lines.push(`- 失败原因：${s.error || "(未提供)"}`);
  }
  if (s._timeout) lines.push(`- ${s._message}`);
  return lines.join("\n");
}

async function callTool(name, args) {
  const candidates = resolveCandidates(args);

  switch (name) {
    case "media_config": {
      return toolResult(formatConfigStatus(candidates));
    }

    case "configure_media": {
      const { reset, unset, ...values } = args || {};
      const result = writeConfig(values, { reset: reset === true, unset });
      const after = resolveCandidates({});
      const lines = [
        "✅ 配置已写入",
        `- 配置文件：${result.path}`,
        "",
        formatConfigStatus(after),
        "",
        "配置已生效（下次调用读取）。如需修改，随时再次调用 configure_media。",
      ];
      return toolResult(lines.join("\n"));
    }

    case "generate_image": {
      const r = await generateImage(candidates, args);
      return toolResult(formatImageResult(r));
    }

    case "edit_image": {
      const inputs = Array.isArray(args.input_images) ? args.input_images.filter(Boolean) : [];
      if (inputs.length === 0) throw new MediaError("input_images 至少需要 1 张图片（URL 或本地路径）。");
      const r = await generateImage(candidates, { ...args, input_images: inputs });
      return toolResult(formatImageResult(r));
    }

    case "generate_video": {
      const task = await createVideoTask(candidates, args);
      if (args.wait !== true) {
        return toolResult(formatVideoTask(task));
      }
      const timeoutMs = Number(args.poll_timeout_ms) > 0 ? Number(args.poll_timeout_ms) : 300000;
      const final = await pollVideoTask(candidates, task.video_id, task.model, { timeoutMs });
      const lines = [formatVideoStatus(final)];
      if (String(final.status || "").toLowerCase() === "completed" && args.download === true && final.url) {
        try {
          const dl = await downloadVideo(candidates[0], final.url, args.save_dir, `agnes-video-${task.video_id}.mp4`);
          lines.push(`- 本地文件：${dl.saved_path}（${dl.bytes} 字节）`);
        } catch (err) {
          lines.push(`- 下载到本地失败：${err.message}`);
        }
      }
      return toolResult(lines.join("\n"));
    }

    case "video_status": {
      const s = await getVideoTask(candidates, args.video_id, args.model);
      return toolResult(formatVideoStatus(s));
    }

    default:
      throw new MediaError(`未知工具：${name}`);
  }
}

function sendMessage(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function sendResult(id, result) {
  sendMessage({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  sendMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  try {
    switch (method) {
      case "initialize":
        sendResult(id, {
          protocolVersion: (params && params.protocolVersion) || PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
        return;
      case "ping":
        sendResult(id, {});
        return;
      case "tools/list":
        sendResult(id, { tools: TOOLS, nextCursor: null });
        return;
      case "prompts/list":
        sendResult(id, { prompts: [], nextCursor: null });
        return;
      case "resources/list":
        sendResult(id, { resources: [], nextCursor: null });
        return;
      case "tools/call": {
        const toolName = params && params.name;
        const toolArgs = (params && params.arguments) || {};
        try {
          const result = await callTool(toolName, toolArgs);
          sendResult(id, result);
        } catch (err) {
          sendResult(id, errorResult(err instanceof Error ? err : new Error(String(err))));
        }
        return;
      }
      default:
        sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    sendError(id, -32603, `Internal error: ${err && err.message ? err.message : String(err)}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      sendError(null, -32700, "Parse error");
      continue;
    }
    // 通知（无 id）不响应
    if (msg.id === undefined || msg.id === null) continue;
    handleRequest(msg);
  }
});
process.stdin.on("end", () => process.exit(0));

function log(...args) {
  process.stderr.write(`[agnes-media] ${args.join(" ")}\n`);
}
log(`server started (${SERVER_INFO.name} ${SERVER_INFO.version})`);
