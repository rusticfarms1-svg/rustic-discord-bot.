# Rustic Discord Bot

This is a standalone conversion of the supplied `rustic bot.json` VibeBot export.

## Setup
1. Install Node.js 18.17+ (Node 20+ recommended).
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Put your Discord bot token, application/client ID, and server ID in `.env`.
5. Run `npm start`.

## Important
This conversion replaces VibeBot persistent storage (`botData`) with a local `data.json` file. It also provides compatibility helpers used by the exported code. Some builder-specific behavior may still need adjustment if it depended on VibeBot-only services.

Keep `.env` private and never upload your bot token.
