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
        "配置只需一次、永久生效。请引导用户：",
        "1. API Key：运行 /agnes-media:init 写入配置文件（立即生效），或手动编辑 ~/.agnes-media/config.json 的 apiKey（ZCode 配置区暂不支持填敏感值）；",
        "2. Base URL/模型等非敏感项：可在 设置→插件→本插件详情→配置区 填写（保存后完全退出重开 ZCode 生效）。",
        "若用户直接要求生成图片/视频，按其引导就地配置（media_config 查缺失 → 问 baseUrl/apiKey/模型 → configure_media 写入）。",
      ].join("\n")
    );
  }
} catch (err) {
  // 钩子失败不阻塞会话；错误只写 stderr，不污染会话上下文
  process.stderr.write(`[agnes-media] check-config failed: ${err && err.message}\n`);
}
process.exit(0);
