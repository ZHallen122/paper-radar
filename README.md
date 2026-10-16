# Paper Radar

> **Archived (2026-10-15).** This project is no longer developed. For paper tools for agents, see [blazickjp/arxiv-mcp-server](https://github.com/blazickjp/arxiv-mcp-server), the [alphaXiv MCP](https://www.alphaxiv.org/docs/mcp), or the [Hugging Face MCP server](https://github.com/huggingface/hf-mcp-server).

Paper Radar is a plugin for [Grok Bot](https://x.ai/bot) and [Cursor](https://cursor.com) that helps an agent find, track, and read research papers. It uses free public data from [arXiv](https://arxiv.org) and [OpenAlex](https://openalex.org). You need no account and no API key.

## What you can ask

- "Every morning, send me new arXiv papers on speculative decoding and KV cache compression."
- "Find the most cited papers on mixture of experts."
- "Explain https://arxiv.org/abs/2310.06825. How does sliding window attention work, and what do the benchmarks show?"
- "What are the most influential follow-ups to *Attention Is All You Need*?"
- "What has Yoshua Bengio published recently?"

## Components

### MCP tools

| Tool | What it does | Data source |
|---|---|---|
| `search_papers` | Search by topic words. Sort by relevance, newest, or most cited. | arXiv by default; OpenAlex for published work or citation ranking |
| `latest_papers` | Newest papers in arXiv categories over the last 1–14 days, filtered by keywords. | arXiv |
| `get_paper` | One paper's details: authors, full abstract, dates, links, citation count. | arXiv + OpenAlex |
| `paper_citations` | Papers that cite a paper, or papers it cites. | OpenAlex |
| `author_papers` | Papers by an author, by name, ORCID, or OpenAlex ID. | OpenAlex |
| `read_paper` | Full text by section, with math as LaTeX and tables as rows. | arXiv HTML |
| `self_test` | Checks that every data source is reachable. | all |

### Skills

| Skill | Use it to |
|---|---|
| `paper-radar-digest` | Set up a topic watchlist and send daily or weekly digests of new papers, without repeats. |
| `paper-deep-read` | Explain one paper in depth, citing the section each point comes from. |
| `paper-radar-selftest` | Diagnose the plugin when something does not work. |

## How it runs

The MCP server is plain Node.js with **no dependencies** (`server/`). The plugin starts it over stdio on the machine where the agent runs: your computer for Cursor, or the bot's cloud computer for Grok Bot. There is no hosted Paper Radar service.

Requirement: Node.js 18 or newer.

## Privacy

Paper Radar stores nothing and has no server of its own. It sends only your search words, paper IDs, and author names to arXiv and OpenAlex. Responses are cached in memory for up to six hours and are gone when the agent stops the server.

## Limits

- **arXiv** asks clients to send at most one request every three seconds. Paper Radar spaces its requests to respect this, so a burst of arXiv calls can take a few seconds.
- **OpenAlex** gives every network a shared free daily budget. Paper Radar uses free lookups and cheap filters where it can; only `author_papers` by name and `search_papers` with OpenAlex spend more. If the budget runs out, arXiv tools keep working. To get your own budget, create a free key at [openalex.org/settings/api](https://openalex.org/settings/api) and set the `OPENALEX_API_KEY` environment variable for the agent.
- **Citation counts** come from OpenAlex. They can differ from Google Scholar or Semantic Scholar, and OpenAlex occasionally merges records incorrectly.
- **Full text** is available for arXiv papers that have an HTML version. Other papers return a PDF link.

## Install for local testing

**Cursor:** clone this repository to `~/.cursor/plugins/local/paper-radar`, then run **Developer: Reload Window**.

**Grok Bot:** until the plugin is listed in the marketplace, ask the bot to clone this repository and add a custom MCP server with this start command:

```bash
node /path/to/paper-radar/server/server.mjs
```

Then ask: "Run the Paper Radar self-test."

## Develop

```bash
npm test
```

`npm test` runs the offline unit tests and an offline protocol check. `npm run test:live` calls every tool against the real APIs and spends about 25 OpenAlex credits.

## License

MIT
