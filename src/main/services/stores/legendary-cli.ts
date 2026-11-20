import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface LegendaryRunOptions {
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  signal?: AbortSignal;
}

export interface LegendaryRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function getLegendaryBinaryPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "legendary", "legendary");
  }
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return path.join(app.getAppPath(), "legendary", "darwin", arch, "legendary");
}

export function getLegendaryConfigDir(): string {
  const dir = path.join(app.getPath("userData"), "stores", "legendary");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function runLegendary(
  args: string[],
  options: LegendaryRunOptions = {}
): Promise<LegendaryRunResult> {
  return new Promise((resolve, reject) => {
    const binary = getLegendaryBinaryPath();
    if (!fs.existsSync(binary)) {
      reject(new Error(`legendary binary not found at ${binary}`));
      return;
    }

    const child: ChildProcess = spawn(binary, args, {
      env: { ...process.env, LEGENDARY_CONFIG_PATH: getLegendaryConfigDir() },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const buffers = { stdout: "", stderr: "" };

    const feed = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (stream === "stdout") stdout += text;
      else stderr += text;
      if (!options.onLine) return;
      buffers[stream] += text;
      const parts = buffers[stream].split(/[\r\n]+/);
      buffers[stream] = parts.pop() ?? "";
      for (const line of parts) {
        if (line.trim()) options.onLine(line, stream);
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => feed("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => feed("stderr", chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));

    options.signal?.addEventListener(
      "abort",
      () => {
        child.kill("SIGTERM");
      },
      { once: true }
    );
  });
}
