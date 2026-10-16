// OpenAlex client: works, citations, references, and authors.
// API docs: https://help.openalex.org
//
// Cost model (checked 2026-10-15 from X-RateLimit-* headers): single-record
// lookups are free, filter lists cost 1 credit, full-text search costs 10.
// Without an API key, every caller on the same IP shares 1,000 credits a day,
// so this module prefers free lookups and cheap filters over search.
// Set OPENALEX_API_KEY to use a personal free key instead.

import { getJson, HttpError } from "./http.mjs";
import { parseArxivId } from "./arxiv.mjs";

const API = "https://api.openalex.org";
const LIST_FIELDS =
  "id,doi,display_name,publication_date,cited_by_count,authorships,primary_location,open_access,locations,type";
const WORK_FIELDS = `${LIST_FIELDS},referenced_works_count,referenced_works,primary_topic,abstract_inverted_index,ids`;
const MAX_AUTHORS = 10;

const apiKey = () => process.env.OPENALEX_API_KEY?.trim() || null;

async function call(path, params = {}, ttlMs = 30 * 60 * 1000) {
  const qs = new URLSearchParams(params);
  const logUrl = `${API}${path}?${qs}`;
  if (apiKey()) qs.set("api_key", apiKey());
  try {
    const { json } = await getJson(`${API}${path}?${qs}`, { ttlMs, logUrl });
    return json;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    if (err instanceof HttpError && err.status === 429) {
      throw new Error(
        "OpenAlex daily budget is used up for this network. " +
          (apiKey()
            ? "The configured OPENALEX_API_KEY has no credits left today."
            : "Set the OPENALEX_API_KEY environment variable to a free personal key from https://openalex.org/settings/api.") +
          " arXiv-based tools still work.",
      );
    }
    throw err;
  }
}

