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
  rateLimits?: CodexRateLimits;
  contextWindow?: CodexContextWindow;
}

interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface SendMessageOptions {
  includeRateLimits?: boolean;
}

export interface CodexRateLimitWindow {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number;
}

interface CodexCredits {
  hasCredits: boolean;
  unlimited: boolean;
  balance: number | null;
}

export interface CodexRateLimits {
  limitId?: string;
  limitName?: string | null;
  primary?: CodexRateLimitWindow;
  secondary?: CodexRateLimitWindow;
  credits?: CodexCredits;
  planType?: string | null;
}

export interface CodexContextWindow {
  usedTokens: number;
  maxTokens: number;
  percentLeft: number;
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
    options: SendMessageOptions = {},
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
        options.includeRateLimits === true,
      );
      const result = await runProcess(CODEX_BINARY, commandArgs, cwd);

      try {
        if (result.exitCode !== 0) {
          throw new Error(buildCodexFailureMessage(result));
        }

        const combinedOutput = [result.stdout, result.stderr].join("\n");
        const threadId =
          parseSessionId(combinedOutput) ?? session.codexThreadId;
        const rateLimits = parseRateLimits(combinedOutput);
        const contextWindow = parseContextWindow(combinedOutput);

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
          rateLimits,
          contextWindow,
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
  includeRateLimits: boolean,
): string[] {
  const baseArgs = [
    "exec",
    "--color",
    "never",
    "--skip-git-repo-check",
    "--output-last-message",
    outputFilePath,
  ];

  if (includeRateLimits) {
    baseArgs.push("--json");
  }

  if (threadId) {
    return [
      ...baseArgs,
      "resume",
      threadId,
      prompt,
    ];
  }

  return [
    ...baseArgs,
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
  const eventSessionId = parseSessionIdFromJsonEvents(stdout);

  if (eventSessionId) {
    return eventSessionId;
  }

  const match = CODEX_SESSION_ID_PATTERN.exec(stdout);
  const value = match?.[1]?.trim();
  return value || undefined;
}

function parseSessionIdFromJsonEvents(output: string): string | undefined {
  let sessionId: string | undefined;

  for (const line of output.split("\n")) {
    const parsed = parseJsonLine(line);

    if (!parsed || typeof parsed !== "object") {
      continue;
    }

    const eventType = asString((parsed as Record<string, unknown>).type);

    if (eventType !== "thread.started") {
      continue;
    }

    const candidate = asString((parsed as Record<string, unknown>).thread_id);

    if (candidate) {
      sessionId = candidate;
    }
  }

  return sessionId;
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

function parseRateLimits(output: string): CodexRateLimits | undefined {
  let latest: CodexRateLimits | undefined;

  for (const line of output.split("\n")) {
    const parsed = parseJsonLine(line);

    if (!parsed || typeof parsed !== "object") {
      continue;
    }

    const asRecord = parsed as Record<string, unknown>;
    const directRateLimits = asRecord.type === "token_count" ? asRecord.rate_limits : undefined;
    const payloadValue = asRecord.payload;
    const payload =
      payloadValue && typeof payloadValue === "object"
        ? (payloadValue as Record<string, unknown>)
        : undefined;
    const payloadRateLimits =
      payload?.type === "token_count" ? payload.rate_limits : undefined;
    const rateLimits = normalizeRateLimits(directRateLimits ?? payloadRateLimits);

    if (rateLimits) {
      latest = rateLimits;
    }
  }

  return latest;
}

function parseContextWindow(output: string): CodexContextWindow | undefined {
  let latest: CodexContextWindow | undefined;

  for (const line of output.split("\n")) {
    const parsed = parseJsonLine(line);

    if (!parsed || typeof parsed !== "object") {
      continue;
    }

    const tokenCountInfo = extractTokenCountInfo(parsed as Record<string, unknown>);

    if (!tokenCountInfo) {
      continue;
    }

    const usedTokens = Math.max(0, Math.min(tokenCountInfo.totalTokens, tokenCountInfo.maxTokens));
    const percentLeft = Math.max(0, Math.min(100, ((tokenCountInfo.maxTokens - usedTokens) / tokenCountInfo.maxTokens) * 100));

    latest = {
      usedTokens,
      maxTokens: tokenCountInfo.maxTokens,
      percentLeft,
    };
  }

  return latest;
}

function extractTokenCountInfo(
  event: Record<string, unknown>,
): { totalTokens: number; maxTokens: number } | undefined {
  const directInfo = event.type === "token_count" ? event.info : undefined;
  const payloadValue = event.payload;
  const payload =
    payloadValue && typeof payloadValue === "object"
      ? (payloadValue as Record<string, unknown>)
      : undefined;
  const payloadInfo = payload?.type === "token_count" ? payload.info : undefined;

  return normalizeTokenCountInfo(directInfo ?? payloadInfo);
}

function normalizeTokenCountInfo(
  value: unknown,
): { totalTokens: number; maxTokens: number } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const modelContextWindow = asFiniteNumber(record.model_context_window);
  const totalTokenUsageValue = record.total_token_usage;
  const totalTokenUsage =
    totalTokenUsageValue && typeof totalTokenUsageValue === "object"
      ? (totalTokenUsageValue as Record<string, unknown>)
      : undefined;
  const totalTokens = asFiniteNumber(totalTokenUsage?.total_tokens);

  if (
    typeof modelContextWindow === "undefined" ||
    typeof totalTokens === "undefined" ||
    modelContextWindow <= 0
  ) {
    return undefined;
  }

  return {
    totalTokens,
    maxTokens: modelContextWindow,
  };
}

function normalizeRateLimits(value: unknown): CodexRateLimits | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const primary = normalizeRateLimitWindow(record.primary);
  const secondary = normalizeRateLimitWindow(record.secondary);
  const credits = normalizeCredits(record.credits);
  const limitId = asString(record.limit_id);
  const limitName = asStringOrNull(record.limit_name);
  const planType = asStringOrNull(record.plan_type);

  if (!primary && !secondary && !credits && !limitId && !limitName && !planType) {
    return undefined;
  }

  return {
    limitId,
    limitName,
    primary,
    secondary,
    credits,
    planType,
  };
}

function normalizeRateLimitWindow(value: unknown): CodexRateLimitWindow | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const usedPercent = asFiniteNumber(record.used_percent);
  const windowMinutes = asFiniteNumber(record.window_minutes);
  const resetsAt = asFiniteNumber(record.resets_at);

  if (
    typeof usedPercent === "undefined" ||
    typeof windowMinutes === "undefined" ||
    typeof resetsAt === "undefined"
  ) {
    return undefined;
  }

  return {
    usedPercent,
    windowMinutes,
    resetsAt,
  };
}

function normalizeCredits(value: unknown): CodexCredits | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const hasCredits = asBoolean(record.has_credits);
  const unlimited = asBoolean(record.unlimited);
  const balance = asNumberOrNull(record.balance) ?? null;

  if (typeof hasCredits === "undefined" || typeof unlimited === "undefined") {
    return undefined;
  }

  return {
    hasCredits,
    unlimited,
    balance,
  };
}

function parseJsonLine(line: string): unknown {
  const trimmed = line.trim();

  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function asStringOrNull(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return asString(value);
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value !== "boolean") {
    return undefined;
  }

  return value;
}

function asNumberOrNull(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }

  return asFiniteNumber(value);
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
