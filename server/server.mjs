#!/usr/bin/env node
// Paper Radar MCP server (hello-world validation build).
// Zero dependencies: speaks MCP JSON-RPC over stdio, one message per line.
// Requires Node 18+ (global fetch). stdout carries protocol messages only;
// all diagnostics go to stderr.

import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SERVER_INFO = { name: "paper-radar", version: "0.0.1" };
const SUPPORTED_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USER_AGENT = "paper-radar/0.0.1 (+https://github.com/ZHallen122/paper-radar)";

const TOOLS = [
  {
    name: "hello",
    description:
      "Self-test for the Paper Radar plugin. Returns a greeting plus the runtime environment " +
      "(Node version, OS, plugin root) so you can confirm the MCP server started correctly.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Optional name to greet." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "check_sources",
    description:
      "Checks that the paper data sources (arXiv and OpenAlex) are reachable from this machine " +
      "and returns one sample paper title from each, with response times.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search words for the sample lookup. Defaults to 'transformer'.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

async function timedFetch(url) {
  const started = Date.now();
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    // arXiv's export API regularly takes 10+ seconds to answer.
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, ms: Date.now() - started, body };
}

async function checkArxiv(query) {
  const url =
    "https://export.arxiv.org/api/query?max_results=1&sortBy=submittedDate&search_query=" +
    encodeURIComponent(`all:${query}`);
  try {
    const r = await timedFetch(url);
    // Skip the feed-level <title>; the first <entry> holds the paper.
    const entry = r.body.split("<entry>")[1] ?? "";
    const title = (entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").replace(/\s+/g, " ").trim();
    return { source: "arXiv", ok: r.ok && Boolean(title), status: r.status, ms: r.ms, sample: title || null };
  } catch (err) {
    return { source: "arXiv", ok: false, error: String(err?.message ?? err) };
  }
}

async function checkOpenAlex(query) {
  const url = "https://api.openalex.org/works?per-page=1&search=" + encodeURIComponent(query);
  try {
    const r = await timedFetch(url);
    const title = r.ok ? JSON.parse(r.body).results?.[0]?.display_name ?? null : null;
    return { source: "OpenAlex", ok: r.ok && Boolean(title), status: r.status, ms: r.ms, sample: title };
  } catch (err) {
    return { source: "OpenAlex", ok: false, error: String(err?.message ?? err) };
  }
}

async function callTool(name, args = {}) {
  if (name === "hello") {
    const who = typeof args.name === "string" && args.name.trim() ? args.name.trim() : "there";
    const info = {
      greeting: `Hello, ${who}! Paper Radar is running.`,
      server: SERVER_INFO,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      pluginRoot: PLUGIN_ROOT,
      cursorPluginRootEnv: process.env.CURSOR_PLUGIN_ROOT ?? null,
      cwd: process.cwd(),
    };
    return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
  }
  if (name === "check_sources") {
    const query = typeof args.query === "string" && args.query.trim() ? args.query.trim() : "transformer";
    const results = await Promise.all([checkArxiv(query), checkOpenAlex(query)]);
    const allOk = results.every((r) => r.ok);
    return {
      content: [{ type: "text", text: JSON.stringify({ query, allOk, results }, null, 2) }],
      isError: !allOk,
    };
  }
  return null;
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0];
      return reply(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Paper Radar validation build. Call `hello` to confirm the server runs, " +
          "then `check_sources` to confirm arXiv and OpenAlex are reachable.",
      });
    }
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: TOOLS });
    case "tools/call": {
      const result = await callTool(params?.name, params?.arguments);
      if (!result) return fail(id, -32602, `Unknown tool: ${params?.name}`);
      return reply(id, result);
    }
    default:
      // Notifications (no id) such as notifications/initialized need no response.
      if (isRequest) fail(id, -32601, `Method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return fail(null, -32700, "Parse error");
  }
  handle(msg).catch((err) => {
    console.error("[paper-radar]", err);
    if (msg.id !== undefined && msg.id !== null) fail(msg.id, -32603, String(err?.message ?? err));
  });
});
rl.on("close", () => process.exit(0));
console.error(`[paper-radar] ${SERVER_INFO.version} started on Node ${process.version}`);
