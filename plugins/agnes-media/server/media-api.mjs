// Agnes Media API 客户端（零依赖，Node 18+，使用全局 fetch）
// 支持文生图、图生图/图片编辑、多图合成、文生视频/关键帧/参考视频。
// 通过 provider 预设 + 配置项适配 Agnes 及 OpenAI 兼容形态的其他厂商；
// 不内置任何默认 baseUrl / apiKey / 模型，全部由用户配置提供。
// 兜底：候选链（chains，可整体切换 baseUrl+key+模型，跨厂商容灾）× 模型链（imageModels/videoModels，最多 3 个）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

const DEFAULT_CONFIG_PATH = join(homedir(), ".agnes-media", "config.json");

// 厂商预设：只定义"接口形态"（端点与请求风格），不定义任何凭据或地址。
const PROVIDER_PRESETS = {
  agnes: {
    label: "Agnes（官方形态，图生图用 extra_body.image，视频查询用 /agnesapi）",
    imageApiStyle: "agnes",
    imageEndpoint: "/v1/images/generations",
    videoCreateEndpoint: "/v1/videos",
    videoQueryTemplate: "/agnesapi?video_id={video_id}&model_name={model}",
  },
  openai: {
    label: "OpenAI 兼容形态（顶层 response_format，视频查询 GET /v1/videos/{id}）",
    imageApiStyle: "openai",
    imageEndpoint: "/v1/images/generations",
    videoCreateEndpoint: "/v1/videos",
    videoQueryTemplate: "/v1/videos/{video_id}",
  },
  custom: {
    label: "自定义（端点全部手动指定，请求体按 openai 兼容形态）",
    imageApiStyle: "openai",
    imageEndpoint: "/v1/images/generations",
    videoCreateEndpoint: "/v1/videos",
    videoQueryTemplate: "/v1/videos/{video_id}",
  },
};

// 结构性兜底端点（OpenAI 兼容最常见形态），仅当配置与预设都未指定时使用；
// 这不是"默认厂商地址"，baseUrl / apiKey / 模型均无默认值。
const FALLBACK_ENDPOINTS = {
  imageEndpoint: "/v1/images/generations",
  videoCreateEndpoint: "/v1/videos",
  videoQueryTemplate: "/v1/videos/{video_id}",
  chatEndpoint: "/v1/chat/completions",
};

export const IMAGE_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"];
export const IMAGE_SIZE_TIERS = ["1K", "2K", "3K", "4K"];
export const VIDEO_ASPECT_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
export const VIDEO_MODES = ["text", "keyframe", "reference"];
export const PROVIDERS = Object.keys(PROVIDER_PRESETS);
export const MAX_CHAIN = 3;

// 可通过配置文件写入的键（configure_media 与文档共用）
export const CONFIG_KEYS = [
  "apiKey",
  "baseUrl",
  "provider",
  "imageModel",
  "videoModel",
  "imageModels",
  "videoModels",
  "imageApiStyle",
  "imageEndpoint",
  "videoCreateEndpoint",
  "videoQueryTemplate",
  "chatEndpoint",
  "textModel",
  "imageExtraBody",
  "videoExtraBody",
  "chains",
  "image",
  "video",
  "saveDir",
];

// 候选链单项允许覆盖的键（chains 数组里每一项可用这些键）
const CHAIN_ENTRY_KEYS = CONFIG_KEYS.filter((k) => k !== "chains");

const IMAGE_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

const EXT_BY_CONTENT_TYPE = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "video/mp4": ".mp4",
};

export class MediaError extends Error {
  constructor(message, hint, meta = {}) {
    super(message);
    this.name = "MediaError";
    this.hint = hint || null;
    this.status = meta.status || null; // HTTP 状态码；网络类错误为 null
    this.kind = meta.kind || null; // http | network | timeout | validation
  }
}

// 可重试（切换到兜底）的错误：限流 429、5xx、超时、网络不通、404（端点/模型不存在）
const RETRYABLE_HTTP_STATUS = new Set([404, 408, 409, 425, 429, 500, 502, 503, 504]);

export function isRetryableError(err) {
  if (!(err instanceof MediaError)) return false;
  if (err.kind === "network" || err.kind === "timeout") return true;
  if (err.kind === "http" && err.status !== null) return RETRYABLE_HTTP_STATUS.has(err.status);
  return false;
}

