import {
  ChannelType,
  Client,
  DiscordAPIError,
  type Guild,
  type GuildTextBasedChannel,
} from "discord.js";
import { hasChannelMode, type BotConfig, type ChannelEnabledBotConfig } from "../config.ts";
import { SessionStore } from "../session/store.ts";
import type { SessionRecord } from "../session/types.ts";

interface GuildContext {
  guild: Guild;
}

export async function syncSessionChannels(
  client: Client,
  config: BotConfig,
  store: SessionStore,
): Promise<void> {
  if (!hasChannelMode(config)) {
    return;
  }

  const sessions = await store.listSessions();

  for (const session of sessions) {
    await ensureSessionChannel(client, config, store, session);
  }
}

export async function ensureSessionChannel(
  client: Client,
  config: BotConfig,
  store: SessionStore,
  session: SessionRecord,
): Promise<GuildTextBasedChannel> {
  if (!hasChannelMode(config)) {
    throw new Error("Channel mode is not enabled.");
  }

  const { guild } = await resolveGuildContext(client, config);

  if (session.channelId) {
    const existingChannel = await guild.channels.fetch(session.channelId).catch(() => null);

    if (
      existingChannel &&
      existingChannel.parentId === config.categoryId &&
      existingChannel.type === ChannelType.GuildText
    ) {
      return existingChannel;
    }
  }

  const channel = await guild.channels.create({
    name: buildSessionChannelName(session),
    type: ChannelType.GuildText,
    parent: config.categoryId,
    topic: `Session ${session.id} | Project ${session.projectPath}`,
  });

  await store.setSessionChannelId(session.id, channel.id);

  return channel;
}

export async function resolveConfiguredGuild(
  client: Client,
  config: ChannelEnabledBotConfig,
): Promise<Guild> {
  try {
    return await client.guilds.fetch(config.guildId);
  } catch (error: unknown) {
    const categoryGuild = await resolveGuildByCategory(client, config.categoryId);

    if (categoryGuild) {
      if (categoryGuild.id !== config.guildId) {
        console.warn(
          `Configured guildId ${config.guildId} does not match category ${config.categoryId} guild ${categoryGuild.id}. Using ${categoryGuild.id}.`,
        );
      }

      return categoryGuild;
    }

    if (isUnknownGuildError(error)) {
      throw new Error(
        `Unknown guild (${config.guildId}). Ensure the bot is invited to that server, and the token/guild/category IDs belong to the same server.`,
      );
    }

    throw error;
  }
}

export async function deleteSessionChannel(
  client: Client,
  config: BotConfig,
  session: SessionRecord,
): Promise<void> {
  if (!hasChannelMode(config) || !session.channelId) {
    return;
  }

  const { guild } = await resolveGuildContext(client, config);
  const channel = await guild.channels.fetch(session.channelId).catch(() => null);

  if (!channel) {
    return;
  }

  await channel.delete(`Session ${session.id} deleted.`).catch(() => undefined);
}

async function resolveGuildContext(
  client: Client,
  config: ChannelEnabledBotConfig,
): Promise<GuildContext> {
  const guild = await resolveConfiguredGuild(client, config);
  const category = await guild.channels.fetch(config.categoryId).catch(() => null);

  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error(
      `Category ${config.categoryId} not found in guild ${config.guildId}, or it is not a category channel.`,
    );
  }

  return { guild };
}

function buildSessionChannelName(session: SessionRecord): string {
  const pathSegments = session.projectPath.split(/[\\/]/).filter(Boolean);
  const projectSlug = pathSegments[pathSegments.length - 1] ?? "session";
  const raw = `${projectSlug}-${session.id}`.toLowerCase();
  const cleaned = raw
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return (cleaned || `session-${session.id}`).slice(0, 100);
}

async function resolveGuildByCategory(
  client: Client,
  categoryId: string,
): Promise<Guild | undefined> {
  const channel = await client.channels.fetch(categoryId).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildCategory) {
    return undefined;
  }

  return channel.guild;
}

function isUnknownGuildError(error: unknown): error is DiscordAPIError {
  return error instanceof DiscordAPIError && error.code === 10004;
}
