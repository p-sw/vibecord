import { startDiscordBot } from "./src/discord/bot.ts";

await startDiscordBot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`vibecord failed: ${message}`);
  process.exitCode = 1;
});