function fallbackError(attempts) {
  const detail = attempts
    .map((a) => `${a.chain || "#1"}/${a.model}${a.status ? `（HTTP ${a.status}）` : ""}：${a.error}`)
    .join("；");
  return new MediaError(`所有候选均调用失败（共 ${attempts.length} 次尝试）：${detail}`);
}

function attachAttempts(err, attempts) {
  const history = attempts
    .map((a) => `${a.chain || "#1"}/${a.model}${a.status ? `（HTTP ${a.status}）` : ""}：${a.error}`)
    .join("；");
  err.hint = (err.hint ? err.hint + "\n" : "") + `尝试记录：${history}`;
  return err;
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// 环境变量守卫：插件 userConfig 未填写时，MCP env 里可能残留未解析的 ${user_config.x} 占位符，视为未设置
function cleanEnv(value) {
  const v = String(value || "").trim();
  if (!v || v.includes("${")) return "";
  return v;
}

// 模型链：数组或逗号分隔字符串，按优先级去重，最多 3 个（第 2/3 个不强制）
function modelChain(...candidates) {
  const out = [];
  for (const c of candidates) {
    const list = Array.isArray(c) ? c : splitList(c);
    for (const m of list) {
      const v = String(m || "").trim();
      if (v && !out.includes(v)) out.push(v);
    }
  }
  return out.slice(0, MAX_CHAIN);
}

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

export function firstNonEmpty(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

// 请求 URL 安全校验：仅允许 http/https，且拒绝 localhost / 回环 / 私有 / 保留地址（防 SSRF）
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^(0|10)\.\d+\.\d+\.\d+$/, // 0.0.0.0/8 段兜底
  /^\[?::1\]?$/i,
  /^\[?fc[0-9a-f]{2}:/i,
  /^\[?fd[0-9a-f]{2}:/i,
  /^\[?fe[89ab][0-9a-f]:/i,
];

export function validateRequestUrl(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl || ""));
  } catch {
    throw new MediaError(`非法 URL：${rawUrl}`, "Base URL / 端点必须是完整地址，如 https://host/path。");
  }
  if (!/^https?:$/i.test(u.protocol)) {
    throw new MediaError(`不支持的协议：${u.protocol}`, "仅允许 http/https。");
  }
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(host))) {
    throw new MediaError(
      `出于安全限制，拒绝请求本机/内网/保留地址：${host}`,
      "请把 Base URL 指向公网可访问的厂商接口；如确需本地网关，请用用户级 MCP 配置自行封装。"
    );
  }
  return u;
}

export function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

// 用户常把 /v1 一起粘进 Base URL（如 https://host/v1），而内置端点以 /v1/ 开头；
// 拼接时去重，两种写法都兼容，避免出现 /v1/v1/...
export function joinEndpoint(baseUrl, endpoint) {
  const base = String(baseUrl || "");
  const path = String(endpoint || "");
  if (/\/v1$/i.test(base) && /^\/v1\//i.test(path)) {
    return base.slice(0, -3) + path;
  }
  return base + path;
}

export function maskKey(key) {
  if (!key) return null;
  if (key.length <= 8) return "****";
  return `${key.slice(0, 3)}****${key.slice(-4)}`;
}

function readConfigFile(configPath) {
  const result = { path: configPath, exists: false, data: {}, error: null };
  try {
    if (!existsSync(configPath)) return result;
    result.exists = true;
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (isPlainObject(parsed)) result.data = parsed;
    else result.error = "配置文件不是 JSON 对象";
  } catch (err) {
    result.error = `配置文件解析失败：${err.message}`;
  }
  return result;
}

// 参数为「值, 来源标签」交替的扁平列表，返回第一个非空值及其来源
function pickSource(...flat) {
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const value = flat[i];
    const label = flat[i + 1];
    if (typeof value === "string" && value.trim()) return { value: value.trim(), source: label };
  }
  return { value: "", source: "none" };
}

// 分域配置：配置文件可写 image / video 子对象，分别为图片/视频指定独立厂商（baseUrl/key/模型/端点）；
// 顶层字段作为两者的共同默认。这里把对应域的子对象叠加到默认配置上。
const SCOPE_KEYS = {
  image: ["provider", "baseUrl", "apiKey", "imageApiStyle", "imageModel", "imageModels", "imageEndpoint", "imageExtraBody", "saveDir"],
  video: ["provider", "baseUrl", "apiKey", "videoModel", "videoModels", "videoCreateEndpoint", "videoQueryTemplate", "videoExtraBody", "saveDir"],
};

