---
name: paper-radar-digest
description: Build or run a research paper watchlist and send a digest of new papers. Use when the user wants to follow a research topic, track new arXiv papers, get a daily or weekly paper digest, or asks "what's new in <field>".
---

# Paper radar digest

A digest tells the user which new papers on their topics are worth reading, and why. It is short, sourced, and never overstates a paper.

## 1. Set up the watchlist (first run only)

If you have no saved watchlist for this user, ask for:

- **Topics**: two to five short topics in the user's words, for example "speculative decoding" or "RL for reasoning".
- **arXiv categories**: suggest categories that fit the topics, for example `cs.CL` (language), `cs.LG` (machine learning), `cs.CV` (vision), `cs.AI`, `stat.ML`. Let the user confirm.
- **People to follow** (optional): author names.
- **Cadence**: daily or weekly.

Turn each topic into a few keywords or phrases that would appear in a title or abstract. Show them to the user before saving.

Save the watchlist where you keep durable notes for this user. If you have no such place, save it as `paper-radar-watchlist.md` in your workspace. Also keep a list of paper IDs already sent, so a paper is never sent twice.

## 2. Collect candidates

- Call `latest_papers` once per group of related categories, with all topic keywords, `days` set to 2 for daily or 8 for weekly, and `limit` 50.
- For each followed person, call `author_papers` with `sort` set to `newest` and keep only papers newer than the last digest.
- Remove papers already sent.

If `latest_papers` notes that only part of the window was scanned, say so in the digest.

## 3. Choose and explain

- Read each candidate's title and abstract snippet. Call `get_paper` for the full abstract when the snippet is not enough to judge.
- Keep at most 8 papers. Prefer papers that match a topic directly over papers that only mention a keyword.
- For each paper, write:
  - The title as a link to its arXiv page, then the first author and the date.
  - One sentence on what the paper does, based only on the abstract.
  - One sentence on why it matches the user's topic.
- Group papers by topic. Put the strongest match first.

## 4. Rules

- Use only the returned titles and abstracts. Never invent results, numbers, or claims that the abstract does not state.
- Say "the authors report" for claimed results. Do not present them as established facts.
- If nothing new matches, send one line that says so. Do not pad the digest.
- After sending, add the sent paper IDs to the saved list.
