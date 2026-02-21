import {
  ChatInputCommandInteraction,
  Client,
  SlashCommandBuilder,
} from "discord.js";
import {
  CodexBridge,
  type CodexContextWindow,
  type CodexRateLimits,
} from "../codex/bridge.ts";
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
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show Codex status for a session")
    .addStringOption((option) =>
      option
        .setName("session_id")
        .setDescription("Optional session ID (defaults to channel-linked or focused)")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("compact")
    .setDescription("Run Codex /compact for a session")
    .addStringOption((option) =>
      option
        .setName("session_id")
        .setDescription("Optional session ID (defaults to channel-linked or focused)")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("init")
    .setDescription("Run Codex /init for a session")
    .addStringOption((option) =>
      option
        .setName("session_id")
        .setDescription("Optional session ID (defaults to channel-linked or focused)")
        .setRequired(false),
    ),
];

const commandPayload = commandBuilders.map((builder) => builder.toJSON());

interface CommandContext {
  client: Client;
  config: BotConfig;
  store: SessionStore;
  codex: CodexBridge;
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
    case "status":
      await handleStatusCommand(interaction, context);
      return;
    case "compact":
      await handleCompactCommand(interaction, context);
      return;
    case "init":
      await handleInitCommand(interaction, context);
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

async function handleStatusCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const { requestedSessionId, session } = await resolveCommandSession(
    interaction,
    context,
  );

  if (!session) {
    if (requestedSessionId) {
      await interaction.reply({
        content: `Session \`${requestedSessionId}\` was not found.`,
      });
      return;
    }

    await interaction.reply({
      content:
        "No session selected. Use `/status session_id:<id>`, run this in a session channel, or set `/focus` for DM status.",
    });
    return;
  }

  if (!session.codexThreadId) {
    await interaction.reply({
      content:
        `Session \`${session.id}\` has no Codex thread yet. Send a normal message to this session first, then run \`/status\` again.`,
    });
    return;
  }

  await interaction.deferReply();

  const result = await context.codex.sendMessage(session, "/status", {
    includeRateLimits: true,
    interactiveSession: true,
  });
  const usageSummary = formatRateLimitSummary(result.rateLimits);
  const contextWindowFooter = formatContextWindowFooter(result.contextWindow);
  const sections = [`Session \`${session.id}\` status:\n${result.reply}`];

  if (usageSummary) {
    sections.push(`Usage limits:\n${usageSummary}`);
  }

  if (contextWindowFooter) {
    sections.push(contextWindowFooter);
  }

  await interaction.editReply({
    content: clipForDiscord(stripBackticksAroundDiscordTimestamps(sections.join("\n\n"))),
  });
}

async function handleCompactCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const { requestedSessionId, session } = await resolveCommandSession(
    interaction,
    context,
  );

  if (!session) {
    if (requestedSessionId) {
      await interaction.reply({
        content: `Session \`${requestedSessionId}\` was not found.`,
      });
      return;
    }

    await interaction.reply({
      content:
        "No session selected. Use `/compact session_id:<id>`, run this in a session channel, or set `/focus` for DM compact.",
    });
    return;
  }

  if (!session.codexThreadId) {
    await interaction.reply({
      content:
        `Session \`${session.id}\` has no Codex thread yet. Send a normal message to this session first, then run \`/compact\` again.`,
    });
    return;
  }

  await interaction.deferReply();
  const result = await context.codex.sendMessage(session, "/compact", {
    interactiveSession: true,
  });

  await interaction.editReply({
    content: clipForDiscord(`Session \`${session.id}\` compact:\n${result.reply}`),
  });
}

async function handleInitCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const { requestedSessionId, session } = await resolveCommandSession(
    interaction,
    context,
  );

  if (!session) {
    if (requestedSessionId) {
      await interaction.reply({
        content: `Session \`${requestedSessionId}\` was not found.`,
      });
      return;
    }

    await interaction.reply({
      content:
        "No session selected. Use `/init session_id:<id>`, run this in a session channel, or set `/focus` for DM init.",
    });
    return;
  }

  await interaction.deferReply();
  const result = await context.codex.sendMessage(session, "/init", {
    interactiveSession: true,
  });

  await interaction.editReply({
    content: clipForDiscord(`Session \`${session.id}\` init:\n${result.reply}`),
  });
}

async function resolveCommandSession(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<{
  requestedSessionId: string | undefined;
  session: SessionRecord | undefined;
}> {
  const requestedSessionId = interaction.options.getString("session_id")?.trim();
  const session = requestedSessionId
    ? await context.store.getSession(requestedSessionId)
    : await resolveImplicitSession(interaction, context);

  return {
    requestedSessionId,
    session,
  };
}

async function resolveImplicitSession(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<SessionRecord | undefined> {
  if (hasChannelMode(context.config) && interaction.guildId) {
    const sessionInChannel = await context.store.getSessionByChannelId(
      interaction.channelId,
    );

    if (sessionInChannel) {
      return sessionInChannel;
    }
  }

  const focusedSessionId = await context.store.getFocusedSessionId(interaction.user.id);

  if (!focusedSessionId) {
    return undefined;
  }

  return context.store.getSession(focusedSessionId);
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

function formatRateLimitSummary(rateLimits: CodexRateLimits | undefined): string | undefined {
  if (!rateLimits) {
    return undefined;
  }

  const lines: string[] = [];

  if (rateLimits.limitId) {
    lines.push(`Limit ID: \`${rateLimits.limitId}\``);
  }

  if (rateLimits.primary) {
    lines.push(
      formatRateLimitWindow("Primary", rateLimits.primary.usedPercent, rateLimits.primary.windowMinutes, rateLimits.primary.resetsAt),
    );
  }

  if (rateLimits.secondary) {
    lines.push(
      formatRateLimitWindow("Secondary", rateLimits.secondary.usedPercent, rateLimits.secondary.windowMinutes, rateLimits.secondary.resetsAt),
    );
  }

  if (rateLimits.credits) {
    const creditsValue =
      rateLimits.credits.balance === null ? "n/a" : String(rateLimits.credits.balance);
    lines.push(
      `Credits: has_credits=${String(rateLimits.credits.hasCredits)}, unlimited=${String(rateLimits.credits.unlimited)}, balance=${creditsValue}`,
    );
  }

  if (rateLimits.planType) {
    lines.push(`Plan type: ${rateLimits.planType}`);
  }

  if (lines.length === 0) {
    return undefined;
  }

  return lines.join("\n");
}

function formatRateLimitWindow(
  label: string,
  usedPercent: number,
  windowMinutes: number,
  resetAtEpochSeconds: number,
): string {
  const cappedUsed = clampPercent(usedPercent);
  const remainingPercent = clampPercent(100 - cappedUsed);
  const resetAbsolute = `<t:${Math.trunc(resetAtEpochSeconds)}:f>`;
  const resetRelative = `<t:${Math.trunc(resetAtEpochSeconds)}:R>`;

  return (
    `${label}: ${formatPercent(cappedUsed)} used` +
    ` (${formatPercent(remainingPercent)} remaining), window ${windowMinutes}m, resets ${resetAbsolute} (${resetRelative})`
  );
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`;
}

function stripBackticksAroundDiscordTimestamps(content: string): string {
  return content.replace(/`(<t:\d{10}:[A-Za-z]>)`/g, "$1");
}

function formatContextWindowFooter(
  contextWindow: CodexContextWindow | undefined,
): string | undefined {
  if (!contextWindow) {
    return undefined;
  }

  const percentLeft = Math.round(clampPercent(contextWindow.percentLeft));
  return `-# ${percentLeft}% context left`;
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