function applyScope(data, kind) {
  if (!kind || !isPlainObject(data[kind])) return data;
  const overlay = {};
  for (const key of SCOPE_KEYS[kind] || []) {
    if (data[kind][key] !== undefined) overlay[key] = data[kind][key];
  }
  return { ...data, ...overlay };
}

// 配置优先级：调用参数 > 环境变量 > 配置文件（含 image/video 分域覆盖）> provider 预设/结构性兜底
export function resolveConfig(params = {}, kind = null) {
  const configPath = firstNonEmpty(process.env.AGNES_MEDIA_CONFIG) || DEFAULT_CONFIG_PATH;
  const file = readConfigFile(configPath);
  const env = process.env;
  const data = applyScope(file.data, kind);

  const apiKey = pickSource(params.apiKey, "param", cleanEnv(env.AGNES_API_KEY), "env", cleanEnv(env.AGNES_MEDIA_API_KEY), "env", data.apiKey, "file");
  const baseUrlPick = pickSource(
    params.baseUrl,
    "param",
    cleanEnv(env.AGNES_BASE_URL),
    "env",
    cleanEnv(env.AGNES_MEDIA_BASE_URL),
    "env",
    data.baseUrl,
    "file"
  );

  const providerPick = pickSource(params.provider, "param", cleanEnv(env.AGNES_MEDIA_PROVIDER), "env", data.provider, "file");
  // 厂商形态自动推断：用户无需理解"provider"——Agnes 域名自动判 agnes，其余按 openai 兼容
  const providerExplicit = PROVIDERS.includes(providerPick.value) ? providerPick.value : "";
  let provider = providerExplicit;
  let providerSource = providerPick.source;
  if (!provider) {
    provider = /agnes-ai\.com|agnesapi/i.test(normalizeBaseUrl(baseUrlPick.value)) ? "agnes" : "openai";
    providerSource = "inferred";
  }
  const preset = PROVIDER_PRESETS[provider];

  // 模型兜底链（最多 3 个）：调用参数 > 环境变量 > 配置文件；单值 imageModel/videoModel 视为链首。
  // _noEnvImageModels/_noEnvVideoModels：候选链条目显式指定模型时，不让配置区注入的 env 模型混入该候选
  const envImageModels = params._noEnvImageModels === true ? "" : cleanEnv(env.AGNES_IMAGE_MODELS) || cleanEnv(env.AGNES_IMAGE_MODEL);
  const envVideoModels = params._noEnvVideoModels === true ? "" : cleanEnv(env.AGNES_VIDEO_MODELS) || cleanEnv(env.AGNES_VIDEO_MODEL);
  const imageModels = modelChain(params.imageModels, params.imageModel, envImageModels, data.imageModels, data.imageModel);
  const videoModels = modelChain(params.videoModels, params.videoModel, envVideoModels, data.videoModels, data.videoModel);
  const imageModelPick = pickSource(imageModels[0], imageModels.length ? (data.imageModels || data.imageModel ? "file" : "env/param") : "none");
  const videoModelPick = pickSource(videoModels[0], videoModels.length ? (data.videoModels || data.videoModel ? "file" : "env/param") : "none");

  const imageApiStylePick = pickSource(params.imageApiStyle, "param", data.imageApiStyle, "file", preset && preset.imageApiStyle, "preset");
  const imageApiStyle = imageApiStylePick.value === "agnes" ? "agnes" : imageApiStylePick.value === "openai" ? "openai" : "";

  const imageEndpoint = firstNonEmpty(params.imageEndpoint, data.imageEndpoint, preset && preset.imageEndpoint) || FALLBACK_ENDPOINTS.imageEndpoint;
  const videoCreateEndpoint =
    firstNonEmpty(params.videoCreateEndpoint, data.videoCreateEndpoint, preset && preset.videoCreateEndpoint) ||
    FALLBACK_ENDPOINTS.videoCreateEndpoint;
  const videoQueryTemplate =
    firstNonEmpty(params.videoQueryTemplate, data.videoQueryTemplate, preset && preset.videoQueryTemplate) ||
    FALLBACK_ENDPOINTS.videoQueryTemplate;
  const chatEndpoint = firstNonEmpty(params.chatEndpoint, data.chatEndpoint) || FALLBACK_ENDPOINTS.chatEndpoint;
  const textModel = pickSource(params.textModel, "param", data.textModel, "file");

  const saveDir = pickSource(params.saveDir, "param", cleanEnv(env.AGNES_MEDIA_SAVE_DIR), "env", data.saveDir, "file");

  // 未配置的必填项（baseUrl / apiKey / 模型无默认值，必须由用户提供）
  const missing = [];
  if (!apiKey.value) missing.push("apiKey");
  if (!normalizeBaseUrl(baseUrlPick.value)) missing.push("baseUrl");
  if (imageModels.length === 0) missing.push("imageModel");
  if (videoModels.length === 0) missing.push("videoModel");

  return {
    apiKey: apiKey.value,
    baseUrl: normalizeBaseUrl(baseUrlPick.value),
    provider,
    providerLabel: preset.label,
    providerSource,
    imageModels,
    videoModels,
    imageModel: imageModels[0] || "",
    videoModel: videoModels[0] || "",
    imageApiStyle: imageApiStyle || "openai",
    imageApiStyleSource: imageApiStylePick.source,
    imageEndpoint,
    videoCreateEndpoint,
    videoQueryTemplate,
    chatEndpoint,
    textModel: textModel.value,
    imageExtraBody: isPlainObject(data.imageExtraBody) ? data.imageExtraBody : null,
    videoExtraBody: isPlainObject(data.videoExtraBody) ? data.videoExtraBody : null,
    saveDir: saveDir.value,
    configPath,
    configFile: file,
    sources: {
      apiKey: apiKey.source,
      baseUrl: baseUrlPick.source,
      imageModel: imageModelPick.source,
      videoModel: videoModelPick.source,
      provider: providerSource,
    },
    missing,
  };
}

