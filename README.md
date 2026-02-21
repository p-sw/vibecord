# vibecord

Vibecord is a Discord bot for Codex session management.

## 1. Install

Install globally:
```bash
npm i -g vibecord
```

Ensure Codex CLI is installed and authenticated:
```bash
codex --version
codex login
```

For interactive slash commands (`/status`, `/compact`, `/init`), ensure `script` (from util-linux) is available on PATH:
```bash
script --version
```

## 2. Initial Setup

1. Create a Discord application and bot in the Discord Developer Portal.
2. Enable required bot permissions/intents:
- Send Messages
- Use Slash Commands
- Manage Channels (required for channel mode)
- `MESSAGE CONTENT INTENT`
3. Run interactive setup:
```bash
vibecord setup
```

Setup flow:
- Writes config JSON (default: `~/.config/vibecord/config.json`)
- Sets Discord token
- Optionally sets channel-sync values (`guildId` + `categoryId`)
- Sets state file path (default: `~/.local/state/vibecord/sessions.json`)
- Optionally sets DM allowlist user IDs (`dmAllowlistUserIds`)
- Optionally writes and enables a Linux systemd service

Example config:
```json
{
  "discordBotToken": "your-bot-token",
  "stateFilePath": "/home/you/.local/state/vibecord/sessions.json",
  "dmAllowlistUserIds": ["123456789012345678"]
}
```

DM + channel config example:
```json
{
  "discordBotToken": "your-bot-token",
  "guildId": "your-server-id",
  "categoryId": "your-category-id",
  "stateFilePath": "/home/you/.local/state/vibecord/sessions.json",
  "dmAllowlistUserIds": ["123456789012345678", "234567890123456789"]
}
```

Optional custom config path:
```bash
vibecord setup --config /path/to/config.json
```

4. Invite the bot to your server with `applications.commands` scope (and `bot` scope).

## 3. Run

Start directly:
```bash
vibecord start
```

With custom config file:
```bash
vibecord start --config /path/to/config.json
```

Use slash commands in Discord:
- `/new project:<path> [title]` creates a session.
- `/delete session_id:<id>` deletes a session.
- `/focus session_id:<id>` sets focused session for DM chats.
- `/list [project]` lists sessions grouped by project path.
- `/status [session_id]` prints Codex status plus usage-limit/reset-time info for a session and appends a context-left footer (defaults to channel-linked or focused session).
- `/compact [session_id]` runs Codex `/compact` in a session (defaults to channel-linked or focused session).
- `/init [session_id]` runs Codex `/init` in a session (defaults to channel-linked or focused session).

Slash command execution notes:
- `/status`, `/compact`, and `/init` are executed through Codex interactive session mode, not `codex exec`.

Chat with Codex from Discord:
- DM mode: send a normal DM to the bot; it forwards the message to your focused session and replies with Codex output. If `dmAllowlistUserIds` is set, only listed users can send DM prompts to Codex.
- Channel mode (enabled when `guildId` + `categoryId` are set): send a normal message in a session channel; the bot forwards it to that session and replies in-thread.

Behavior by mode:
- DM mode: bot manages your focused session in direct messages.
- With `guildId` + `categoryId` configured, channel mode is enabled in addition to DM mode, and the bot auto-creates channels for sessions in the configured category.

## 4. Packaging Notes

- End users do not need Bun or Node.js runtime.
- The published npm package exposes the prebuilt `dist/vibecord` binary directly via `directories.bin`.
- Maintainers need Bun to build publish artifacts.
- Default publish target is Linux x64 (`bun-linux-x64`).
- Build before publish via:
```bash
npm run build:binary
```
- Override target when needed:
```bash
VIBECORD_BINARY_TARGET=bun-linux-arm64 npm run build:binary
```
