// Tool definitions and handlers. Each handler returns a plain object that the
// server serializes as JSON text. Throwing an Error produces an isError result.

import * as arxiv from "./lib/arxiv.mjs";
import * as openalex from "./lib/openalex.mjs";
import { fetchPaper, findSection, htmlToText } from "./lib/fulltext.mjs";
import { VERSION } from "./lib/http.mjs";

const SNIPPET_CHARS = 300;
const LIST_AUTHORS = 5;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- input helpers ----------

function int(value, { min, max, fallback }) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(value, name, { required = false } = {}) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (required) throw new Error(`\`${name}\` is required.`);
  return undefined;
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function date(value, name) {
  const v = str(value, name);
  if (v && !DATE.test(v)) throw new Error(`\`${name}\` must use the format YYYY-MM-DD.`);
  return v;
}

function strList(value, name, { max }) {
  const list = (Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [])
    .map((v) => String(v).trim())
    .filter(Boolean);
  if (list.length > max) throw new Error(`\`${name}\` accepts at most ${max} items.`);
  return list;
}

/**
 * Builds a case-insensitive matcher for a keyword or phrase. Each word matches
 * as a prefix after dropping a common suffix, so "kv cache" matches
 * "KV caching" and "decoding" matches "decode", but "transformer" does not
 * match "transformation".
 */
export function keywordMatcher(keyword) {
  const words = keyword
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => (w.length > 4 ? w.replace(/(ing|ed|es|s|e)$/, "") : w))
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.map((w) => `${w}[\\p{L}\\p{N}]*`).join("[^\\p{L}\\p{N}]+")}`, "iu");
}

// ---------- output helpers ----------

const snippet = (text) =>
  !text ? null : text.length <= SNIPPET_CHARS ? text : `${text.slice(0, SNIPPET_CHARS).replace(/\s+\S*$/, "")} …`;

const shortAuthors = (names = []) =>
  names.length > LIST_AUTHORS ? [...names.slice(0, LIST_AUTHORS), `+${names.length - LIST_AUTHORS} more`] : names;

function arxivListItem(p) {
  return {
    arxiv_id: p.arxiv_id,
    title: p.title,
    authors: shortAuthors(p.authors),
    published: p.published,
    primary_category: p.primary_category,
    abstract_snippet: snippet(p.abstract),
    url: p.links.abstract,
  };
}

function openalexListItem(w) {
  return {
    ...w,
    authors: shortAuthors(w.authors),
    url: w.arxiv_id ? `https://arxiv.org/abs/${w.arxiv_id}` : w.doi ? `https://doi.org/${w.doi}` : `https://openalex.org/${w.openalex_id}`,
  };
}

async function resolveOpenAlexWork(id) {
  const work = await openalex.getWork(id);
  if (!work) {
    throw new Error(
      `OpenAlex has no record for "${id}". Very new arXiv papers can take several days to appear in OpenAlex.`,
    );
  }
  return work;
}

// ---------- handlers ----------

async function searchPapers(args) {
  const query = str(args.query, "query", { required: true });
  const fromDate = date(args.from_date, "from_date");
  const toDate = date(args.to_date, "to_date");
  const limit = int(args.limit, { min: 1, max: 25, fallback: 10 });
  const sort = oneOf(args.sort, ["relevance", "newest", "most_cited"], "relevance");
  let source = oneOf(args.source, ["arxiv", "openalex"], "arxiv");
  const categories = strList(args.categories, "categories", { max: 5 });
  const notes = [];

  if (source === "arxiv" && sort === "most_cited") {
    source = "openalex";
    notes.push("arXiv has no citation counts, so this search used OpenAlex.");
  }
  if (source === "openalex" && categories.length) {
    notes.push("`categories` applies to arXiv only and was ignored.");
  }

  if (source === "arxiv") {
    const r = await arxiv.search({ keywords: query, categories, fromDate, toDate, sort, limit });
    if (sort === "newest") notes.push("Sorted by date within the 50 most relevant arXiv matches.");
    return { source, total_matches: r.total, returned: r.papers.length, notes, papers: r.papers.map(arxivListItem) };
  }
  const r = await openalex.searchWorks({ query, fromDate, toDate, sort, limit });
  return { source, total_matches: r.total, returned: r.works.length, notes, papers: r.works.map(openalexListItem) };
}

