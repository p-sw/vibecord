import { startDiscordBot } from "./src/discord/bot.ts";

const command = process.argv[2];

function usage() {
  console.log(`
vibecord - Codex Discord session helper

Usage:
  bun run index.ts <command>

Commands:
  launch   Launch a new Codex session
  manage   Manage existing Codex sessions
  watch    Start the Discord bot and watch live session activity
`);
}

async function run(): Promise<void> {
  switch (command) {
    case "launch":
      console.log("Launching a new Codex session... (stub)");
      break;
    case "manage":
      console.log("Managing Codex sessions... (stub)");
      break;
    case "watch":
      await startDiscordBot();
      break;
    default:
      usage();
  }
}

await run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`vibecord failed: ${message}`);
  process.exitCode = 1;
});