// 候选链解析：配置了 chains 时返回 1~3 个候选（每项可整体覆盖 baseUrl/key/模型/端点，
// 实现跨厂商原子切换）；未配置时返回 [默认配置]。调用参数覆盖只作用于第一项。
export function resolveCandidates(params = {}, kind = null) {
  const base = resolveConfig(params, kind);
  const file = readConfigFile(base.configPath);
  const chains = Array.isArray(file.data.chains) ? file.data.chains.filter(isPlainObject).slice(0, MAX_CHAIN) : [];
  if (chains.length === 0) return [base];

  return chains.map((entry, i) => {
    const entryParams = {};
    for (const key of CHAIN_ENTRY_KEYS) {
      if (entry[key] !== undefined) entryParams[key] = entry[key];
    }
    // 条目显式指定了模型链时，屏蔽配置区注入的 env 模型，避免污染该候选的兜底链
    if (entry.imageModels !== undefined) entryParams._noEnvImageModels = true;
    if (entry.videoModels !== undefined) entryParams._noEnvVideoModels = true;
    return i === 0 ? resolveConfig({ ...params, ...entryParams }, kind) : resolveConfig(entryParams, kind);
  });
}

const SETUP_HINT = [
  "配置方式（任选其一，改完无需重启，下次调用生效）：",
  "1. 调用 configure_media 工具，把 provider/baseUrl/apiKey/imageModel/videoModel 等写入配置文件（推荐，初始化引导走这条）；",
  "2. 手动编辑配置文件（JSON），路径见 media_config 输出；",
  "3. 设置环境变量 AGNES_API_KEY / AGNES_BASE_URL / AGNES_MEDIA_API_KEY / AGNES_MEDIA_BASE_URL（优先级高于配置文件）。",
].join("\n");

export function requireCredentials(cfg) {
  if (cfg.missing.length === 0) return;
  throw new MediaError(
    `配置不完整，缺少：${cfg.missing.join("、")}（本插件不内置默认 baseUrl / apiKey / 模型，需先完成初始化配置）。`,
    SETUP_HINT
  );
}