async function getPaper(args) {
  const id = str(args.id, "id", { required: true });
  const parsed = /^W\d+$/i.test(id) || /openalex\.org/i.test(id) ? null : arxiv.parseArxivId(id);
  const notes = [];

  if (parsed) {
    const [entry] = await arxiv.getByIds([parsed.id]);
    if (!entry) throw new Error(`arXiv has no paper with ID ${parsed.id}.`);
    let enrichment = null;
    try {
      const work = await openalex.getWork(parsed.id);
      if (work) {
        const w = openalex.normalizeWork(work, { full: true });
        enrichment = {
          openalex_id: w.openalex_id,
          cited_by_count: w.cited_by_count,
          venue: w.venue,
          topic: w.topic,
          referenced_works_count: w.referenced_works_count,
        };
      } else {
        notes.push("OpenAlex has no record yet, so citation data is missing. New papers can take several days.");
      }
    } catch (err) {
      notes.push(`Citation data unavailable: ${err.message}`);
    }
    return { source: "arxiv", ...entry, citations: enrichment, notes };
  }

  const work = await resolveOpenAlexWork(id);
  const w = openalex.normalizeWork(work, { full: true });
  return {
    source: "openalex",
    ...w,
    links: {
      openalex: `https://openalex.org/${w.openalex_id}`,
      doi: w.doi ? `https://doi.org/${w.doi}` : null,
      arxiv: w.arxiv_id ? `https://arxiv.org/abs/${w.arxiv_id}` : null,
      open_access: w.open_access_url,
    },
    notes: w.arxiv_id ? ["This paper is on arXiv, so `read_paper` can read its full text."] : [],
  };
}

async function latestPapers(args) {
  const categories = strList(args.categories, "categories", { max: 5 });
  if (!categories.length) throw new Error("`categories` is required, for example [\"cs.CL\"].");
  const keywords = strList(args.keywords, "keywords", { max: 20 }).map((k) => k.toLowerCase());
  const days = int(args.days, { min: 1, max: 14, fallback: 2 });
  const limit = int(args.limit, { min: 1, max: 50, fallback: 20 });

  const r = await arxiv.latest({ categories, keywords, days });
  // arXiv's stemming is loose ("transformer" matches "transformation"), so
  // re-check each paper with a stricter word-prefix match.
  const matchers = keywords.map(keywordMatcher);
  const matched = matchers.length
    ? r.papers.filter((p) => matchers.some((re) => re.test(`${p.title} ${p.abstract}`)))
    : r.papers;
  const notes = [
    "Dates are arXiv submission dates (UTC). arXiv announces new papers on weekday evenings US Eastern time, so the newest day can look incomplete.",
  ];
  if (r.total > r.papers.length) {
    notes.push(
      keywords.length
        ? `arXiv found ${r.total} keyword matches; only the ${r.papers.length} most relevant were scanned. Use fewer days or more specific keywords to cover everything.`
        : `Only the newest ${r.papers.length} of ${r.total} papers were scanned. Add keywords, or use fewer days or categories, to cover everything.`,
    );
  }
  return {
    categories,
    keywords,
    days,
    arxiv_matches: r.total,
    scanned: r.papers.length,
    matched: matched.length,
    returned: Math.min(limit, matched.length),
    notes,
    papers: matched.slice(0, limit).map(arxivListItem),
  };
}

async function paperCitations(args) {
  const id = str(args.id, "id", { required: true });
  const direction = oneOf(args.direction, ["cited_by", "references"], "cited_by");
  const sort = oneOf(args.sort, ["most_cited", "newest"], "most_cited");
  const limit = int(args.limit, { min: 1, max: 25, fallback: 10 });

  const work = await resolveOpenAlexWork(id);
  const paper = openalex.normalizeWork(work);
  const r =
    direction === "cited_by"
      ? await openalex.citedBy(paper.openalex_id, { sort, limit })
      : await openalex.references(work, { sort, limit });
  return {
    paper: { openalex_id: paper.openalex_id, title: paper.title, cited_by_count: paper.cited_by_count },
    direction,
    sort,
    total: r.total,
    returned: r.works.length,
    notes: ["Citation data comes from OpenAlex and can differ from Google Scholar or Semantic Scholar counts."],
    papers: r.works.map(openalexListItem),
  };
}

