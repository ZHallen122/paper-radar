// arXiv client: ID parsing, Atom feed parsing, search, latest listings, lookup.
// API docs: https://info.arxiv.org/help/api/user-manual.html
//
// Observed behavior (checked 2026-10-15) that shapes this module:
// - Keyword queries sorted by submittedDate ignore the keywords and return the
//   newest papers site-wide, so keyword searches always sort by relevance and
//   "newest" is applied locally.
// - Category + submittedDate range queries sorted by date work correctly.

import { getText } from "./http.mjs";

const API = "https://export.arxiv.org/api/query";
const NEW_ID = /(\d{4}\.\d{4,5})(v\d+)?/;
const OLD_ID = /([a-z-]+(?:\.[a-z]{2})?\/\d{7})(v\d+)?/i;

/** Extracts { id, version } from an arXiv ID, arXiv URL, or arXiv DOI. Returns null if none. */
export function parseArxivId(input) {
  if (typeof input !== "string") return null;
  const text = input.trim();
  const m = text.match(NEW_ID) ?? text.match(OLD_ID);
  if (!m) return null;
  // A bare "1234.5678" inside an unrelated DOI is not an arXiv ID.
  if (/^10\.\d+\//.test(text) && !/^10\.48550\/arxiv\./i.test(text)) return null;
  return { id: m[1], version: m[2] ?? null };
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const clean = (s) => decodeXml(s ?? "").replace(/\s+/g, " ").trim();
const tag = (xml, name) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1];

function parseEntry(xml) {
  const absUrl = clean(tag(xml, "id"));
  const parsed = parseArxivId(absUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, ""));
  if (!parsed) return null;
  const authors = [...xml.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/g)].map((m) => clean(m[1]));
  const categories = [...xml.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => m[1]);
  const primary = xml.match(/<arxiv:primary_category[^>]*term="([^"]+)"/)?.[1] ?? categories[0] ?? null;
  const id = parsed.id;
  return {
    arxiv_id: id,
    version: parsed.version,
    title: clean(tag(xml, "title")),
    authors,
    abstract: clean(tag(xml, "summary")),
    published: clean(tag(xml, "published")).slice(0, 10),
    updated: clean(tag(xml, "updated")).slice(0, 10),
    primary_category: primary,
    categories,
    comment: clean(tag(xml, "arxiv:comment")) || null,
    journal_ref: clean(tag(xml, "arxiv:journal_ref")) || null,
    doi: clean(tag(xml, "arxiv:doi")) || null,
    links: {
      abstract: `https://arxiv.org/abs/${id}`,
      pdf: `https://arxiv.org/pdf/${id}`,
      html: `https://arxiv.org/html/${id}`,
    },
  };
}

export function parseFeed(xml) {
  if (/<title>Error<\/title>/.test(xml)) {
    const detail = clean(tag(xml.split("<entry>")[1] ?? "", "summary"));
    throw new Error(`arXiv rejected the query: ${detail || "unknown error"}`);
  }
  const total = Number(xml.match(/<opensearch:totalResults[^>]*>(\d+)</)?.[1] ?? 0);
  const entries = xml
    .split("<entry>")
    .slice(1)
    .map((chunk) => parseEntry(chunk.split("</entry>")[0]))
    .filter(Boolean);
  return { total, entries };
}

/** Turns free text into an arXiv query: quoted phrases stay phrases, other words are ANDed. */
export function keywordQuery(text, field = "all") {
  const parts = [];
  const rest = String(text).replace(/"([^"]+)"/g, (_, phrase) => {
    const p = phrase.replace(/[^\p{L}\p{N}\s-]/gu, " ").trim();
    if (p) parts.push(`${field}:"${p}"`);
    return " ";
  });
  for (const word of rest.split(/\s+/)) {
    const w = word.replace(/[^\p{L}\p{N}-]/gu, "");
    if (w && !/^(and|or|andnot)$/i.test(w)) parts.push(`${field}:${w}`);
  }
  return parts.join(" AND ");
}

const compactDate = (iso, end) => iso.replaceAll("-", "") + (end ? "2359" : "0000");

/** ORs a list of keywords or phrases: ["rlhf", "reward model"] -> all:rlhf OR all:"reward model". */
export function anyKeywordQuery(list) {
  return list
    .map((k) => k.replace(/[^\p{L}\p{N}\s-]/gu, " ").trim())
    .filter(Boolean)
    .map((k) => (/\s/.test(k) ? `all:"${k.replace(/\s+/g, " ")}"` : `all:${k}`))
    .join(" OR ");
}

export function buildQuery({ keywords, anyKeywords = [], categories = [], fromDate, toDate }) {
  const clauses = [];
  const any = anyKeywordQuery(anyKeywords);
  if (any) clauses.push(any.includes(" OR ") ? `(${any})` : any);
  if (keywords) {
    const q = keywordQuery(keywords);
    if (q) clauses.push(q.includes(" AND ") ? `(${q})` : q);
  }
  if (categories.length) {
    const cats = categories.map((c) => `cat:${c.replace(/[^A-Za-z.-]/g, "")}`);
    clauses.push(cats.length > 1 ? `(${cats.join(" OR ")})` : cats[0]);
  }
  if (fromDate || toDate) {
    const from = compactDate(fromDate ?? "1991-01-01", false);
    const to = compactDate(toDate ?? new Date().toISOString().slice(0, 10), true);
    clauses.push(`submittedDate:[${from} TO ${to}]`);
  }
  return clauses.join(" AND ");
}

async function query(params, ttlMs) {
  const url = `${API}?${new URLSearchParams(params)}`;
  const { body } = await getText(url, { ttlMs });
  return parseFeed(body);
}

/** Keyword search. sort: "relevance" | "newest". Newest re-sorts a relevance window locally. */
export async function search({ keywords, categories, fromDate, toDate, sort = "relevance", limit = 10 }) {
  const searchQuery = buildQuery({ keywords, categories, fromDate, toDate });
  if (!searchQuery) throw new Error("Give search words or at least one category.");
  const window = sort === "newest" ? Math.max(50, limit) : limit;
  const { total, entries } = await query(
    { search_query: searchQuery, sortBy: "relevance", sortOrder: "descending", start: "0", max_results: String(window) },
    30 * 60 * 1000,
  );
  let papers = entries;
  if (sort === "newest") papers = [...entries].sort((a, b) => b.published.localeCompare(a.published));
  return { total, query: searchQuery, papers: papers.slice(0, limit) };
}

/**
 * Newest submissions in categories over the last `days` days (UTC), newest first.
 * With keywords, arXiv filters server-side (any keyword matches); because
 * keyword queries only sort correctly by relevance, results are re-sorted by
 * date here.
 */
export async function latest({ categories, keywords = [], days, max = 300 }) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const searchQuery = buildQuery({
    anyKeywords: keywords,
    categories,
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10),
  });
  const { total, entries } = await query(
    {
      search_query: searchQuery,
      sortBy: keywords.length ? "relevance" : "submittedDate",
      sortOrder: "descending",
      start: "0",
      max_results: String(max),
    },
    15 * 60 * 1000,
  );
  const papers = keywords.length ? [...entries].sort((a, b) => b.published.localeCompare(a.published)) : entries;
  return { total, query: searchQuery, papers };
}

/** Looks up papers by arXiv ID (without version). Returns entries in the order found. */
export async function getByIds(ids) {
  if (!ids.length) return [];
  const { entries } = await query({ id_list: ids.join(","), max_results: String(ids.length) }, 6 * 60 * 60 * 1000);
  return entries;
}
