import { Client, GatewayIntentBits, Partials } from "discord.js";
import { CodexBridge } from "../codex/bridge.ts";
import { hasChannelMode, loadBotConfig } from "../config.ts";
import { SessionStore } from "../session/store.ts";
import { syncSessionChannels } from "./channel-mode.ts";
import { attachCommandHandlers, registerCommands } from "./commands.ts";
import { attachMessageRelay } from "./message-relay.ts";

export async function startDiscordBot(configFilePath?: string): Promise<void> {
  const config = await loadBotConfig(configFilePath);
  const store = new SessionStore(config.stateFilePath);
  const codex = new CodexBridge(store);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  attachCommandHandlers({
    client,
    config,
    store,
    codex,
  });
  attachMessageRelay({
    client,
    config,
    store,
    codex,
  });

  client.once("clientReady", async (readyClient) => {
    const modeLabel = hasChannelMode(config) ? "dm+channel" : "dm";
    console.log(
      `Discord bot connected as ${readyClient.user.tag} (mode: ${modeLabel})`,
    );

    try {
      await registerCommands(client, config);
      console.log("Slash commands registered.");

      if (hasChannelMode(config)) {
        await syncSessionChannels(client, config, store);
        console.log("Channel mode sync complete.");
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Startup sync failed: ${message}`);
    }
  });

  client.on("error", (error) => {
    console.error("Discord client error:", error);
  });

  await client.login(config.token);
}
