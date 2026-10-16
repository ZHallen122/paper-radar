// Smoke test: starts the stdio server, runs the MCP handshake, lists tools,
// and calls each tool once. Exits non-zero on any failure.
// Usage: node scripts/smoke-test.mjs [--offline]   (--offline skips network calls)

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const offline = process.argv.includes("--offline");
const serverPath = join(dirname(fileURLToPath(import.meta.url)), "..", "server", "server.mjs");
const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "inherit"] });

const pending = new Map();
let nextId = 1;
createInterface({ input: child.stdout }).on("line", (line) => {
  const msg = JSON.parse(line); // Any non-JSON stdout line is a protocol bug and should throw.
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});

function request(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve) => pending.set(id, resolve));
}

function check(label, condition, detail) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!condition) process.exitCode = 1;
}

const init = await request("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke-test", version: "0" },
});
check("initialize", init.result?.serverInfo?.name === "paper-radar", `protocol ${init.result?.protocolVersion}`);
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const list = await request("tools/list", {});
const names = list.result?.tools?.map((t) => t.name) ?? [];
check("tools/list", names.includes("hello") && names.includes("check_sources"), names.join(", "));

const hello = await request("tools/call", { name: "hello", arguments: { name: "smoke test" } });
const helloText = hello.result?.content?.[0]?.text ?? "";
check("hello", helloText.includes("Paper Radar is running"), JSON.parse(helloText || "{}").node);

const unknown = await request("tools/call", { name: "nope", arguments: {} });
check("unknown tool returns error", unknown.error?.code === -32602);

if (!offline) {
  const sources = await request("tools/call", { name: "check_sources", arguments: {} });
  const report = JSON.parse(sources.result?.content?.[0]?.text ?? "{}");
  for (const r of report.results ?? []) {
    check(`check_sources: ${r.source}`, r.ok, r.ok ? `${r.ms} ms, "${r.sample}"` : r.error ?? `HTTP ${r.status}`);
  }
}

child.stdin.end();
