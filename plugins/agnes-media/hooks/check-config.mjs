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
        "本插件不内置默认 baseUrl / apiKey / 模型。当用户在本会话中要求生成图片或视频时：",
        "1. 先调用 media_config 确认缺失项；",
        "2. 询问用户使用哪个厂商与配置：provider（agnes=Agnes 官方 / openai=OpenAI 兼容 / custom=自定义端点）、baseUrl、apiKey、imageModel、videoModel；",
        "3. 调用 configure_media 写入配置（立即生效），然后再执行生成；",
        "4. 中途修改配置同样用 configure_media；涉及 Key 时提醒用户也可手写配置文件或设置环境变量（AGNES_API_KEY / AGNES_BASE_URL）。",
      ].join("\n")
    );
  }
} catch (err) {
  // 钩子失败不阻塞会话；错误只写 stderr，不污染会话上下文
  process.stderr.write(`[agnes-media] check-config failed: ${err && err.message}\n`);
}
process.exit(0);
