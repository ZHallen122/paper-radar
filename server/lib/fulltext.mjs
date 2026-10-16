// Reads arXiv's HTML full text (LaTeXML output at https://arxiv.org/html/<id>)
// and turns it into an outline plus plain-text sections. Math keeps its LaTeX
// source from the `alttext` attribute; tables become " | "-separated rows.

import { getText, HttpError } from "./http.mjs";
import { decodeXml } from "./arxiv.mjs";

const SECTION_LEVELS = { section: 1, appendix: 1, subsection: 2, subsubsection: 3, paragraph: 4 };

/** Converts a LaTeXML HTML fragment into readable plain text. */
export function htmlToText(html) {
  return decodeXml(
    html
      // Source newlines are formatting only; structure comes from the tags below.
      .replace(/\s+/g, " ")
      .replace(/<(script|style|svg|button|nav)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<math\b[^>]*?alttext="([^"]*)"[\s\S]*?<\/math>/gi, (_, tex) => ` $${tex}$ `)
      .replace(/<math\b[\s\S]*?<\/math>/gi, " [math] ")
      .replace(/<img\b[^>]*?alt="([^"]*)"[^>]*>/gi, (_, alt) => (alt ? ` [image: ${alt}] ` : " "))
      .replace(/<\/(td|th)>/gi, " | ")
      .replace(/<(br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/?(p|div|h[1-6]|li|tr|table|figure|figcaption|section|blockquote|dt|dd)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Parses the paper page into { title, abstract, sections[] } with text offsets. */
export function parsePaperHtml(html) {
  const title = htmlToText(html.match(/<h1 class="ltx_title ltx_title_document">([\s\S]*?)<\/h1>/)?.[1] ?? "");
  const bibStart = html.search(/<section[^>]*class="ltx_bibliography/);
  const end = bibStart > 0 ? bibStart : html.length;

  const starts = [];
  const re = /<section id="([^"]+)" class="ltx_(section|subsection|subsubsection|appendix|paragraph)\b/g;
  for (const m of html.matchAll(re)) {
    if (m.index >= end) break;
    starts.push({ id: m[1], level: SECTION_LEVELS[m[2]], index: m.index });
  }

  const abstractStart = html.search(/<div class="ltx_abstract">/);
  const abstractEnd = starts[0]?.index ?? end;
  const abstract =
    abstractStart >= 0 ? htmlToText(html.slice(abstractStart, abstractEnd)).replace(/^Abstract\s*/i, "") : null;

  const sections = starts.map((s, i) => {
    // A section runs until the next heading at the same or a higher level.
    const next = starts.slice(i + 1).find((t) => t.level <= s.level);
    const stop = next ? next.index : end;
    const directStop = starts[i + 1] ? Math.min(starts[i + 1].index, end) : end;
    const chunk = html.slice(s.index, stop);
    const heading = chunk.match(/<h[2-6][^>]*class="ltx_title[^"]*"[^>]*>([\s\S]*?)<\/h[2-6]>/)?.[1] ?? "";
    return {
      id: s.id,
      level: s.level,
      title: htmlToText(heading).replace(/\s+/g, " "),
      html: chunk,
      own_chars: htmlToText(html.slice(s.index, directStop)).length,
    };
  });
  return { title, abstract, sections };
}

/** Finds a section by ID ("S3", "S3.SS2"), number ("3", "3.2", "A"), or title words. */
export function findSection(sections, wanted) {
  const w = String(wanted).trim();
  const byId = sections.find((s) => s.id.toLowerCase() === w.toLowerCase());
  if (byId) return byId;
  const num = w.match(/^(\d+|[A-Z])(?:\.(\d+))?(?:\.(\d+))?$/i);
  if (num) {
    // LaTeXML numbers appendices A1, A2, ... for appendix letters A, B, ...
    const head = /^\d+$/.test(num[1]) ? `S${num[1]}` : `A${num[1].toUpperCase().charCodeAt(0) - 64}`;
    const id = [head, num[2] && `SS${num[2]}`, num[3] && `SSS${num[3]}`].filter(Boolean).join(".");
    const hit = sections.find((s) => s.id === id);
    if (hit) return hit;
  }
  const lower = w.toLowerCase();
  return sections.find((s) => s.title.toLowerCase().includes(lower)) ?? null;
}

/** Fetches and parses a paper. Returns null when arXiv has no HTML version. */
export async function fetchPaper(arxivId, version) {
  const url = `https://arxiv.org/html/${arxivId}${version ?? ""}`;
  try {
    const { body } = await getText(url, { ttlMs: 6 * 60 * 60 * 1000, timeoutMs: 45000 });
    if (!/ltx_document|LaTeXML/.test(body)) return null;
    return { url, ...parsePaperHtml(body) };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}