async function authorPapers(args) {
  const author = str(args.author, "author", { required: true });
  const sort = oneOf(args.sort, ["newest", "most_cited"], "newest");
  const limit = int(args.limit, { min: 1, max: 25, fallback: 10 });

  const candidates = await openalex.findAuthors(author);
  if (!candidates.length) throw new Error(`OpenAlex found no author matching "${author}".`);
  const [chosen, ...others] = candidates;
  const r = await openalex.worksByAuthor(chosen.openalex_id, { sort, limit });
  return {
    author: chosen,
    other_candidates: others,
    notes: others.length
      ? ["If this is the wrong person, call again with an `openalex_id` or ORCID from `other_candidates`."]
      : [],
    sort,
    total: r.total,
    returned: r.works.length,
    papers: r.works.map(openalexListItem),
  };
}

async function readPaper(args) {
  const id = str(args.id, "id", { required: true });
  const parsed = arxiv.parseArxivId(id);
  if (!parsed) throw new Error("`read_paper` needs an arXiv ID or arXiv URL, for example 2310.06825.");
  const maxChars = int(args.max_chars, { min: 2000, max: 40000, fallback: 12000 });
  const offset = int(args.offset, { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
  const wanted = str(args.section, "section");

  const paper = await fetchPaper(parsed.id, parsed.version);
  if (!paper) {
    throw new Error(
      `arXiv has no HTML full text for ${parsed.id}. The PDF is at https://arxiv.org/pdf/${parsed.id}.`,
    );
  }

  if (!wanted) {
    return {
      arxiv_id: parsed.id,
      title: paper.title,
      url: paper.url,
      abstract: paper.abstract,
      outline: paper.sections.map((s) => ({ id: s.id, level: s.level, title: s.title, chars: s.own_chars })),
      notes: ["Call again with `section` set to a section `id`, number, or title words to read it."],
    };
  }

  const section = findSection(paper.sections, wanted);
  if (!section) {
    throw new Error(
      `No section matches "${wanted}". Available: ${paper.sections.filter((s) => s.level === 1).map((s) => `${s.id} ${s.title}`).join("; ")}`,
    );
  }
  const text = htmlToText(section.html);
  const page = text.slice(offset, offset + maxChars);
  const nextOffset = offset + page.length < text.length ? offset + page.length : null;
  return {
    arxiv_id: parsed.id,
    title: paper.title,
    section: { id: section.id, title: section.title },
    url: `${paper.url}#${section.id}`,
    total_chars: text.length,
    offset,
    next_offset: nextOffset,
    notes: nextOffset ? [`Text continues. Call again with offset ${nextOffset}.`] : [],
    text: page,
  };
}

async function selfTest() {
  const timed = async (source, fn) => {
    const started = Date.now();
    try {
      const sample = await fn();
      return { source, ok: Boolean(sample), ms: Date.now() - started, sample };
    } catch (err) {
      return { source, ok: false, ms: Date.now() - started, error: err.message };
    }
  };
  const results = await Promise.all([
    timed("arXiv", async () => (await arxiv.getByIds(["1706.03762"]))[0]?.title),
    timed("OpenAlex", async () => (await openalex.getWork("W2626778328"))?.display_name),
    timed("arXiv full text", async () => (await fetchPaper("1706.03762"))?.title),
  ]);
  return {
    server: { name: "paper-radar", version: VERSION },
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    openalex_api_key: Boolean(process.env.OPENALEX_API_KEY?.trim()),
    all_ok: results.every((r) => r.ok),
    results,
  };
}

// ---------- definitions ----------

const ID_DESCRIPTION =
  "Paper identifier: an arXiv ID or URL (2310.06825, arXiv:2310.06825v2), a DOI, or an OpenAlex work ID (W2626778328).";

export const TOOLS = [
  {
    name: "search_papers",
    description:
      "Search research papers by topic words. Default source is arXiv (preprints in CS, math, physics, and more, sorted by relevance). " +
      "Use source \"openalex\" for published papers across all fields, or sort \"most_cited\" to find influential work; " +
      "OpenAlex searches draw on a shared daily budget, so prefer arXiv when it fits.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Topic words. Wrap exact phrases in double quotes, for example \"speculative decoding\" latency." },
        source: { type: "string", enum: ["arxiv", "openalex"], description: "Where to search. Default: arxiv." },
        categories: {
          type: "array",
          items: { type: "string" },
          description: "arXiv categories to restrict to, for example [\"cs.CL\", \"cs.LG\"]. arXiv only.",
        },
        from_date: { type: "string", description: "Earliest date, YYYY-MM-DD." },
        to_date: { type: "string", description: "Latest date, YYYY-MM-DD." },
        sort: { type: "string", enum: ["relevance", "newest", "most_cited"], description: "Default: relevance." },
        limit: { type: "integer", minimum: 1, maximum: 25, description: "Number of results. Default: 10." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { title: "Search papers", readOnlyHint: true, openWorldHint: true },
    handler: searchPapers,
  },
  {
    name: "get_paper",
    description:
      "Get one paper's details: title, authors, full abstract, dates, categories, links, and citation count when available.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: ID_DESCRIPTION } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { title: "Get paper", readOnlyHint: true, openWorldHint: true },
    handler: getPaper,
  },
  {
    name: "latest_papers",
    description:
      "List the newest arXiv submissions in one or more categories over the last few days, optionally keeping only papers " +
      "whose title or abstract contains any of the keywords. Use this for daily or weekly paper tracking.",
    inputSchema: {
      type: "object",
      properties: {
        categories: {
          type: "array",
          items: { type: "string" },
          description: "arXiv categories, for example [\"cs.CL\", \"cs.LG\"]. Up to 5.",
        },
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Optional words or phrases. A paper matches if its title or abstract contains any of them (case-insensitive).",
        },
        days: { type: "integer", minimum: 1, maximum: 14, description: "How many days back to look. Default: 2." },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Maximum papers to return. Default: 20." },
      },
      required: ["categories"],
      additionalProperties: false,
    },
    annotations: { title: "Latest papers", readOnlyHint: true, openWorldHint: true },
    handler: latestPapers,
  },
  {
    name: "paper_citations",
    description:
      "Follow the citation graph of a paper: papers that cite it (cited_by) or papers it cites (references). Data from OpenAlex.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: ID_DESCRIPTION },
        direction: { type: "string", enum: ["cited_by", "references"], description: "Default: cited_by." },
        sort: { type: "string", enum: ["most_cited", "newest"], description: "Default: most_cited." },
        limit: { type: "integer", minimum: 1, maximum: 25, description: "Default: 10." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { title: "Paper citations", readOnlyHint: true, openWorldHint: true },
    handler: paperCitations,
  },
  {
    name: "author_papers",
    description:
      "List papers by an author. Accepts a name, an ORCID, or an OpenAlex author ID. For a name, the best match is used and other " +
      "candidates are returned so you can retry if it is the wrong person.",
    inputSchema: {
      type: "object",
      properties: {
        author: { type: "string", description: "Author name, ORCID (0000-0002-1825-0097), or OpenAlex author ID (A5023888391)." },
        sort: { type: "string", enum: ["newest", "most_cited"], description: "Default: newest." },
        limit: { type: "integer", minimum: 1, maximum: 25, description: "Default: 10." },
      },
      required: ["author"],
      additionalProperties: false,
    },
    annotations: { title: "Author papers", readOnlyHint: true, openWorldHint: true },
    handler: authorPapers,
  },
  {
    name: "read_paper",
    description:
      "Read an arXiv paper's full text. Without `section`, returns the abstract and a section outline. With `section`, returns " +
      "that section's text (math as LaTeX, tables as rows), paged by `max_chars` and `offset`.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "arXiv ID or arXiv URL." },
        section: {
          type: "string",
          description: "Section to read: an outline id (S3, S3.SS2), a number (3, 3.2, or an appendix letter such as A), or words from its title.",
        },
        max_chars: { type: "integer", minimum: 2000, maximum: 40000, description: "Characters per page. Default: 12000." },
        offset: { type: "integer", minimum: 0, description: "Start position from a previous call's next_offset. Default: 0." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { title: "Read paper", readOnlyHint: true, openWorldHint: true },
    handler: readPaper,
  },
  {
    name: "self_test",
    description:
      "Check that Paper Radar is working: reports the runtime and whether arXiv, OpenAlex, and arXiv full text are reachable.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Self-test", readOnlyHint: true, openWorldHint: true },
    handler: selfTest,
  },
];

export async function runTool(name, args = {}) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  try {
    const result = await tool.handler(args ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
}
