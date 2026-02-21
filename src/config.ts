import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export type BotMode = "dm" | "channel";

interface BaseBotConfig {
  token: string;
  mode: BotMode;
  stateFilePath: string;
}

export interface DmBotConfig extends BaseBotConfig {
  mode: "dm";
}

export interface ChannelBotConfig extends BaseBotConfig {
  mode: "channel";
  guildId: string;
  categoryId: string;
}

export type BotConfig = DmBotConfig | ChannelBotConfig;

interface BotConfigFile {
  discordBotToken?: unknown;
  mode?: unknown;
  guildId?: unknown;
  categoryId?: unknown;
  stateFilePath?: unknown;
}

export interface WritableBotConfig {
  token: string;
  mode: BotMode;
  guildId?: string;
  categoryId?: string;
  stateFilePath: string;
}

const DEFAULT_CONFIG_FILE_PATH = resolve(
  homedir(),
  ".config",
  "vibecord",
  "config.json",
);
const DEFAULT_STATE_FILE_PATH = resolve(
  homedir(),
  ".local",
  "state",
  "vibecord",
  "sessions.json",
);

export function getDefaultConfigFilePath(): string {
  return DEFAULT_CONFIG_FILE_PATH;
}

export function getDefaultStateFilePath(): string {
  return DEFAULT_STATE_FILE_PATH;
}

export function resolveConfigFilePath(configFilePath?: string): string {
  return resolve(configFilePath?.trim() || DEFAULT_CONFIG_FILE_PATH);
}

export async function writeBotConfigFile(
  configFilePath: string,
  config: WritableBotConfig,
): Promise<void> {
  const mode = config.mode;
  const token = config.token.trim();
  const stateFilePath = config.stateFilePath.trim();

  if (!token) {
    throw new Error('Config value "discordBotToken" cannot be empty.');
  }

  if (!stateFilePath) {
    throw new Error('Config value "stateFilePath" cannot be empty.');
  }

  const payload: Record<string, string> = {
    discordBotToken: token,
    mode,
    stateFilePath,
  };

  if (mode === "channel") {
    const guildId = config.guildId?.trim();
    const categoryId = config.categoryId?.trim();

    if (!guildId || !categoryId) {
      throw new Error('Channel mode requires "guildId" and "categoryId".');
    }

    payload.guildId = guildId;
    payload.categoryId = categoryId;
  }

  const resolvedPath = resolveConfigFilePath(configFilePath);

  await mkdir(dirname(resolvedPath), {
    recursive: true,
  });

  await writeFile(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function loadBotConfig(configFilePath?: string): Promise<BotConfig> {
  const resolvedConfigFilePath = resolveConfigFilePath(configFilePath);

  let rawFile: string;

  try {
    rawFile = await readFile(resolvedConfigFilePath, "utf8");
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      throw new Error(
        `Config file not found at ${resolvedConfigFilePath}. Run "vibecord setup" to create it.`,
      );
    }

    throw error;
  }

  let parsed: BotConfigFile;

  try {
    parsed = JSON.parse(rawFile) as BotConfigFile;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Config file ${resolvedConfigFilePath} is not valid JSON: ${message}`,
    );
  }

  const token = asTrimmedString(parsed.discordBotToken);
  const modeValue = asTrimmedString(parsed.mode);
  const guildId = asTrimmedString(parsed.guildId);
  const categoryId = asTrimmedString(parsed.categoryId);
  const rawStateFilePath = asTrimmedString(parsed.stateFilePath);
  const stateFilePath = resolve(
    dirname(resolvedConfigFilePath),
    rawStateFilePath || DEFAULT_STATE_FILE_PATH,
  );

  if (!token) {
    throw new Error(`Config ${resolvedConfigFilePath} is missing "discordBotToken".`);
  }

  if (modeValue !== "dm" && modeValue !== "channel") {
    throw new Error(
      `Config ${resolvedConfigFilePath} must set "mode" to "dm" or "channel".`,
    );
  }

  if (modeValue === "channel") {
    if (!guildId || !categoryId) {
      throw new Error(
        `Channel mode requires both "guildId" and "categoryId" in ${resolvedConfigFilePath}.`,
      );
    }

    return {
      token,
      mode: "channel",
      guildId,
      categoryId,
      stateFilePath,
    };
  }

  return {
    token,
    mode: "dm",
    stateFilePath,
  };
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