// 把配置写入用户配置文件（凭据只落在用户级配置文件，源码/示例不含任何可用凭据）
export function writeConfig(values = {}, { reset = false, unset = [] } = {}) {
  const configPath = firstNonEmpty(process.env.AGNES_MEDIA_CONFIG) || DEFAULT_CONFIG_PATH;
  const current = reset ? {} : readConfigFile(configPath).data;
  const next = { ...current };

  for (const key of CONFIG_KEYS) {
    if (values[key] !== undefined) {
      const v = values[key];
      if (typeof v === "string" && v.trim()) next[key] = v.trim();
      else if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
        // 模型链：字符串数组，最多 3 个
        const list = v.map((x) => String(x || "").trim()).filter(Boolean).slice(0, MAX_CHAIN);
        if (list.length > 0) next[key] = list;
      } else if (Array.isArray(v) && v.every(isPlainObject)) {
        // 候选链：对象数组，最多 3 个
        next[key] = v.slice(0, MAX_CHAIN);
      } else if (isPlainObject(v)) next[key] = v;
    }
  }
  for (const key of Array.isArray(unset) ? unset : []) {
    if (CONFIG_KEYS.includes(key)) delete next[key];
  }

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  return { path: configPath, data: next };
}

function extractApiError(json, text, status) {
  const parts = [];
  if (json) {
    if (json.error) parts.push(typeof json.error === "string" ? json.error : json.error.message || JSON.stringify(json.error));
    if (json.detail) parts.push(typeof json.detail === "string" ? json.detail : JSON.stringify(json.detail));
    if (json.message) parts.push(json.message);
  }
  if (!parts.length) parts.push(text ? text.slice(0, 500) : `HTTP ${status}`);
  return `接口错误（HTTP ${status}）：${parts.join(" | ")}`;
}

async function apiRequest(cfg, path, { method = "GET", body, query, timeoutMs = 300000 } = {}) {
  const url = validateRequestUrl(joinEndpoint(cfg.baseUrl, path));
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  }
  const headers = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw new MediaError(`请求超时（${timeoutMs} ms）：${url.toString()}`, null, { kind: "timeout" });
    throw new MediaError(`网络请求失败：${err.message}（${url.toString()}）`, "请检查 baseUrl 是否可达、是否正确。", { kind: "network" });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // 非 JSON 响应
  }
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? "API Key 可能无效或已过期。更新方式：设置→插件→本插件→配置区修改 API Key（保存后完全退出重开 ZCode），或修改 ~/.agnes-media/config.json 的 apiKey 字段。"
        : null;
    throw new MediaError(extractApiError(json, text, res.status), hint, { status: res.status, kind: "http" });
  }
  return { status: res.status, json, text, contentType: res.headers.get("content-type") || "" };
}

// 输入图片：http(s) URL / data URI / 本地路径（本地路径自动转 Data URI）
export function resolveMediaInput(input) {
  const value = String(input || "").trim();
  if (!value) throw new MediaError("输入图片不能为空。");
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("data:")) return value;

  const localPath = isAbsolute(value) ? value : resolve(process.cwd(), value);
  if (!existsSync(localPath)) throw new MediaError(`本地图片不存在：${localPath}`);
  const ext = extname(localPath).toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (!mime) throw new MediaError(`不支持的图片格式 ${ext || "(无扩展名)"}，支持：png/jpg/jpeg/webp/gif/bmp。`);
  const base64 = readFileSync(localPath).toString("base64");
  return `data:${mime};base64,${base64}`;
}

