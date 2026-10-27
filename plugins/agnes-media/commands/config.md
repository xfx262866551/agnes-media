---
description: 查看或修改 Agnes Media 配置（Key、Base URL、模型、兜底链、候选链）——中途换厂商/换 Key 用这个
---

# Agnes Media 配置管理

初始化后中途修改配置都用本命令（或直接对 Agent 说「改配置」「换 Key」）。

## 执行步骤

1. 调用 `media_config` 展示当前配置（API Key 脱敏、Base URL、provider、模型链、候选链、缺失项）。
2. 询问用户要修改什么，常见操作：
   - 换 Key / 换地址 / 换模型 → `configure_media` 传对应字段（增量合并，不影响其他配置）
   - 加兜底模型 → `imageModels` / `videoModels` 数组（最多 3 个）
   - 跨厂商容灾 → `chains` 候选链（最多 3 项，每项可整体覆盖 baseUrl/apiKey/模型/端点）
   - 去掉某项 → `unset: ["字段名"]`；全部重来 → `reset: true`（慎用）
3. 修改后再次调用 `media_config` 确认，并向用户说明改动已生效（下次调用读取）。
