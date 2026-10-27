#!/usr/bin/env node
// 后台视频任务监控：轮询直到 completed/failed；完成则自动下载 mp4 到本地并弹系统通知。
// 由 generate_video 创建任务后以 detached 方式拉起，独立于 MCP 服务器与 ZCode 会话生存。
import { resolveConfig, getVideoTask, downloadVideo } from "./media-api.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function notify(title, body) {
  const platform = process.platform;
  try {
    if (platform === "win32") {
      const ps = [
        "Add-Type -AssemblyName System.Windows.Forms|Out-Null",
        "Add-Type -AssemblyName System.Drawing|Out-Null",
        "$n=New-Object System.Windows.Forms.NotifyIcon",
        "$n.Icon=[System.Drawing.SystemIcons]::Information",
        "$n.Visible=$true",
        `$n.ShowBalloonTip(15000,'${title.replace(/'/g, "''")}','${body.replace(/'/g, "''")}',[System.Windows.Forms.ToolTipIcon]::Info)`,
        "Start-Sleep -Seconds 14",
        "$n.Dispose()",
      ].join("; ");
      await execFileAsync("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], { timeout: 30000 });
    } else if (platform === "darwin") {
      await execFileAsync("osascript", ["-e", `display notification "${body.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`], { timeout: 15000 });
    } else {
      await execFileAsync("notify-send", [title, body], { timeout: 15000 });
    }
  } catch {
    // 通知失败不影响主流程（下载/状态文件仍会写）
  }
}

function writeState(state) {
  try {
    const dir = join(homedir(), ".agnes-media");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "last-video.json"), JSON.stringify(state, null, 2) + "\n");
  } catch {
    // 忽略
  }
}

(async () => {
  const videoId = arg("video-id");
  const model = arg("model");
  const saveDir = arg("save-dir");
  const intervalMs = Math.max(5000, Number(arg("interval", "15000")) || 15000);
  const timeoutMs = Math.max(60000, Number(arg("timeout", "3600000")) || 3600000);
  if (!videoId) {
    console.error("缺少 --video-id");
    process.exit(1);
  }

  const cfg = resolveConfig({}, "video");
  const started = Date.now();
  let last = null;
  while (true) {
    try {
      last = await getVideoTask([cfg], videoId, model);
    } catch (err) {
      await notify("视频任务查询失败", `${videoId}：${err.message}`);
      writeState({ video_id: videoId, status: "error", error: err.message, checked_at: new Date().toISOString() });
      process.exit(1);
    }
    const status = String(last.status || "").toLowerCase();
    if (status === "completed") {
      const state = { video_id: videoId, status: "completed", url: last.url || null, checked_at: new Date().toISOString() };
      if (last.url) {
        try {
          const dl = await downloadVideo(cfg, last.url, saveDir, `agnes-video-${videoId}.mp4`);
          state.saved_path = dl.saved_path;
          state.bytes = dl.bytes;
          await notify("视频生成完成", `已保存到 ${dl.saved_path}`);
        } catch (err) {
          state.download_error = err.message;
          await notify("视频生成完成（下载失败）", `链接：${last.url}｜错误：${err.message}`);
        }
      } else {
        await notify("视频生成完成", "任务完成但未返回下载链接，请用 video_status 复查。");
      }
      writeState(state);
      process.exit(0);
    }
    if (status === "failed") {
      const state = { video_id: videoId, status: "failed", error: last.error || "(未提供)", checked_at: new Date().toISOString() };
      writeState(state);
      await notify("视频生成失败", `${videoId}：${state.error}`);
      process.exit(1);
    }
    if (Date.now() - started > timeoutMs) {
      writeState({ video_id: videoId, status: "timeout", checked_at: new Date().toISOString() });
      await notify("视频任务监控超时", `${videoId} 仍在进行，可后用 video_status 查询。`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
})();
