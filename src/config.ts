import { resolve } from "node:path";

const DISCORD_BOT_TOKEN_ENV = "DISCORD_BOT_TOKEN";
const DISCORD_GUILD_ID_ENV = "DISCORD_GUILD_ID";
const DISCORD_CATEGORY_ID_ENV = "DISCORD_CATEGORY_ID";
const VIBECORD_STATE_FILE_ENV = "VIBECORD_STATE_FILE";

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

export function loadBotConfig(): BotConfig {
  const token = process.env[DISCORD_BOT_TOKEN_ENV]?.trim();
  const guildId = process.env[DISCORD_GUILD_ID_ENV]?.trim();
  const categoryId = process.env[DISCORD_CATEGORY_ID_ENV]?.trim();
  const stateFilePath = resolve(
    process.env[VIBECORD_STATE_FILE_ENV]?.trim() ||
      ".vibecord/sessions.json",
  );

  if (!token) {
    throw new Error(
      `Missing ${DISCORD_BOT_TOKEN_ENV}. Set it in your environment before running the watch command.`,
    );
  }

  if ((guildId && !categoryId) || (!guildId && categoryId)) {
    throw new Error(
      `Set both ${DISCORD_GUILD_ID_ENV} and ${DISCORD_CATEGORY_ID_ENV} to enable channel mode, or set neither to use DM mode.`,
    );
  }

  if (guildId && categoryId) {
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
