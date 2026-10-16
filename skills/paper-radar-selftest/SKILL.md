---
name: paper-radar-selftest
description: Run the Paper Radar self-test. Use when the user asks to check, test, or debug the Paper Radar plugin, or says Paper Radar is not working.
---

# Paper Radar self-test

Use this skill to confirm that the Paper Radar MCP server started and can reach its data sources.

## Steps

1. Call the `hello` tool from the `paper-radar` MCP server.
2. Call the `check_sources` tool with no arguments.
3. Report the results to the user in a short table with these rows:
   - Server started: yes or no, with the Node version and platform from `hello`.
   - arXiv: reachable or not, response time, and the sample title.
   - OpenAlex: reachable or not, response time, and the sample title.

## If something fails

- If the `paper-radar` tools are not available at all, say that the MCP server did not start. Ask the user to check that Node.js 18 or newer is installed where the agent runs.
- If `check_sources` reports an error for one source, quote the `status` or `error` field exactly. Do not guess at the cause.
