---
description: 查看或修改 Agnes Media 配置（Key、Base URL、模型、兜底链、候选链）——中途换厂商/换 Key 用这个
---

# Agnes Media 配置管理

初始化后中途修改配置都用本命令（或直接对 Agent 说「改配置」「换 Key」）。

## 执行步骤

0. **收集信息时直接在回复正文中向用户提问**，不要调用交互式工具、不要循环重试。
1. 调用 `media_config` 展示当前配置（API Key 脱敏、Base URL、provider、模型链、候选链、缺失项）。若工具不可用（插件 MCP 未加载），用 Read 工具直接读 `~/.agnes-media/config.json` 展示。
2. 询问用户要修改什么，常见操作：
   - 换 Key / 换地址 / 换模型 → `configure_media` 传对应字段（增量合并，不影响其他配置）
   - 加兜底模型 → `imageModels` / `videoModels` 数组（最多 3 个）
   - 跨厂商容灾 → `chains` 候选链（最多 3 项，每项可整体覆盖 baseUrl/apiKey/模型/端点）
   - 去掉某项 → `unset: ["字段名"]`；全部重来 → `reset: true`（慎用）
   - **MCP 工具不可用时**：用 Write 工具直接改 `~/.agnes-media/config.json`（Windows：`C:\Users\<用户名>\.agnes-media\config.json`），不要用 shell 拼 JSON
3. 修改后再次 `media_config`（或 Read 配置文件）确认，并向用户说明改动已生效（下次调用读取）；若 MCP 不可用，提醒用户完全退出 ZCode 重开后可恢复 MCP 工具。
