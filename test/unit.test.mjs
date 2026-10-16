// Offline unit tests for parsers and query builders. Run: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArxivId, keywordQuery, anyKeywordQuery, buildQuery, parseFeed, decodeXml } from "../server/lib/arxiv.mjs";
import { workKey, normalizeWork } from "../server/lib/openalex.mjs";
import { htmlToText, parsePaperHtml, findSection } from "../server/lib/fulltext.mjs";

test("parseArxivId handles IDs, URLs, versions, old style, and DOIs", () => {
  assert.deepEqual(parseArxivId("2310.06825"), { id: "2310.06825", version: null });
  assert.deepEqual(parseArxivId("arXiv:2310.06825v2"), { id: "2310.06825", version: "v2" });
  assert.deepEqual(parseArxivId("https://arxiv.org/pdf/2310.06825v1.pdf"), { id: "2310.06825", version: "v1" });
  assert.deepEqual(parseArxivId("https://arxiv.org/abs/hep-th/9901001"), { id: "hep-th/9901001", version: null });
  assert.deepEqual(parseArxivId("10.48550/arXiv.1706.03762"), { id: "1706.03762", version: null });
  assert.equal(parseArxivId("10.1038/nature.2015.1234"), null);
  assert.equal(parseArxivId("attention is all you need"), null);
});

test("keywordQuery keeps quoted phrases and ANDs other words", () => {
  assert.equal(keywordQuery('"speculative decoding" latency'), 'all:"speculative decoding" AND all:latency');
  assert.equal(keywordQuery("rlhf AND reward"), "all:rlhf AND all:reward");
  assert.equal(keywordQuery("a+b (c)"), "all:ab AND all:c");
});

test("buildQuery combines keywords, categories, and dates", () => {
  assert.equal(
    buildQuery({ keywords: "moe", categories: ["cs.CL", "cs.LG"], fromDate: "2026-10-01", toDate: "2026-10-15" }),
    "all:moe AND (cat:cs.CL OR cat:cs.LG) AND submittedDate:[202610010000 TO 202610152359]",
  );
  assert.equal(buildQuery({ categories: ["cs.AI"] }), "cat:cs.AI");
});

test("decodeXml decodes named and numeric entities", () => {
  assert.equal(decodeXml("a &amp; b &lt;c&gt; &#233; &#x41;"), "a & b <c> é A");
});

const FEED = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>arXiv Query: search_query=all:test</title>
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">42</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2610.00001v2</id>
    <updated>2026-10-12T00:00:00Z</updated>
    <published>2026-10-10T08:00:00Z</published>
    <title>Toy   Paper &amp; Friends</title>
    <summary>  An abstract
      over two lines. </summary>
    <author><name>Ada Lovelace</name></author>
    <author><name>Alan Turing</name></author>
    <arxiv:comment xmlns:arxiv="http://arxiv.org/schemas/atom">10 pages</arxiv:comment>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL"/>
    <category term="cs.CL"/><category term="cs.LG"/>
  </entry>
