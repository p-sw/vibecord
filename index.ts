import { runCli } from "./src/cli.ts";

await runCli().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`vibecord failed: ${message}`);
  process.exitCode = 1;
});
