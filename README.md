# vibecord

Vibecord is a Bun + TypeScript Discord bot for Codex session management.

## 1. Install

Install globally:
```bash
npm i -g vibecord
```

Ensure Bun is available:
```bash
bun --version
```

Ensure Codex CLI is installed and authenticated:
```bash
codex --version
codex login
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
- Sets Discord token + mode (`dm` or `channel`)
- Sets state file path (default: `~/.local/state/vibecord/sessions.json`)
- Optionally builds a standalone Bun binary
- Optionally writes and enables a Linux systemd service

Example config:
```json
{
  "discordBotToken": "your-bot-token",
  "mode": "dm",
  "stateFilePath": "/home/you/.local/state/vibecord/sessions.json"
}
```

Channel mode config example:
```json
{
  "discordBotToken": "your-bot-token",
  "mode": "channel",
  "guildId": "your-server-id",
  "categoryId": "your-category-id",
  "stateFilePath": "/home/you/.local/state/vibecord/sessions.json"
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
- `/focus session_id:<id>` sets focused session (DM mode only).
- `/list [project]` lists sessions grouped by project path.

Chat with Codex from Discord:
- DM mode: send a normal DM to the bot; it forwards the message to your focused session and replies with Codex output.
- Channel mode: send a normal message in a session channel; the bot forwards it to that session and replies in-thread.

Behavior by mode:
- DM mode: bot manages your focused session in direct messages.
- Channel mode: bot auto-creates channels for sessions in the configured category.