</feed>`;

test("parseFeed extracts entries and total", () => {
  const { total, entries } = parseFeed(FEED);
  assert.equal(total, 42);
  assert.equal(entries.length, 1);
  const [p] = entries;
  assert.equal(p.arxiv_id, "2610.00001");
  assert.equal(p.version, "v2");
  assert.equal(p.title, "Toy Paper & Friends");
  assert.equal(p.abstract, "An abstract over two lines.");
  assert.deepEqual(p.authors, ["Ada Lovelace", "Alan Turing"]);
  assert.equal(p.published, "2026-10-10");
  assert.equal(p.primary_category, "cs.CL");
  assert.deepEqual(p.categories, ["cs.CL", "cs.LG"]);
  assert.equal(p.comment, "10 pages");
  assert.equal(p.journal_ref, null);
});

test("parseFeed surfaces arXiv errors", () => {
  const err = `<feed><title>Error</title><entry><summary>incorrect id format</summary></entry></feed>`;
  assert.throws(() => parseFeed(err), /incorrect id format/);
});

test("workKey maps OpenAlex IDs, DOIs, and arXiv IDs", () => {
  assert.equal(workKey("https://openalex.org/W2626778328"), "W2626778328");
  assert.equal(workKey("w123"), "W123");
  assert.equal(workKey("https://doi.org/10.1038/nature14539"), "doi:10.1038/nature14539");
  assert.equal(workKey("1706.03762"), "doi:10.48550/arXiv.1706.03762");
  assert.equal(workKey("not an id"), null);
});

test("normalizeWork rebuilds abstracts and finds arXiv IDs", () => {
  const w = normalizeWork(
    {
      id: "https://openalex.org/W1",
      display_name: "T",
      doi: "https://doi.org/10.1/x",
      authorships: Array.from({ length: 12 }, (_, i) => ({ author: { display_name: `A${i}` } })),
      locations: [{ landing_page_url: "https://arxiv.org/abs/2101.00001v3" }],
      abstract_inverted_index: { world: [1], hello: [0] },
    },
    { full: true },
  );
  assert.equal(w.openalex_id, "W1");
  assert.equal(w.doi, "10.1/x");
  assert.equal(w.arxiv_id, "2101.00001");
  assert.equal(w.abstract, "hello world");
  assert.equal(w.authors.length, 11);
  assert.equal(w.authors.at(-1), "+2 more");
});

const PAGE = `<html><body><article class="ltx_document">
<h1 class="ltx_title ltx_title_document">Toy Paper</h1>
<div class="ltx_abstract"><h6 class="ltx_title ltx_title_abstract">Abstract</h6>
<p class="ltx_p">We study <math alttext="x^{2}" display="inline"><mi>x</mi></math> &amp; more.</p></div>
<section id="S1" class="ltx_section"><h2 class="ltx_title ltx_title_section">1 Introduction</h2><p>Intro text.</p></section>
<section id="S2" class="ltx_section"><h2 class="ltx_title ltx_title_section">2 Method</h2><p>Method overview.</p>
<section id="S2.SS1" class="ltx_subsection"><h3 class="ltx_title ltx_title_subsection">2.1 Details</h3>
<table><tr><th>Model</th><th>Score</th></tr><tr><td>Ours</td><td>91.2</td></tr></table></section></section>
<section id="A1" class="ltx_appendix"><h2 class="ltx_title ltx_title_appendix">Appendix A Proofs</h2><p>Proof.</p></section>
<section id="bib" class="ltx_bibliography"><h2 class="ltx_title ltx_title_bibliography">References</h2><p>[1] Ref.</p></section>
</article></body></html>`;

test("parsePaperHtml builds an outline and stops at the bibliography", () => {
  const p = parsePaperHtml(PAGE);
  assert.equal(p.title, "Toy Paper");
  assert.equal(p.abstract, "We study $x^{2}$ & more.");
  assert.deepEqual(
    p.sections.map((s) => [s.id, s.level, s.title]),
    [
      ["S1", 1, "1 Introduction"],
      ["S2", 1, "2 Method"],
      ["S2.SS1", 2, "2.1 Details"],
      ["A1", 1, "Appendix A Proofs"],
    ],
  );
});

test("a top-level section includes its subsections; tables become rows", () => {
  const { sections } = parsePaperHtml(PAGE);
  const text = htmlToText(findSection(sections, "2").html);
  assert.match(text, /Method overview\./);
  assert.match(text, /Ours \| 91\.2 \|/);
  assert.doesNotMatch(text, /Proof\./);
  assert.doesNotMatch(htmlToText(findSection(sections, "A").html), /References/);
});

test("findSection matches ids, numbers, appendix letters, and title words", () => {
  const { sections } = parsePaperHtml(PAGE);
  assert.equal(findSection(sections, "S2.SS1").id, "S2.SS1");
  assert.equal(findSection(sections, "2.1").id, "S2.SS1");
  assert.equal(findSection(sections, "A").id, "A1");
  assert.equal(findSection(sections, "intro").id, "S1");
  assert.equal(findSection(sections, "nothing here"), null);
});

test("anyKeywordQuery ORs words and phrases; buildQuery groups them", () => {
  assert.equal(anyKeywordQuery(["rlhf", "reward model", "a+b"]), 'all:rlhf OR all:"reward model" OR all:"a b"');
  assert.equal(
    buildQuery({ anyKeywords: ["agent", "tool use"], categories: ["cs.CL"] }),
    '(all:agent OR all:"tool use") AND cat:cs.CL',
  );
});

test("keywordMatcher matches word forms but not unrelated stems", async () => {
  const { keywordMatcher } = await import("../server/tools.mjs");
  const kv = keywordMatcher("kv cache");
  assert.ok(kv.test("Efficient KV caching for long context"));
  assert.ok(kv.test("a KV-cache eviction policy"));
  assert.ok(!kv.test("we cache the kv pairs"));
  assert.ok(keywordMatcher("speculative decoding").test("Speculative decode with drafts"));
  const tr = keywordMatcher("transformer");
  assert.ok(tr.test("Vision Transformers at scale"));
  assert.ok(!tr.test("a group transformation"));
  assert.ok(!keywordMatcher("agent").test("reagent chemistry"));
});