/** Converts an OpenAlex ID, DOI, or arXiv ID into an OpenAlex path key such as "W123" or "doi:10.x/y". */
export function workKey(input) {
  const text = String(input ?? "").trim();
  const w = text.match(/(?:openalex\.org\/)?(W\d+)\b/i);
  if (w) return w[1].toUpperCase();
  const doi = text.match(/(10\.\d{4,9}\/[^\s"<>]+)/);
  if (doi && !/^10\.48550\/arxiv\./i.test(doi[1])) return `doi:${doi[1]}`;
  const arxiv = parseArxivId(text);
  if (arxiv) return `doi:10.48550/arXiv.${arxiv.id}`;
  return null;
}

function abstractFromIndex(index) {
  if (!index) return null;
  const words = [];
  for (const [word, positions] of Object.entries(index)) for (const p of positions) words[p] = word;
  return words.join(" ").replace(/\s+/g, " ").trim() || null;
}

function arxivIdOf(work) {
  for (const loc of work.locations ?? []) {
    const url = loc?.landing_page_url ?? "";
    if (/arxiv\.org\/abs\//i.test(url)) return parseArxivId(url.split("/abs/")[1])?.id ?? null;
  }
  if (/10\.48550\/arxiv\./i.test(work.doi ?? "")) return parseArxivId(work.doi)?.id ?? null;
  return null;
}

/** Normalizes an OpenAlex work into the shape the tools return. */
export function normalizeWork(work, { full = false } = {}) {
  const names = (work.authorships ?? []).map((a) => a.author?.display_name).filter(Boolean);
  const out = {
    openalex_id: work.id?.replace("https://openalex.org/", "") ?? null,
    title: work.display_name ?? null,
    authors: names.length > MAX_AUTHORS ? [...names.slice(0, MAX_AUTHORS), `+${names.length - MAX_AUTHORS} more`] : names,
    published: work.publication_date ?? null,
    venue: work.primary_location?.source?.display_name ?? null,
    type: work.type ?? null,
    cited_by_count: work.cited_by_count ?? null,
    doi: work.doi?.replace("https://doi.org/", "") ?? null,
    arxiv_id: arxivIdOf(work),
    open_access_url: work.open_access?.oa_url ?? null,
  };
  if (full) {
    out.abstract = abstractFromIndex(work.abstract_inverted_index);
    out.topic = work.primary_topic?.display_name ?? null;
    out.referenced_works_count = work.referenced_works_count ?? null;
  }
  return out;
}

const SORTS = { most_cited: "cited_by_count:desc", newest: "publication_date:desc" };

/** Free single-record lookup. Returns the raw work or null. */
export async function getWork(input) {
  const key = workKey(input);
  if (!key) throw new Error(`Not a recognizable OpenAlex ID, DOI, or arXiv ID: ${input}`);
  return call(`/works/${key}`, { select: WORK_FIELDS }, 6 * 60 * 60 * 1000);
}

/**
 * Title-and-abstract search (10 credits). sort: relevance | most_cited | newest.
 * The plain `search` parameter also matches body text, which ranks unrelated
 * highly cited papers first, so this uses the title_and_abstract filter.
 */
export async function searchWorks({ query, fromDate, toDate, sort = "relevance", limit = 10 }) {
  // Commas separate filters in OpenAlex syntax, so they cannot appear in the query.
  const filters = [`title_and_abstract.search:${query.replace(/,/g, " ")}`];
  if (fromDate) filters.push(`from_publication_date:${fromDate}`);
  if (toDate) filters.push(`to_publication_date:${toDate}`);
  const params = { filter: filters.join(","), "per-page": String(limit), select: LIST_FIELDS };
  if (SORTS[sort]) params.sort = SORTS[sort];
  const json = await call("/works", params);
  return { total: json?.meta?.count ?? 0, works: (json?.results ?? []).map((w) => normalizeWork(w)) };
}

/** Works that cite `workId` (1 credit). */
export async function citedBy(workId, { sort = "most_cited", limit = 10 } = {}) {
  const json = await call("/works", {
    filter: `cites:${workId}`,
    sort: SORTS[sort] ?? SORTS.most_cited,
    "per-page": String(limit),
    select: LIST_FIELDS,
  });
  return { total: json?.meta?.count ?? 0, works: (json?.results ?? []).map((w) => normalizeWork(w)) };
}

/** Works that `work` cites, fetched in one batch filter (1 credit). */
export async function references(work, { sort = "most_cited", limit = 10 } = {}) {
  const ids = (work.referenced_works ?? []).map((u) => u.replace("https://openalex.org/", "")).slice(0, 100);
  if (!ids.length) return { total: 0, works: [] };
  const json = await call("/works", {
    filter: `openalex:${ids.join("|")}`,
    sort: SORTS[sort] ?? SORTS.most_cited,
    "per-page": String(limit),
    select: LIST_FIELDS,
  });
  return { total: work.referenced_works?.length ?? ids.length, works: (json?.results ?? []).map((w) => normalizeWork(w)) };
}

function normalizeAuthor(a) {
  return {
    openalex_id: a.id?.replace("https://openalex.org/", "") ?? null,
    name: a.display_name ?? null,
    orcid: a.orcid?.replace("https://orcid.org/", "") ?? null,
    works_count: a.works_count ?? null,
    cited_by_count: a.cited_by_count ?? null,
    institution: a.last_known_institutions?.[0]?.display_name ?? null,
  };
}

const AUTHOR_FIELDS = "id,display_name,orcid,works_count,cited_by_count,last_known_institutions";

/**
 * Resolves an author. ORCID and OpenAlex author IDs are free lookups; a name
 * costs one search (10 credits) and returns up to five candidates.
 */
export async function findAuthors(input) {
  const text = String(input ?? "").trim();
  const orcid = text.match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i);
  const aid = text.match(/(?:openalex\.org\/)?(A\d+)\b/i);
  if (orcid || aid) {
    const key = orcid ? `orcid:${orcid[1]}` : aid[1].toUpperCase();
    const a = await call(`/authors/${key}`, { select: AUTHOR_FIELDS }, 6 * 60 * 60 * 1000);
    return a ? [normalizeAuthor(a)] : [];
  }
  const json = await call("/authors", { search: text, "per-page": "5", select: AUTHOR_FIELDS });
  return (json?.results ?? []).map(normalizeAuthor);
}

/** Works by an OpenAlex author ID (1 credit). */
export async function worksByAuthor(authorId, { sort = "newest", limit = 10 } = {}) {
  const json = await call("/works", {
    filter: `authorships.author.id:${authorId}`,
    sort: SORTS[sort] ?? SORTS.newest,
    "per-page": String(limit),
    select: LIST_FIELDS,
  });
  return { total: json?.meta?.count ?? 0, works: (json?.results ?? []).map((w) => normalizeWork(w)) };
}