// 提示词增强（可选）：先用 chat 模型把简短提示词扩写成结构化生成提示词；
// 未配置 textModel 或增强失败时用原提示词，并在结果里注明。
export async function enhancePrompt(cfg, prompt) {
  if (!cfg.textModel) return { prompt, enhanced: false, note: "未配置 textModel，跳过增强" };
  const body = {
    model: cfg.textModel,
    messages: [
      {
        role: "system",
        content:
          "你是图像/视频生成提示词工程师。把用户的简短描述扩写成一条高质量生成提示词，结构：[主体]+[场景/环境]+[风格]+[光照]+[构图]+[质量要求]。只输出扩写后的提示词本身，不要解释，不要加引号。",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
  };
  try {
    const res = await apiRequest(cfg, cfg.chatEndpoint, { method: "POST", body, timeoutMs: 60000 });
    const text = res.json && res.json.choices && res.json.choices[0] && res.json.choices[0].message && res.json.choices[0].message.content;
    if (typeof text === "string" && text.trim()) {
      return { prompt: text.trim(), enhanced: true, note: null };
    }
    return { prompt, enhanced: false, note: "增强响应无内容，使用原提示词" };
  } catch (err) {
    return { prompt, enhanced: false, note: `提示词增强失败（${err.message}），使用原提示词` };
  }
}

function pickExt(url, contentType, fallback) {
  if (contentType) {
    const ct = contentType.split(";")[0].trim().toLowerCase();
    if (EXT_BY_CONTENT_TYPE[ct]) return EXT_BY_CONTENT_TYPE[ct];
  }
  try {
    const pathExt = extname(new URL(url).pathname).toLowerCase();
    if (pathExt && pathExt.length <= 5) return pathExt;
  } catch {
    // 非 URL
  }
  return fallback;
}

function resolveSaveDir(cfg, saveDirArg) {
  const dir = firstNonEmpty(saveDirArg, cfg.saveDir) || join(process.cwd(), "ZcodeImage");
  const abs = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  mkdirSync(abs, { recursive: true });
  return abs;
}

function uniqueFilePath(dir, nameHint, ext) {
  let name = nameHint ? basename(String(nameHint).trim()) : "";
  if (!name || name === "." || name === "..") {
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const rand = Math.random().toString(36).slice(2, 6);
    name = `agnes-${stamp}-${rand}${ext}`;
  } else if (!extname(name)) {
    name += ext;
  }
  let candidate = join(dir, name);
  let n = 1;
  while (existsSync(candidate)) {
    candidate = join(dir, `${name.slice(0, name.length - extname(name).length)}-${n}${extname(name)}`);
    n += 1;
  }
  return candidate;
}

function saveBuffer(buffer, dir, nameHint, ext) {
  const filePath = uniqueFilePath(dir, nameHint, ext);
  writeFileSync(filePath, buffer);
  return filePath;
}

async function downloadBinary(url, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const validated = validateRequestUrl(url);
    const res = await fetch(validated, { signal: controller.signal });
    if (!res.ok) throw new MediaError(`下载失败（HTTP ${res.status}）：${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { buffer: buf, contentType: res.headers.get("content-type") || "" };
  } catch (err) {
    if (err instanceof MediaError) throw err;
    if (err.name === "AbortError") throw new MediaError(`下载超时（${timeoutMs} ms）：${url}`);
    throw new MediaError(`下载失败：${err.message}（${url}）`);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 图片：文生图 / 图生图 / 图片编辑 / 多图合成 ----------

// 候选链 × 模型链双层兜底；attempts 记录 {chain, model, ok, error, status}
async function withFallback(candidates, pickModels, run, label) {
  const attempts = [];
  for (let ci = 0; ci < candidates.length; ci++) {
    const cfg = candidates[ci];
    const chain = `#${ci + 1}`;
    const models = pickModels(cfg);
    if (models.length === 0) {
      if (ci === 0) {
        throw new MediaError(
          `候选 ${chain} 未配置${label}模型（imageModel/imageModels 或 videoModel/videoModels）。`,
          SETUP_HINT
        );
      }
      continue;
    }
    for (let mi = 0; mi < models.length; mi++) {
      const model = models[mi];
      try {
        const result = await run(cfg, model);
        result.attempts = [...attempts, { chain, model, ok: true }];
        return result;
      } catch (err) {
        attempts.push({ chain, model, ok: false, error: err.message, status: err.status || null });
        const modelsLeft = mi < models.length - 1;
        const chainsLeft = ci < candidates.length - 1;
        if (!isRetryableError(err)) throw attachAttempts(err, attempts);
        if (!modelsLeft && !chainsLeft) throw fallbackError(attempts);
        // 否则继续下一个模型 / 下一个候选
      }
    }
  }
  throw fallbackError(attempts);
}

export function generateImage(candidates, args = {}) {
  const explicit = firstNonEmpty(args.model);
  return withFallback(
    candidates,
    explicit ? () => [explicit] : (cfg) => cfg.imageModels,
    (cfg, model) => generateImageOnce(cfg, model, args),
    "图片"
  );
}

async function generateImageOnce(cfg, model, args = {}) {
  const prompt = String(args.prompt || "").trim();
  if (!prompt) throw new MediaError("prompt 不能为空。");

  let finalPrompt = prompt;
  let enhance = null;
  if (args.enhance_prompt === true) {
    enhance = await enhancePrompt(cfg, prompt);
    finalPrompt = enhance.prompt;
  }

  const size = firstNonEmpty(args.size) || "";
  const ratio = firstNonEmpty(args.ratio) || "";
  const wantB64 = args.response_format === "b64";
  const inputImages = Array.isArray(args.input_images) ? args.input_images.filter(Boolean) : [];

  // 请求体按 imageApiStyle 构建：agnes 形态 / openai 兼容形态
  const body = { model, prompt: finalPrompt };
  if (size) body.size = size;

  if (cfg.imageApiStyle === "agnes") {
    if (ratio) body.ratio = ratio;
    if (inputImages.length > 0) {
      body.extra_body = {
        image: inputImages.map(resolveMediaInput),
        response_format: wantB64 ? "b64_json" : "url",
      };
    } else if (wantB64) {
      body.return_base64 = true;
    } else {
      body.extra_body = { response_format: "url" };
    }
  } else {
    body.response_format = wantB64 ? "b64_json" : "url";
    if (inputImages.length > 0) body.image = inputImages.map(resolveMediaInput);
  }

  if (cfg.imageExtraBody) Object.assign(body, cfg.imageExtraBody);

  const res = await apiRequest(cfg, cfg.imageEndpoint, { method: "POST", body, timeoutMs: 300000 });
  const data = res.json && Array.isArray(res.json.data) ? res.json.data[0] : null;
  if (!data) throw new MediaError(`接口响应中缺少 data[0]：${res.text.slice(0, 500)}`);

  const saveDir = resolveSaveDir(cfg, args.save_dir);
  let savedPath = null;
  let bytes = 0;
  let url = null;

  if (data.url) {
    url = data.url;
    const { buffer, contentType } = await downloadBinary(url);
    bytes = buffer.length;
    savedPath = saveBuffer(buffer, saveDir, args.file_name, pickExt(url, contentType, ".png"));
  } else if (data.b64_json) {
    const buffer = Buffer.from(data.b64_json, "base64");
    bytes = buffer.length;
    savedPath = saveBuffer(buffer, saveDir, args.file_name, ".png");
  } else {
    throw new MediaError(`接口响应中既无 url 也无 b64_json：${JSON.stringify(data).slice(0, 500)}`);
  }

  return {
    kind: "image",
    model,
    size: size || "(未指定)",
    ratio: ratio || "(未指定)",
    style: cfg.imageApiStyle,
    input_count: inputImages.length,
    saved_path: savedPath,
    bytes,
    url,
    revised_prompt: data.revised_prompt || null,
    enhanced: enhance ? enhance.enhanced : false,
    enhance_note: enhance ? enhance.note : null,
    final_prompt: enhance && enhance.enhanced ? finalPrompt : null,
  };
}

// ---------- 视频：文生视频 / 关键帧 / 参考生成 ----------

function validateVideoArgs(args) {
  const mode = firstNonEmpty(args.mode) || "text";
  if (!VIDEO_MODES.includes(mode)) {
    throw new MediaError(`mode 仅支持：${VIDEO_MODES.join(" / ")}。`);
  }
  let seconds = firstNonEmpty(args.seconds);
  if (seconds && (!/^\d+$/.test(seconds) || Number(seconds) < 4 || Number(seconds) > 12)) {
    throw new MediaError(`seconds 仅支持 4~12 的整数（字符串），当前：${seconds}`);
  }
  const aspectRatio = firstNonEmpty(args.aspect_ratio);
  if (aspectRatio && !VIDEO_ASPECT_RATIOS.includes(aspectRatio)) {
    throw new MediaError(`aspect_ratio 仅支持：${VIDEO_ASPECT_RATIOS.join(" / ")}。`);
  }
  if (args.seed !== undefined && args.seed !== null && !Number.isInteger(Number(args.seed))) {
    throw new MediaError("seed 必须是整数。");
  }
  return { mode, seconds, aspectRatio };
}

export function createVideoTask(candidates, args = {}) {
  const explicit = firstNonEmpty(args.model);
  return withFallback(
    candidates,
    explicit ? () => [explicit] : (cfg) => cfg.videoModels,
    (cfg, model) => createVideoTaskOnce(cfg, model, args),
    "视频"
  );
}

async function createVideoTaskOnce(cfg, model, args = {}) {
  const prompt = String(args.prompt || "").trim();
  if (!prompt) throw new MediaError("prompt 不能为空。");

  let finalPrompt = prompt;
  let enhance = null;
  if (args.enhance_prompt === true) {
    enhance = await enhancePrompt(cfg, prompt);
    finalPrompt = enhance.prompt;
  }

  const { mode, seconds, aspectRatio } = validateVideoArgs(args);

  // 参数名按 Agnes 文档形态；接其他厂商时端点/模型可配置，
  // 厂商特有参数可通过配置 videoExtraBody 附加。
  const body = { model, prompt: finalPrompt, mode };
  if (seconds) body.seconds = seconds;
  const size = firstNonEmpty(args.size);
  if (size) body.size = size;
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  if (args.seed !== undefined && args.seed !== null) body.seed = Number(args.seed);

  if (mode === "keyframe") {
    const firstFrame = firstNonEmpty(args.first_frame);
    const lastFrame = firstNonEmpty(args.last_frame);
    if (!firstFrame && !lastFrame) {
      throw new MediaError("keyframe 模式至少需要 first_frame 或 last_frame 之一。");
    }
    if (firstFrame) body.first_frame = resolveMediaInput(firstFrame);
    if (lastFrame) body.last_frame = resolveMediaInput(lastFrame);
  }

  if (mode === "reference") {
    const images = Array.isArray(args.images) ? args.images.filter(Boolean) : [];
    const audios = Array.isArray(args.audios) ? args.audios.filter(Boolean) : [];
    if (images.length > 5) throw new MediaError("reference 模式 images 最多 5 张。");
    if (audios.length > 3) throw new MediaError("reference 模式 audios 最多 3 段。");
    if (images.length === 0 && audios.length === 0) {
      throw new MediaError("reference 模式至少需要 1 张 images 或 1 段 audios。");
    }
    if (images.length > 0) body.images = images.map(resolveMediaInput);
    if (audios.length > 0) body.audios = audios.map(resolveMediaInput);
  }

  if (cfg.videoExtraBody) Object.assign(body, cfg.videoExtraBody);

  const res = await apiRequest(cfg, cfg.videoCreateEndpoint, { method: "POST", body, timeoutMs: 120000 });
  const videoId = (res.json && (res.json.video_id || res.json.id)) || null;
  if (!videoId) throw new MediaError(`创建视频任务响应中缺少 id/video_id：${res.text.slice(0, 500)}`);
  return {
    video_id: videoId,
    model,
    mode,
    seconds: seconds || "(默认)",
    size: size || "(默认)",
    aspect_ratio: aspectRatio || "(默认)",
    enhanced: enhance ? enhance.enhanced : false,
    enhance_note: enhance ? enhance.note : null,
    final_prompt: enhance && enhance.enhanced ? finalPrompt : null,
    raw: res.json,
  };
}

function buildVideoQueryPath(cfg, videoId, model) {
  return cfg.videoQueryTemplate
    .replaceAll("{video_id}", encodeURIComponent(String(videoId)))
    .replaceAll("{model}", encodeURIComponent(String(model)));
}

// 视频查询：候选链 × 模型链（查询地址带模型名，需与创建时所用模型一致才能查到）
export function getVideoTask(candidates, videoId, model) {
  const explicit = firstNonEmpty(model);
  return withFallback(
    candidates,
    explicit ? () => [explicit] : (cfg) => cfg.videoModels,
    (cfg, m) => getVideoTaskOnce(cfg, videoId, m),
    "视频"
  );
}

async function getVideoTaskOnce(cfg, videoId, videoModel) {
  const id = String(videoId || "").trim();
  if (!id) throw new MediaError("video_id 不能为空。");
  const res = await apiRequest(cfg, buildVideoQueryPath(cfg, id, videoModel), { timeoutMs: 60000 });
  return res.json || {};
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 轮询直到 completed / failed 或超时
export async function pollVideoTask(candidates, videoId, model, { intervalMs = 2000, timeoutMs = 300000 } = {}) {
  const started = Date.now();
  let last = null;
  while (true) {
    last = await getVideoTask(candidates, videoId, model);
    const status = String(last.status || "").toLowerCase();
    if (status === "completed" || status === "failed") return last;
    if (Date.now() - started > timeoutMs) {
      return { ...last, _timeout: true, _message: `轮询超时（${timeoutMs} ms），任务仍在进行，可稍后用 video_status 查询。` };
    }
    await sleep(intervalMs);
  }
}

// 可选：把视频下载到本地
export async function downloadVideo(cfg, url, saveDirArg, fileNameHint) {
  const { buffer, contentType } = await downloadBinary(url, 600000);
  const dir = resolveSaveDir(cfg, saveDirArg);
  const savedPath = saveBuffer(buffer, dir, fileNameHint, pickExt(url, contentType, ".mp4"));
  return { saved_path: savedPath, bytes: buffer.length };
}
