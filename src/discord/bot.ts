import { Client, GatewayIntentBits } from "discord.js";
import { loadBotConfig } from "../config.ts";
import { SessionStore } from "../session/store.ts";
import { syncSessionChannels } from "./channel-mode.ts";
import { attachCommandHandlers, registerCommands } from "./commands.ts";

export async function startDiscordBot(): Promise<void> {
  const config = loadBotConfig();
  const store = new SessionStore(config.stateFilePath);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  });

  attachCommandHandlers({
    client,
    config,
    store,
  });

  client.once("clientReady", async (readyClient) => {
    console.log(
      `Discord bot connected as ${readyClient.user.tag} (mode: ${config.mode})`,
    );

    try {
      await registerCommands(client, config);
      console.log("Slash commands registered.");

      if (config.mode === "channel") {
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
