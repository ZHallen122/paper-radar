// Smoke test: starts the stdio server, runs the MCP handshake, and calls every
// tool through the protocol. Exits non-zero on any failure.
// Usage: node scripts/smoke-test.mjs [--offline]   (--offline skips network calls)
// Live mode spends about 25 OpenAlex credits (one name search and one OpenAlex search).

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

async function call(name, args) {
  const started = Date.now();
  const res = await request("tools/call", { name, arguments: args });
  const text = res.result?.content?.[0]?.text ?? "";
  const isError = Boolean(res.result?.isError);
  let data = null;
  if (!isError) data = JSON.parse(text);
  return { isError, text, data, ms: Date.now() - started };
}

const first = (papers) => (papers?.[0] ? `"${papers[0].title}"` : "no papers");

const init = await request("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke-test", version: "0" },
});
check("initialize", init.result?.serverInfo?.name === "paper-radar", `protocol ${init.result?.protocolVersion}`);
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const list = await request("tools/list", {});
const names = list.result?.tools?.map((t) => t.name) ?? [];
check("tools/list", names.length === 7 && !list.result.tools.some((t) => "handler" in t), names.join(", "));

const unknown = await request("tools/call", { name: "nope", arguments: {} });
check("unknown tool -> JSON-RPC error", unknown.error?.code === -32602);

const missing = await call("search_papers", {});
check("missing argument -> isError result", missing.isError && /query/.test(missing.text), missing.text);

const badDate = await call("search_papers", { query: "x", from_date: "Oct 1" });
check("bad date -> isError result", badDate.isError, badDate.text);

if (!offline) {
  const st = await call("self_test", {});
  check("self_test", st.data?.all_ok, st.data?.results?.map((r) => `${r.source} ${r.ms}ms`).join(", "));

  const s1 = await call("search_papers", { query: '"speculative decoding"', categories: ["cs.CL", "cs.LG"], limit: 5 });
  check(
    "search_papers arxiv relevance",
    s1.data?.papers?.length === 5 && s1.data.papers.every((p) => /speculative/i.test(`${p.title} ${p.abstract_snippet}`)),
    `${s1.data?.total_matches} matches, ${first(s1.data?.papers)}`,
  );

  const s2 = await call("search_papers", { query: '"speculative decoding"', sort: "newest", limit: 5 });
  const dates = s2.data?.papers?.map((p) => p.published) ?? [];
  check("search_papers arxiv newest", dates.length === 5 && dates.join() === [...dates].sort().reverse().join(), dates.join(" "));

  const s3 = await call("search_papers", { query: "mixture of experts", sort: "most_cited", limit: 3 });
  check("search_papers most_cited -> openalex", s3.data?.source === "openalex" && s3.data.papers.length === 3, first(s3.data?.papers));

  const g1 = await call("get_paper", { id: "https://arxiv.org/abs/1706.03762v7" });
  check(
    "get_paper arXiv + citations",
    g1.data?.title === "Attention Is All You Need" && g1.data.citations?.cited_by_count > 1000,
    `${g1.data?.citations?.cited_by_count} citations`,
  );

  const g2 = await call("get_paper", { id: "10.1038/nature14539" });
  check("get_paper DOI", /deep learning/i.test(g2.data?.title ?? ""), g2.data?.title ?? g2.text);

  const l1 = await call("latest_papers", { categories: ["cs.CL"], keywords: ["agent"], days: 3, limit: 5 });
  check(
    "latest_papers",
    l1.data?.scanned > 0 && l1.data.papers.every((p) => /agent/i.test(`${p.title} ${p.abstract_snippet}`)),
    `${l1.data?.arxiv_matches} arXiv matches, ${l1.data?.scanned} scanned, ${l1.data?.matched} matched, ${first(l1.data?.papers)}`,
  );

  const c1 = await call("paper_citations", { id: "1706.03762", limit: 3 });
  check("paper_citations cited_by", c1.data?.papers?.length === 3, `${c1.data?.total} total, ${first(c1.data?.papers)}`);

  const c2 = await call("paper_citations", { id: "1706.03762", direction: "references", limit: 3 });
  check("paper_citations references", c2.data?.papers?.length > 0, `${c2.data?.total} total, ${first(c2.data?.papers)}`);

  const a1 = await call("author_papers", { author: "Yoshua Bengio", sort: "most_cited", limit: 3 });
  check("author_papers by name", /bengio/i.test(a1.data?.author?.name ?? ""), `${a1.data?.author?.name}: ${first(a1.data?.papers)}`);

  const r1 = await call("read_paper", { id: "2310.06825" });
  check("read_paper outline", r1.data?.outline?.length > 3, r1.data?.outline?.map((s) => s.id).join(" "));

  const r2 = await call("read_paper", { id: "2310.06825", section: "2", max_chars: 2000 });
  check("read_paper section", r2.data?.text?.length > 200, `${r2.data?.section?.title}, ${r2.data?.total_chars} chars, next ${r2.data?.next_offset}`);

  const r3 = await call("read_paper", { id: "2310.06825", section: "no such heading" });
  check("read_paper unknown section -> isError", r3.isError, r3.text.slice(0, 100));
}

child.stdin.end();
