#!/usr/bin/env node
// Paper Radar MCP server.
// Zero dependencies: speaks MCP JSON-RPC over stdio, one message per line.
// Requires Node 18+ (global fetch). stdout carries protocol messages only;
// all diagnostics go to stderr.

import { createInterface } from "node:readline";
import { TOOLS, runTool } from "./tools.mjs";
import { VERSION } from "./lib/http.mjs";

const SERVER_INFO = { name: "paper-radar", version: VERSION };
const SUPPORTED_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `Paper Radar finds, tracks, and reads research papers using arXiv and OpenAlex.
- search_papers: find papers on a topic (arXiv by default; OpenAlex for published work or citation ranking).
- latest_papers: newest arXiv papers in categories, filtered by keywords. Use for paper tracking.
- get_paper, paper_citations, author_papers: details, citation graph, and author lists.
- read_paper: full text by section for arXiv papers. Read the outline first, then only the sections you need.
Quote numbers and claims from the returned text; do not infer results that the text does not state.`;

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
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: TOOLS.map(({ handler, ...definition }) => definition) });
    case "tools/call": {
      const result = await runTool(params?.name, params?.arguments);
      if (!result) return fail(id, -32602, `Unknown tool: ${params?.name}`);
      return reply(id, result);
    }
    default:
      // Notifications (no id) such as notifications/initialized need no response.
      if (isRequest) fail(id, -32601, `Method not found: ${method}`);
  }
}

// Exit when stdin closes, but only after in-flight requests have replied.
let inFlight = 0;
let closing = false;
const maybeExit = () => closing && inFlight === 0 && process.exit(0);

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return fail(null, -32700, "Parse error");
  }
  inFlight++;
  handle(msg)
    .catch((err) => {
      console.error("[paper-radar]", err);
      if (msg.id !== undefined && msg.id !== null) fail(msg.id, -32603, String(err?.message ?? err));
    })
    .finally(() => {
      inFlight--;
      maybeExit();
    });
});
rl.on("close", () => {
  closing = true;
  maybeExit();
});
console.error(`[paper-radar] ${VERSION} started on Node ${process.version}`);
