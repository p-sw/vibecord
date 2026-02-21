import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export interface BotConfig {
  token: string;
  stateFilePath: string;
  guildId?: string;
  categoryId?: string;
  channelModeEnabled: boolean;
}

export interface ChannelEnabledBotConfig extends BotConfig {
  guildId: string;
  categoryId: string;
  channelModeEnabled: true;
}

interface BotConfigFile {
  discordBotToken?: unknown;
  mode?: unknown;
  guildId?: unknown;
  categoryId?: unknown;
  stateFilePath?: unknown;
}

export interface WritableBotConfig {
  token: string;
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
  const token = config.token.trim();
  const stateFilePath = config.stateFilePath.trim();
  const guildId = config.guildId?.trim();
  const categoryId = config.categoryId?.trim();

  if (!token) {
    throw new Error('Config value "discordBotToken" cannot be empty.');
  }

  if (!stateFilePath) {
    throw new Error('Config value "stateFilePath" cannot be empty.');
  }

  if ((guildId && !categoryId) || (!guildId && categoryId)) {
    throw new Error('Set both "guildId" and "categoryId", or set neither.');
  }

  const payload: Record<string, string> = {
    discordBotToken: token,
    stateFilePath,
  };

  if (guildId && categoryId) {
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

  if (modeValue && modeValue !== "dm" && modeValue !== "channel") {
    throw new Error(
      `Config ${resolvedConfigFilePath} has invalid "mode" value. Use "dm" or "channel".`,
    );
  }

  if ((guildId && !categoryId) || (!guildId && categoryId)) {
    throw new Error(
      `Config ${resolvedConfigFilePath} must set both "guildId" and "categoryId", or set neither.`,
    );
  }

  if (modeValue === "channel" && !guildId) {
    throw new Error(
      `Config ${resolvedConfigFilePath} sets "mode" to "channel" but is missing "guildId" and "categoryId".`,
    );
  }

  const channelModeEnabled = Boolean(guildId && categoryId);

  return {
    token,
    stateFilePath,
    guildId,
    categoryId,
    channelModeEnabled,
  };
}

export function hasChannelMode(
  config: BotConfig,
): config is ChannelEnabledBotConfig {
  return config.channelModeEnabled;
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
