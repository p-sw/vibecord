# Repository Guidelines

## Project Summary
Vibecord is a TypeScript Discord bot project for Codex session operations in Discord.

## Project Structure & Module Organization
- `index.ts`: process entrypoint that routes CLI commands (`start`, `setup`, `help`).
- `dist/vibecord`: compiled native binary published to npm and exposed via `directories.bin`.
- `src/cli.ts`: command parsing and interactive setup flow (config + optional systemd registration).
- `src/config.ts`: JSON file configuration loading/writing; DM is always enabled and channel mode is enabled when `guildId` + `categoryId` are configured. DM allowlist is configured via `dmAllowlistUserIds`.
- `src/discord/bot.ts`: Discord client bootstrap.
- `src/discord/commands.ts`: slash command registration and handlers (`/new`, `/delete`, `/focus`, `/list`).
- `src/discord/channel-mode.ts`: session-to-channel sync logic for channel mode.
- `src/discord/message-relay.ts`: Discord message forwarding from DM/session channels into Codex sessions.
- `src/codex/bridge.ts`: Codex CLI bridge for creating/resuming sessions and collecting assistant replies.
- `src/session/store.ts`: JSON-backed persistent session/focus state store.
- `src/session/types.ts`: session and state type definitions.
- `package.json`: runtime metadata and scripts.
- `tsconfig.json`: TypeScript compiler rules (strict mode enabled).
- `README.md`: quick-start usage for contributors.
- `bun.lock`: locked dependency graph.

As features grow, place reusable logic under `src/` and keep `index.ts` as thin bot bootstrap wiring.

## Build, Test, and Development Commands
- `npm i -g vibecord`: install global CLI.
- `bun install`: install dependencies from `package.json`.
- `npm run build:binary`: compile native executable to `dist/vibecord` for publishing (default target `bun-linux-x64`; override via `VIBECORD_BINARY_TARGET`).
- `npm run prepack`: clean/build publish artifact (`dist/vibecord`).
- `vibecord setup`: interactive setup for config and optional service.
- `vibecord start`: start the Discord bot with default config path.
- `vibecord start --config /path/to/config.json`: start with explicit config file.
- `bun run start`: start via local source (same as `vibecord start`).
- `bun run setup`: run interactive setup from local source.
- `bun run dev`: same as `bun run start` for local iteration.

Example:
```bash
bun run index.ts start
```

## Runtime Configuration
- Config file path default: `~/.config/vibecord/config.json` (override with `--config`).
- Config key `discordBotToken` (required): Discord bot token.
- Config keys `guildId` + `categoryId` (optional pair): when both are set, channel mode is enabled in addition to DM mode.
- Config key `stateFilePath` (optional): absolute/relative path for session state JSON file (default `~/.local/state/vibecord/sessions.json`).
- Config key `dmAllowlistUserIds` (optional array): when set and non-empty, only listed Discord user IDs can send DM prompts to Codex.
- `vibecord setup` can register a systemd user/system service on Linux.
- Codex CLI must be installed and authenticated (`codex --version`, `codex login`) on the host running the bot.

## Coding Style & Naming Conventions
- Language: TypeScript (ES modules).
- Indentation: 2 spaces; prefer single-purpose, small functions.
- Naming: `camelCase` for variables/functions, `PascalCase` for types/classes, `SCREAMING_SNAKE_CASE` for constants.
- Keep handlers explicit and side-effect boundaries clear (startup wiring in entrypoint, API logic in modules).
- Follow `tsconfig.json` strictness; avoid `any` unless justified.

## Testing Guidelines
No test suite is committed yet. Add tests with Bun’s built-in test runner (`bun test`) as features are implemented.

- Put tests in `tests/` or next to modules as `*.test.ts`.
- Name tests by behavior (example: `bot streams session updates`).
- Add tests for new bot behavior and error paths before opening a PR.

## Commit & Pull Request Guidelines
Current history is minimal (`Initial commit`), so use concise, imperative commit subjects.

- Always commit after making changes.
- Commit format: `{feat/refactor/fix/...}: description` (example: `refactor: remove CLI command routing`).
- Keep commits focused; avoid mixing refactors and features.
- PRs should include: purpose, scope, test evidence (command output), and linked issue/task.
- For bot behavior changes, include sample logs or Discord-visible output.

## Security & Configuration Tips
- Do not commit secrets (`.env`, Discord tokens, API keys).
- Keep runtime credentials in local config files with restricted permissions.
- Validate user input from slash commands and messages before invoking external services.

## Maintenance Rule
- Update `AGENTS.md` whenever any referenced workflow, command, structure, or policy changes.
- Update `AGENTS.md` whenever new "must remember" contributor guidance is added or existing guidance is changed.
