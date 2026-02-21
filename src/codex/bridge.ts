import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { readFile, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { SessionStore } from "../session/store.ts";
import type { SessionRecord } from "../session/types.ts";

const CODEX_BINARY = "codex";
const CODEX_SESSION_ID_PATTERN =
  /session id:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export interface CodexTurnResult {
  threadId: string;
  reply: string;
}

interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class CodexBridge {
  private readonly store: SessionStore;
  private readonly sessionQueue = new Map<string, Promise<void>>();

  constructor(store: SessionStore) {
    this.store = store;
  }

  async sendMessage(
    session: SessionRecord,
    prompt: string,
  ): Promise<CodexTurnResult> {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      throw new Error("Prompt cannot be empty.");
    }

    return this.withSessionLock(session.id, async () => {
      const cwd = await resolveCodexWorkingDirectory(session.projectPath);
      const outputFilePath = resolve(
        tmpdir(),
        `vibecord-codex-reply-${randomUUID()}.txt`,
      );
      const commandArgs = buildCodexCommandArgs(
        session.codexThreadId,
        trimmedPrompt,
        outputFilePath,
      );
      const result = await runProcess(CODEX_BINARY, commandArgs, cwd);

      try {
        if (result.exitCode !== 0) {
          throw new Error(buildCodexFailureMessage(result));
        }

        const combinedOutput = [result.stdout, result.stderr].join("\n");
        const threadId =
          parseSessionId(combinedOutput) ?? session.codexThreadId;

        if (!threadId) {
          throw new Error(
            "Codex did not expose a session id. Check Codex CLI configuration and try again.",
          );
        }

        const reply = await readAssistantReply(outputFilePath, combinedOutput);

        if (!reply) {
          throw new Error(
            "Codex did not return an assistant reply. Try sending the message again.",
          );
        }

        if (threadId !== session.codexThreadId) {
          await this.store.setSessionCodexThreadId(session.id, threadId);
        }

        return {
          threadId,
          reply,
        };
      } finally {
        await cleanupFile(outputFilePath);
      }
    });
  }

  private async withSessionLock<T>(
    sessionId: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const previous = this.sessionQueue.get(sessionId) ?? Promise.resolve();
    const runPromise = previous.then(run, run);
    const settled = runPromise.then(
      () => undefined,
      () => undefined,
    );

    this.sessionQueue.set(sessionId, settled);

    try {
      return await runPromise;
    } finally {
      if (this.sessionQueue.get(sessionId) === settled) {
        this.sessionQueue.delete(sessionId);
      }
    }
  }
}

function buildCodexCommandArgs(
  threadId: string | undefined,
  prompt: string,
  outputFilePath: string,
): string[] {
  if (threadId) {
    return [
      "exec",
      "--color",
      "never",
      "--skip-git-repo-check",
      "--output-last-message",
      outputFilePath,
      "resume",
      threadId,
      prompt,
    ];
  }

  return [
    "exec",
    "--color",
    "never",
    "--skip-git-repo-check",
    "--output-last-message",
    outputFilePath,
    prompt,
  ];
}

async function resolveCodexWorkingDirectory(projectPath: string): Promise<string> {
  const resolvedPath = resolve(projectPath);

  try {
    const details = await stat(resolvedPath);

    if (details.isDirectory()) {
      return resolvedPath;
    }

    if (details.isFile()) {
      return dirname(resolvedPath);
    }
  } catch {
    // Fall back to the current process directory when the project path does not exist yet.
  }

  return process.cwd();
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
): Promise<ProcessResult> {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        rejectResult(
          new Error(
            `Unable to find "${CODEX_BINARY}" in PATH. Install Codex CLI and retry.`,
          ),
        );
        return;
      }

      rejectResult(error);
    });

    child.once("close", (code) => {
      resolveResult({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function parseSessionId(stdout: string): string | undefined {
  const match = CODEX_SESSION_ID_PATTERN.exec(stdout);
  const value = match?.[1]?.trim();
  return value || undefined;
}

function parseAssistantReply(stdout: string): string | undefined {
  const normalized = stdout.replace(/\r/g, "").trim();

  if (!normalized) {
    return undefined;
  }

  const marker = "\nassistant\n";
  const markerIndex = normalized.lastIndexOf(marker);

  if (markerIndex !== -1) {
    const reply = normalized.slice(markerIndex + marker.length).trim();
    return reply || undefined;
  }

  if (normalized.startsWith("assistant\n")) {
    const reply = normalized.slice("assistant\n".length).trim();
    return reply || undefined;
  }

  return undefined;
}

function buildCodexFailureMessage(result: ProcessResult): string {
  const stderr = result.stderr
    .replace(/\r/g, "")
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const stdout = result.stdout
    .replace(/\r/g, "")
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const detail = stderr.at(-1) ?? stdout.at(-1) ?? "Codex command failed.";

  return `Codex command failed (exit ${result.exitCode}): ${detail}`;
}

async function readAssistantReply(
  outputFilePath: string,
  combinedOutput: string,
): Promise<string | undefined> {
  try {
    const reply = (await readFile(outputFilePath, "utf8")).trim();

    if (reply) {
      return reply;
    }
  } catch {
    // Fallback to stream parsing for older/newer CLI behavior differences.
  }

  return parseAssistantReply(combinedOutput);
}

async function cleanupFile(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}
