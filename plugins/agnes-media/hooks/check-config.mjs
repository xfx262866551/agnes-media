#!/usr/bin/env node
// SessionStart 钩子：检查初始化配置是否完成。
// 配置不完整时向会话注入引导上下文（由 Agent 引导用户完成 configure_media 初始化）；
// 已配置时只输出一行状态。无任何副作用，失败不影响会话启动。
import { resolveConfig, maskKey } from "../server/media-api.mjs";

try {
  const cfg = resolveConfig({});
  if (cfg.missing.length === 0) {
    process.stdout.write(
      `[agnes-media] 已配置（provider=${cfg.provider || "custom"}，baseUrl=${cfg.baseUrl}，key=${maskKey(cfg.apiKey)}）。图片/视频生成工具可直接使用。\n`
    );
  } else {
    process.stdout.write(
      [
        "[agnes-media] 尚未完成初始化配置（缺少：" + cfg.missing.join("、") + "）。",
        "本插件不内置默认 baseUrl / apiKey / 模型。请引导用户运行插件的初始化命令 /agnes-media:init（安装后只需运行一次，配置写入用户级配置文件后永久生效）；",
        "如果用户没有使用命令而是直接要求生成图片/视频，则按 SKILL 流程引导配置（media_config 查缺失 → 询问厂商/baseUrl/apiKey/模型 → configure_media 写入）。",
        "中途修改配置：/agnes-media:config 命令，或直接再次调用 configure_media。",
      ].join("\n")
    );
  }
} catch (err) {
  // 钩子失败不阻塞会话；错误只写 stderr，不污染会话上下文
  process.stderr.write(`[agnes-media] check-config failed: ${err && err.message}\n`);
}
process.exit(0);
