# Paper Radar

Paper Radar is a plugin for [Grok Bot](https://x.ai/bot) and [Cursor](https://cursor.com) that helps an agent find, track, and read research papers. It uses free public data from [arXiv](https://arxiv.org) and [OpenAlex](https://openalex.org).

> **Status: validation build (0.0.1).** This version only contains self-test tools. It exists to confirm that the plugin installs and its MCP server starts in Grok Bot and Cursor. Paper search and tracking tools come next.

## What is included

| Component | Name | Purpose |
|---|---|---|
| MCP tool | `hello` | Confirms the server started, and reports the Node version, OS, and plugin path. |
| MCP tool | `check_sources` | Confirms arXiv and OpenAlex are reachable, and returns one sample title from each. |
| Skill | `paper-radar-selftest` | Tells the agent how to run both tools and report the result. |

## How it runs

The MCP server is a single Node.js file with **no dependencies**: `server/server.mjs`. The plugin starts it over stdio on the machine where the agent runs. For Cursor, that is your computer. For Grok Bot, that is the bot's cloud computer. Paper Radar has no hosted service and no account.

Requirement: Node.js 18 or newer.

Paper Radar stores no user data. It only sends your search words to arXiv and OpenAlex.

## Install for local testing

**Cursor:** copy or clone this repository to `~/.cursor/plugins/local/paper-radar`, then run **Developer: Reload Window**.

**Grok Bot:** ask the bot to add a custom MCP server with this start command, after cloning the repository on the bot's computer:

```bash
node /path/to/paper-radar/server/server.mjs
```

Then ask: "Run the Paper Radar self-test."

## Develop

```bash
npm test
```

`npm test` starts the server, runs the MCP handshake, and calls each tool. Use `node scripts/smoke-test.mjs --offline` to skip the network checks.

## License

MIT
