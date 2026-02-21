# Repository Guidelines

## Project Summary
Vibecord is a Bun + TypeScript Discord bot project for Codex session operations in Discord.

## Project Structure & Module Organization
- `index.ts`: process entrypoint that starts the Discord bot runtime.
- `src/config.ts`: environment configuration and mode detection (`dm` or `channel`).
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
- `bun install`: install dependencies from `package.json`.
- `bun run start`: start the Discord bot.
- `bun run dev`: same as start for local iteration.

Example:
```bash
bun run index.ts
```

## Runtime Configuration
- `DISCORD_BOT_TOKEN` (required): Discord bot token.
- `DISCORD_GUILD_ID` + `DISCORD_CATEGORY_ID` (optional pair): enables channel mode; if either is set, both must be set.
- `VIBECORD_STATE_FILE` (optional): absolute/relative path for session state JSON file (default `.vibecord/sessions.json`).
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
- Keep runtime credentials in local environment variables (`DISCORD_BOT_TOKEN`, optional `DISCORD_GUILD_ID`, `DISCORD_CATEGORY_ID`).
- Validate user input from slash commands and messages before invoking external services.

## Maintenance Rule
- Update `AGENTS.md` whenever any referenced workflow, command, structure, or policy changes.
- Update `AGENTS.md` whenever new "must remember" contributor guidance is added or existing guidance is changed.
