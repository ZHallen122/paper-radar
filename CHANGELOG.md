# Changelog

## 0.1.0 (2026-10-15)

- Tools: `search_papers`, `latest_papers`, `get_paper`, `paper_citations`, `author_papers`, `read_paper`, and `self_test` (replaces `hello` and `check_sources`).
- Skills: `paper-radar-digest` and `paper-deep-read`. `paper-radar-selftest` now uses `self_test`.
- arXiv requests are spaced three seconds apart, and responses are cached in memory.
- Optional `OPENALEX_API_KEY` environment variable for a personal OpenAlex budget.

## 0.0.1 (2026-10-15)

- Validation build: zero-dependency stdio MCP server with `hello` and `check_sources` tools.
- `paper-radar-selftest` skill.
