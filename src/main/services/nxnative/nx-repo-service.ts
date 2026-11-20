import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { NxRepoInfo, NxReposStatus } from "@types";
import { AppLogHub } from "@main/services/app-log-hub";
import {
  NX2ANDROID_REPO_URL,
  NXNATIVE_OFFICIAL_REPO_URL,
  NXNATIVE_UPSTREAM_REPO_URL,
  NxPathsService,
} from "./nx-paths";

const execFileAsync = promisify(execFile);

const NX2A_ARCHIVE_URL =
  "https://github.com/shirai91/nx2android/archive/refs/heads/main.tar.gz";
const NX2A_SYNC_SHA_FILE = ".nx2a_sync_sha";

function findGitBin(): string {
  for (const p of [
    "/opt/homebrew/bin/git",
    "/usr/local/bin/git",
    "/usr/bin/git",
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return "git";
}

function buildGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: NxPathsService.getAugmentedPath(),
    HOME: process.env.HOME || os.homedir(),
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "Cerberus NxNative",
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "updater@cerberus.local",
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "Cerberus NxNative",
    GIT_COMMITTER_EMAIL:
      process.env.GIT_COMMITTER_EMAIL || "updater@cerberus.local",
  };
}

async function runGit(
  args: string[],
  cwd?: string,
  timeout = 30000
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const git = findGitBin();
  try {
    const { stdout, stderr } = await execFileAsync(git, args, {
      cwd,
      timeout,
      env: buildGitEnv(),
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: (e.stdout || "").trim(),
      stderr: (e.stderr || e.message || String(err)).trim(),
    };
  }
}

export class NxRepoService {
  public static async getStatus(fetchRemote = false): Promise<NxReposStatus> {
    const [nxResolved, nx2aResolved] = await Promise.all([
      NxPathsService.resolveNxnativePath(),
      NxPathsService.resolveNx2AndroidPath(),
    ]);

    const [nxnative, nx2android] = await Promise.all([
      this.inspectNxnativeRepo(
        nxResolved.path,
        nxResolved.isValid,
        fetchRemote
      ),
      this.inspectNx2AndroidRepo(
        nx2aResolved.path,
        nx2aResolved.isValid,
        fetchRemote
      ),
    ]);

    return { nxnative, nx2android };
  }

  private static async inspectNxnativeRepo(
    repoPath: string,
    isValid: boolean,
    fetchRemote: boolean
  ): Promise<NxRepoInfo> {
    const isGitRepo = fs.existsSync(path.join(repoPath, ".git"));
    if (!isValid || !isGitRepo) {
      return {
        path: repoPath,
        isValid,
        localCommit: "",
        remoteCommit: "",
        upstreamBehindCount: 0,
        isGitRepo,
      };
    }

    const headRes = await runGit(
      ["rev-parse", "--short", "HEAD"],
      repoPath,
      5000
    );
    const localCommit = headRes.ok ? headRes.stdout : "";

    // Ensure upstream remote points to seedds/nxnative
    const upUrl = await runGit(
      ["remote", "get-url", "upstream"],
      repoPath,
      5000
    );
    if (!upUrl.ok) {
      await runGit(
        ["remote", "add", "upstream", NXNATIVE_UPSTREAM_REPO_URL],
        repoPath,
        5000
      );
    }

    if (fetchRemote) {
      await runGit(
        [
          "fetch",
          "--quiet",
          "upstream",
          "+refs/heads/main:refs/remotes/upstream/main",
          "--force",
        ],
        repoPath,
        30000
      );
    }

    const remoteRes = await runGit(
      ["rev-parse", "--short", "upstream/main"],
      repoPath,
      5000
    );
    const remoteCommit = remoteRes.ok ? remoteRes.stdout : "";

    let upstreamBehindCount = 0;
    if (remoteRes.ok) {
      const countRes = await runGit(
        ["rev-list", "--count", "HEAD..upstream/main"],
        repoPath,
        5000
      );
      if (countRes.ok) {
        upstreamBehindCount = Number.parseInt(countRes.stdout, 10) || 0;
      }
    }

    return {
      path: repoPath,
      isValid,
      localCommit,
      remoteCommit,
      upstreamBehindCount,
      isGitRepo,
    };
  }

  private static async inspectNx2AndroidRepo(
    repoPath: string,
    isValid: boolean,
    fetchRemote: boolean
  ): Promise<NxRepoInfo> {
    const isGitRepo = fs.existsSync(path.join(repoPath, ".git"));
    let localCommit = "";
    let remoteCommit = "";
    let upstreamBehindCount = 0;

    if (isValid && isGitRepo) {
      const headRes = await runGit(
        ["rev-parse", "--short", "HEAD"],
        repoPath,
        5000
      );
      localCommit = headRes.ok ? headRes.stdout : "";

      if (fetchRemote) {
        await runGit(
          [
            "fetch",
            "--quiet",
            "origin",
            "+refs/heads/main:refs/remotes/origin/main",
            "--force",
          ],
          repoPath,
          30000
        );
      }

      const remRes = await runGit(
        ["rev-parse", "--short", "origin/main"],
        repoPath,
        5000
      );
      remoteCommit = remRes.ok ? remRes.stdout : "";
      if (remRes.ok) {
        const cntRes = await runGit(
          ["rev-list", "--count", "HEAD..origin/main"],
          repoPath,
          5000
        );
        upstreamBehindCount = cntRes.ok
          ? Number.parseInt(cntRes.stdout, 10) || 0
          : 0;
      }
    } else if (isValid) {
      const shaFile = path.join(repoPath, NX2A_SYNC_SHA_FILE);
      if (fs.existsSync(shaFile)) {
        localCommit = fs.readFileSync(shaFile, "utf8").trim().slice(0, 7);
      }
      if (fetchRemote) {
        const remoteFull = await this.fetchNx2AndroidRemoteSha();
        if (remoteFull) {
          remoteCommit = remoteFull.slice(0, 7);
          if (
            localCommit &&
            localCommit.toLowerCase() !== remoteCommit.toLowerCase()
          ) {
            upstreamBehindCount = 1;
          }
        }
      }
    }

    return {
      path: repoPath,
      isValid,
      localCommit,
      remoteCommit,
      upstreamBehindCount,
      isGitRepo,
    };
  }

  private static async fetchNx2AndroidRemoteSha(): Promise<string | null> {
    const ls = await runGit(
      ["ls-remote", NX2ANDROID_REPO_URL, "refs/heads/main"],
      undefined,
      15000
    );
    if (ls.ok && ls.stdout) {
      const tok = ls.stdout.split(/\s+/)[0];
      if (tok && tok.length >= 7) return tok;
    }
    try {
      const resp = await fetch(
        "https://api.github.com/repos/shirai91/nx2android/commits/main",
        {
          headers: {
            Accept: "application/vnd.github.sha",
            "User-Agent": "CerberusLauncher",
          },
        }
      );
      if (resp.ok) {
        const txt = (await resp.text()).trim();
        if (txt.length >= 7) return txt;
      }
    } catch {
      // ignore
    }
    return null;
  }

  public static async cloneNxnative(
    destinationPath?: string
  ): Promise<{ ok: boolean; path: string; message: string }> {
    const resolved = await NxPathsService.resolveNxnativePath(destinationPath);
    const targetDir = destinationPath
      ? path.resolve(destinationPath)
      : resolved.path;

    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    if (
      fs.existsSync(targetDir) &&
      !fs.existsSync(path.join(targetDir, ".git"))
    ) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }

    AppLogHub.step(
      "nxnative",
      `Clonando repositório nxnative para ${targetDir}...`
    );

    const git = findGitBin();
    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn(
        git,
        ["clone", "--progress", NXNATIVE_OFFICIAL_REPO_URL, targetDir],
        { env: buildGitEnv() }
      );
      const handleChunk = (buf: Buffer) => {
        const lines = buf
          .toString("utf8")
          .split(/[\r\n]+/)
          .map((l) => l.trim())
          .filter(Boolean);
        for (const l of lines) {
          AppLogHub.info("nxnative", l);
        }
      };
      child.stdout.on("data", handleChunk);
      child.stderr.on("data", handleChunk);
      child.on("close", (code) => resolve(code === 0));
      child.on("error", () => resolve(false));
    });

    if (!ok) {
      AppLogHub.warn(
        "nxnative",
        "Fallback: tentando clonar diretamente de github.com/seedds/nxnative..."
      );
      const fallback = await runGit(
        ["clone", NXNATIVE_UPSTREAM_REPO_URL, targetDir],
        undefined,
        180000
      );
      if (!fallback.ok) {
        AppLogHub.error(
          "nxnative",
          `Falha ao clonar nxnative: ${fallback.stderr}`
        );
        return { ok: false, path: targetDir, message: fallback.stderr };
      }
    } else {
      await runGit(
        ["remote", "add", "upstream", NXNATIVE_UPSTREAM_REPO_URL],
        targetDir,
        5000
      );
    }

    AppLogHub.success(
      "nxnative",
      `Repositório nxnative pronto em ${targetDir}`
    );
    return {
      ok: true,
      path: targetDir,
      message: "Repositório nxnative clonado com sucesso.",
    };
  }

  public static async syncUpstreamNxnative(): Promise<{
    ok: boolean;
    message: string;
  }> {
    const resolved = await NxPathsService.resolveNxnativePath();
    if (!resolved.isValid) {
      return {
        ok: false,
        message:
          "Repositório nxnative não encontrado. Clone ou selecione a pasta primeiro.",
      };
    }

    const repoPath = resolved.path;
    const syncScript = path.join(repoPath, "scripts", "sync_upstream.sh");

    AppLogHub.step(
      "nxnative",
      `Sincronizando upstream GitHub (seedds/nxnative) em ${repoPath}...`
    );

    if (fs.existsSync(syncScript)) {
      const result = await new Promise<{ ok: boolean; lastLine: string }>(
        (resolve) => {
          let lastLine = "";
          const child = spawn("/bin/bash", [syncScript], {
            cwd: repoPath,
            env: buildGitEnv(),
          });
          const onData = (buf: Buffer, isErr: boolean) => {
            const lines = buf
              .toString("utf8")
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean);
            for (const line of lines) {
              lastLine = line;
              AppLogHub.append(isErr ? "warning" : "info", "nxnative", line);
            }
          };
          child.stdout.on("data", (d) => onData(d, false));
          child.stderr.on("data", (d) => onData(d, true));
          child.on("close", (code) => resolve({ ok: code === 0, lastLine }));
          child.on("error", (err) =>
            resolve({ ok: false, lastLine: err.message })
          );
        }
      );

      if (result.ok) {
        AppLogHub.success(
          "nxnative",
          "Sincronização upstream do nxnative concluída com sucesso."
        );
        return {
          ok: true,
          message:
            result.lastLine || "nxnative atualizado com seedds/nxnative:main.",
        };
      }
      AppLogHub.error(
        "nxnative",
        `Erro ao sincronizar upstream nxnative: ${result.lastLine}`
      );
      return {
        ok: false,
        message: result.lastLine || "Falha na sincronização.",
      };
    }

    // Direct git fallback when scripts/sync_upstream.sh is not present
    const upCheck = await runGit(["remote", "get-url", "upstream"], repoPath);
    if (!upCheck.ok) {
      await runGit(
        ["remote", "add", "upstream", NXNATIVE_UPSTREAM_REPO_URL],
        repoPath
      );
    }
    const fetched = await runGit(
      [
        "fetch",
        "upstream",
        "+refs/heads/main:refs/remotes/upstream/main",
        "--force",
      ],
      repoPath,
      60000
    );
    if (!fetched.ok) {
      AppLogHub.error("nxnative", `Falha no fetch upstream: ${fetched.stderr}`);
      return { ok: false, message: fetched.stderr };
    }

    const merged = await runGit(
      ["merge", "--ff-only", "upstream/main"],
      repoPath,
      60000
    );
    if (!merged.ok) {
      AppLogHub.error(
        "nxnative",
        `Falha no merge fast-forward: ${merged.stderr}`
      );
      return { ok: false, message: merged.stderr };
    }

    AppLogHub.success("nxnative", "nxnative sincronizado com upstream/main.");
    return { ok: true, message: "nxnative atualizado com sucesso." };
  }

  public static async syncUpstreamNx2Android(): Promise<{
    ok: boolean;
    message: string;
  }> {
    const nx2a = await NxPathsService.resolveNx2AndroidPath();
    const targetDir = nx2a.path;
    const isGit = fs.existsSync(path.join(targetDir, ".git"));

    AppLogHub.step(
      "nx2android",
      `Sincronizando upstream GitHub (shirai91/nx2android) em ${targetDir}...`
    );

    if (isGit) {
      const fetchRes = await runGit(
        [
          "fetch",
          "origin",
          "+refs/heads/main:refs/remotes/origin/main",
          "--force",
        ],
        targetDir,
        60000
      );
      if (!fetchRes.ok) {
        AppLogHub.error("nx2android", `Fetch falhou: ${fetchRes.stderr}`);
        return { ok: false, message: fetchRes.stderr };
      }
      const mergeRes = await runGit(
        ["merge", "--ff-only", "origin/main"],
        targetDir,
        60000
      );
      if (!mergeRes.ok) {
        AppLogHub.error("nx2android", `Merge falhou: ${mergeRes.stderr}`);
        return { ok: false, message: mergeRes.stderr };
      }
      const head = await runGit(
        ["rev-parse", "--short", "HEAD"],
        targetDir,
        5000
      );
      const msg = `nx2android sincronizado (${head.stdout || "main"}).`;
      AppLogHub.success("nx2android", msg);
      return { ok: true, message: msg };
    }

    if (!fs.existsSync(path.join(targetDir, "porter"))) {
      fs.mkdirSync(path.dirname(targetDir), { recursive: true });
      if (!fs.existsSync(targetDir)) {
        const cloneRes = await runGit(
          [
            "clone",
            "--depth",
            "1",
            "--branch",
            "main",
            NX2ANDROID_REPO_URL,
            targetDir,
          ],
          undefined,
          180000
        );
        if (cloneRes.ok) {
          const head = await runGit(
            ["rev-parse", "--short", "HEAD"],
            targetDir,
            5000
          );
          const msg = `nx2android clonado com sucesso (${head.stdout || "main"}).`;
          AppLogHub.success("nx2android", msg);
          return { ok: true, message: msg };
        }
      }
    }

    // Non-git tarball sync preserving toolchains/
    const remoteSha = await this.fetchNx2AndroidRemoteSha();
    const tempRoot = await NxPathsService.getTempDirectory();
    const tempDir = fs.mkdtempSync(path.join(tempRoot, "cerberus_nx2a_"));
    try {
      const tarPath = path.join(tempDir, "main.tar.gz");
      const extractDir = path.join(tempDir, "extracted");
      fs.mkdirSync(extractDir, { recursive: true });

      await execFileAsync(
        "/usr/bin/curl",
        [
          "-fsSL",
          "--connect-timeout",
          "10",
          "--max-time",
          "180",
          "-o",
          tarPath,
          NX2A_ARCHIVE_URL,
        ],
        { timeout: 190000 }
      );
      await execFileAsync("/usr/bin/tar", ["-xzf", tarPath, "-C", extractDir], {
        timeout: 60000,
      });

      const entries = fs.readdirSync(extractDir);
      const extractedRoot = entries
        .map((e) => path.join(extractDir, e))
        .find((p) => fs.existsSync(path.join(p, "porter")));
      if (!extractedRoot) {
        throw new Error(
          "Arquivo extraído do nx2android não contém pasta porter/"
        );
      }

      fs.mkdirSync(targetDir, { recursive: true });
      await execFileAsync(
        "/usr/bin/rsync",
        [
          "-a",
          "--delete",
          "--exclude",
          "toolchains",
          "--exclude",
          NX2A_SYNC_SHA_FILE,
          `${extractedRoot}/`,
          `${targetDir}/`,
        ],
        { timeout: 90000 }
      );

      if (remoteSha) {
        fs.writeFileSync(
          path.join(targetDir, NX2A_SYNC_SHA_FILE),
          `${remoteSha}\n`,
          "utf8"
        );
      }

      const shortSha = remoteSha ? remoteSha.slice(0, 7) : "main";
      const msg = `nx2android sincronizado via GitHub (${shortSha}).`;
      AppLogHub.success("nx2android", msg);
      return { ok: true, message: msg };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      AppLogHub.error("nx2android", `Falha ao sincronizar nx2android: ${msg}`);
      return { ok: false, message: msg };
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
