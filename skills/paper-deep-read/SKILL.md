---
name: paper-deep-read
description: Read one research paper in depth and explain it. Use when the user shares an arXiv link or paper title and asks what it says, how it works, whether its results hold up, or how it compares to related work.
---

# Paper deep read

Explain one paper accurately, at the depth the user asked for, citing the section each point comes from.

## 1. Identify the paper

- If the user gave an arXiv ID, URL, or DOI, call `get_paper` with it.
- If the user gave a title, call `search_papers` with the title in double quotes and `limit` 3. Confirm the match with the user if the top result's title is not an exact match.

## 2. Read selectively

- Call `read_paper` with only the ID to get the abstract and outline.
- Read the sections the question needs. For a general explanation, read the introduction, the method, and the main results, usually 3 to 5 sections. Do not read every section by default.
- If a section returns a `next_offset`, continue only if the rest is relevant.
- If `read_paper` reports that no HTML full text exists, say so, give the PDF link, and work from the abstract only. State that limitation clearly.

## 3. Explain

Use this structure unless the user asked for something else:

1. **Problem**: what the paper tries to solve and why it matters, in two or three sentences.
2. **Approach**: the core idea first, in plain words, then the key details. Define every symbol before you use it.
3. **Evidence**: the main results, with numbers quoted exactly from the text or tables, the benchmarks, and the baselines they beat.
4. **Limits**: limitations the authors state, plus gaps you notice, labeled as your own reading.
5. **Where to look**: the section IDs for each part, so the user can check.

## 4. Context (only when asked)

- Use `paper_citations` with `direction` set to `references` to find the work it builds on.
- Use `paper_citations` with `direction` set to `cited_by` and `sort` set to `most_cited` to find follow-up work.
- Citation counts come from OpenAlex and can differ from other sources. Say so if you report them.

## Rules

- Separate what the paper states from your own interpretation.
- Quote numbers exactly. Never round, combine, or infer a result that the text does not state.
- If the text you read does not answer the question, say which section might, and offer to read it.
