import {
  ChatInputCommandInteraction,
  Client,
  SlashCommandBuilder,
} from "discord.js";
import { hasChannelMode, type BotConfig } from "../config.ts";
import { SessionStore } from "../session/store.ts";
import type { SessionRecord } from "../session/types.ts";
import {
  deleteSessionChannel,
  ensureSessionChannel,
} from "./channel-mode.ts";

const commandBuilders = [
  new SlashCommandBuilder()
    .setName("new")
    .setDescription("Create a new session")
    .addStringOption((option) =>
      option
        .setName("project")
        .setDescription("Project directory/path used to categorize this session")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("title")
        .setDescription("Optional display title for the session")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("delete")
    .setDescription("Delete an existing session")
    .addStringOption((option) =>
      option
        .setName("session_id")
        .setDescription("Session ID to delete")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("focus")
    .setDescription("Set your focused session for DM chats")
    .addStringOption((option) =>
      option
        .setName("session_id")
        .setDescription("Session ID to focus")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("list")
    .setDescription("List all sessions grouped by project")
    .addStringOption((option) =>
      option
        .setName("project")
        .setDescription("Optional project filter")
        .setRequired(false),
    ),
];

const commandPayload = commandBuilders.map((builder) => builder.toJSON());

interface CommandContext {
  client: Client;
  config: BotConfig;
  store: SessionStore;
}

export async function registerCommands(
  client: Client,
  _config: BotConfig,
): Promise<void> {
  if (!client.application) {
    throw new Error("Discord application client is not ready for command registration.");
  }

  await client.application.commands.set(commandPayload);
  await clearGuildScopedCommands(client);
}

export function attachCommandHandlers(context: CommandContext): void {
  const { client } = context;

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      await handleCommand(interaction, context);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: `Error: ${message}` });
        return;
      }

      await interaction.reply({ content: `Error: ${message}` });
    }
  });
}

async function handleCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  switch (interaction.commandName) {
    case "new":
      await handleNewCommand(interaction, context);
      return;
    case "delete":
      await handleDeleteCommand(interaction, context);
      return;
    case "focus":
      await handleFocusCommand(interaction, context);
      return;
    case "list":
      await handleListCommand(interaction, context);
      return;
    default:
      await interaction.reply({
        content: `Unknown command: ${interaction.commandName}`,
      });
  }
}

async function handleNewCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const projectPath = interaction.options.getString("project", true).trim();
  const title = interaction.options.getString("title")?.trim();

  const session = await context.store.createSession({
    projectPath,
    title,
    createdByUserId: interaction.user.id,
  });

  let channelMessage = "";

  if (hasChannelMode(context.config)) {
    const channel = await ensureSessionChannel(
      context.client,
      context.config,
      context.store,
      session,
    );
    channelMessage = `\nChannel: <#${channel.id}>`;
  }

  await context.store.setFocusedSessionId(interaction.user.id, session.id);

  const focusMessage = `\nFocused session: \`${session.id}\``;
  const chatHint = hasChannelMode(context.config)
    ? "\nSend a DM to the bot or a message in the session channel to chat with Codex."
    : "\nSend a DM to the bot to chat with this session.";

  await interaction.reply({
    content:
      `Created session \`${session.id}\`\n` +
      `Project: \`${session.projectPath}\`\n` +
      `Title: ${session.title}` +
      channelMessage +
      focusMessage +
      chatHint,
  });
}

async function handleDeleteCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const sessionId = interaction.options.getString("session_id", true).trim();
  const deleted = await context.store.deleteSession(sessionId);

  if (!deleted) {
    await interaction.reply({
      content: `Session \`${sessionId}\` was not found.`,
    });
    return;
  }

  await deleteSessionChannel(context.client, context.config, deleted);

  await interaction.reply({
    content: `Deleted session \`${deleted.id}\` (${deleted.projectPath}).`,
  });
}

async function handleFocusCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const sessionId = interaction.options.getString("session_id", true).trim();
  const session = await context.store.getSession(sessionId);

  if (!session) {
    await interaction.reply({
      content: `Session \`${sessionId}\` was not found.`,
    });
    return;
  }

  await context.store.setFocusedSessionId(interaction.user.id, session.id);

  await interaction.reply({
    content: `Focused session set to \`${session.id}\` (${session.projectPath}).`,
  });
}

async function handleListCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const projectFilter = interaction.options.getString("project")?.trim();
  const sessions = await context.store.listSessions();
  const filtered = projectFilter
    ? sessions.filter((session) => session.projectPath === projectFilter)
    : sessions;

  if (filtered.length === 0) {
    const filterMessage = projectFilter
      ? ` for project \`${projectFilter}\``
      : "";

    await interaction.reply({
      content: `No sessions found${filterMessage}.`,
    });
    return;
  }

  const focusedSessionId = await context.store.getFocusedSessionId(interaction.user.id);

  const groupedByProject = groupByProject(filtered);
  const messageLines: string[] = [];

  if (focusedSessionId) {
    messageLines.push(`Focused session: \`${focusedSessionId}\``);
    messageLines.push("");
  }

  for (const [projectPath, projectSessions] of groupedByProject) {
    messageLines.push(`Project: \`${projectPath}\``);

    for (const session of projectSessions) {
      const focusTag =
        focusedSessionId && focusedSessionId === session.id ? " [focused]" : "";
      const channelTag = session.channelId ? ` <#${session.channelId}>` : "";

      messageLines.push(
        `- \`${session.id}\`${focusTag}: ${session.title}${channelTag}`,
      );
    }

    messageLines.push("");
  }

  await interaction.reply({
    content: clipForDiscord(messageLines.join("\n").trim()),
  });
}

function groupByProject(
  sessions: SessionRecord[],
): Array<[projectPath: string, sessions: SessionRecord[]]> {
  const map = new Map<string, SessionRecord[]>();

  for (const session of sessions) {
    const bucket = map.get(session.projectPath);

    if (bucket) {
      bucket.push(session);
      continue;
    }

    map.set(session.projectPath, [session]);
  }

  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function clipForDiscord(content: string): string {
  if (content.length <= 1900) {
    return content;
  }

  return `${content.slice(0, 1850)}\n... output truncated ...`;
}

async function clearGuildScopedCommands(client: Client): Promise<void> {
  const guildReferences = await client.guilds.fetch();

  for (const guildReference of guildReferences.values()) {
    try {
      const guild = await client.guilds.fetch(guildReference.id);
      await guild.commands.set([]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `Failed to clear guild command overrides for ${guildReference.id}: ${message}`,
      );
    }
  }
}
