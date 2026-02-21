import { ChannelType, type Client, type Message } from "discord.js";
import { CodexBridge } from "../codex/bridge.ts";
import { hasChannelMode, type BotConfig } from "../config.ts";
import { SessionStore } from "../session/store.ts";
import type { SessionRecord } from "../session/types.ts";

interface MessageRelayContext {
  client: Client;
  config: BotConfig;
  store: SessionStore;
  codex: CodexBridge;
}

export function attachMessageRelay(context: MessageRelayContext): void {
  const { client } = context;

  client.on("messageCreate", async (message) => {
    if (message.author.bot) {
      return;
    }

    const prompt = message.content.trim();

    if (!prompt) {
      return;
    }

    try {
      await handleMessage(message, context);
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : String(error);
      await message.reply({
        content: clipForDiscord(`Error: ${messageText}`),
      });
    }
  });
}

async function handleMessage(
  message: Message,
  context: MessageRelayContext,
): Promise<void> {
  const prompt = message.content.trim();
  const session = await resolveSession(message, context);

  if (!session) {
    return;
  }

  if (message.channel.isTextBased() && "sendTyping" in message.channel) {
    await message.channel.sendTyping().catch(() => undefined);
  }
  const result = await context.codex.sendMessage(session, prompt);

  await message.reply({
    content: clipForDiscord(result.reply),
  });
}

async function resolveSession(
  message: Message,
  context: MessageRelayContext,
): Promise<SessionRecord | undefined> {
  if (message.channel.type === ChannelType.DM) {
    return resolveDmSession(message, context);
  }

  if (!hasChannelMode(context.config)) {
    return undefined;
  }

  return context.store.getSessionByChannelId(message.channelId);
}

async function resolveDmSession(
  message: Message,
  context: MessageRelayContext,
): Promise<SessionRecord | undefined> {
  if (
    context.config.dmAllowlistUserIds.length > 0 &&
    !context.config.dmAllowlistUserIds.includes(message.author.id)
  ) {
    await message.reply({
      content: "You are not allowed to use DM mode for this bot.",
    });
    return undefined;
  }

  const focusedSessionId = await context.store.getFocusedSessionId(message.author.id);

  if (!focusedSessionId) {
    await message.reply({
      content:
        "No focused session. Create one with `/new`, then set it with `/focus session_id:<id>`.",
    });
    return undefined;
  }

  const focusedSession = await context.store.getSession(focusedSessionId);

  if (!focusedSession) {
    await message.reply({
      content:
        "Your focused session no longer exists. Run `/list`, then set a new `/focus` session.",
    });
    return undefined;
  }

  return focusedSession;
}

function clipForDiscord(content: string): string {
  if (content.length <= 1900) {
    return content;
  }

  return `${content.slice(0, 1850)}\n... output truncated ...`;
}
