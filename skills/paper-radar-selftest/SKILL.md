---
name: paper-radar-selftest
description: Run the Paper Radar self-test. Use when the user asks to check, test, or debug the Paper Radar plugin, or says Paper Radar is not working.
---

# Paper Radar self-test

Use this skill to confirm that the Paper Radar MCP server started and can reach its data sources.

## Steps

1. Call the `self_test` tool from the `paper-radar` MCP server.
2. Report the result in a short table with one row per source: arXiv, OpenAlex, and arXiv full text. Include reachable or not, the response time, and the sample title.
3. Add one line with the Node version, the platform, and whether an OpenAlex API key is configured.

## If something fails

- If the `paper-radar` tools are not available at all, say that the MCP server did not start. Ask the user to check that Node.js 18 or newer is installed where the agent runs.
- If a source reports an error, quote its `error` field exactly. Do not guess at the cause.
- If OpenAlex reports that its daily budget is used up, explain that arXiv tools still work, and that a free personal key from https://openalex.org/settings/api raises the limit. The key goes in the `OPENALEX_API_KEY` environment variable.
