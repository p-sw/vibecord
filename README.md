# vibecord

Vibecord is a Bun + TypeScript Discord bot for Codex session management.

## 1. How to Install

1. Install dependencies:
```bash
bun install
```
2. Ensure Bun is available:
```bash
bun --version
```
3. Ensure Codex CLI is installed and authenticated:
```bash
codex --version
codex login
```

## 2. How to Setup Initials

1. Create a Discord application and bot in the Discord Developer Portal.
2. Enable these bot permissions/intents as needed for your server:
- Send Messages
- Use Slash Commands
- Manage Channels (required for channel mode)
- `MESSAGE CONTENT INTENT` (required so the bot can forward user messages to Codex)
3. Copy your bot token and set environment variables.

DM mode (default):
```bash
export DISCORD_BOT_TOKEN="your-bot-token"
```

Channel mode (auto-create/manage session channels under one category):
```bash
export DISCORD_BOT_TOKEN="your-bot-token"
export DISCORD_GUILD_ID="your-server-id"
export DISCORD_CATEGORY_ID="your-category-id"
```

Optional state file path (default: `.vibecord/sessions.json`):
```bash
export VIBECORD_STATE_FILE="/absolute/path/to/sessions.json"
```

4. Invite the bot to your server with `applications.commands` scope (and `bot` scope for bot permissions).

## 3. How to Use

1. Start the bot:
```bash
bun run watch
```
2. Use slash commands in Discord:
- `/new project:<path> [title]` creates a session.
- `/delete session_id:<id>` deletes a session.
- `/focus session_id:<id>` sets focused session (DM mode only).
- `/list [project]` lists sessions grouped by project path.
3. Chat with Codex from Discord:
- DM mode: send a normal DM to the bot; it forwards the message to your focused session and replies with Codex output.
- Channel mode: send a normal message in a session channel; the bot forwards it to that session and replies in-thread.
4. Behavior by mode:
- DM mode: bot manages your focused session in direct messages.
- Channel mode: bot auto-creates channels for sessions in the configured category.
