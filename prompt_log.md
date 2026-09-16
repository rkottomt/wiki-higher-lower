# Prompt log

## Tools and models

- **Claude Code** (Anthropic's coding agent) running in the VS Code extension, using the **Claude Opus 5** model.
  It explored the APIs with `curl`, wrote the code and tests, ran the site in a headless browser to check it,
  and committed to this repo as it went.

## Key prompts

These are the prompts that shaped the project, in order, with a short note on what each one led to.

### 1. Kick-off

> *(pasted the full HW3 assignment description)*
> build a project to complete this, give me ideas to choose between first. create a new github repo under
> rkottomt and commit everything to there as u go. do not list urself as a contributor when u commit.

Claude proposed four ideas, all built on free APIs that need no key so they could run live on my portfolio:

1. WikiRace vs. a bot (MediaWiki API)
2. Weather Duel + Time Machine (Open-Meteo)
3. Museum "Guess the Year" (Art Institute of Chicago API)
4. Wikipedia Pageviews Higher or Lower (Wikimedia Pageviews API)

It also asked whether the project should be a web app, a Python app with pygame/matplotlib, or a terminal app.

### 2. Choosing the idea and format

> **Idea:** Wiki Pageviews Higher/Lower
> **Format:** Web app (HTML/JS)

Before writing any app code, Claude called each endpoint with `curl` and printed the raw JSON (see
`docs/api-notes.md`). That exposed the problems the app had to handle: non-article pages and bot traffic in the
top list, redirects being counted separately, missing zero-view days, and misspelled titles returning the same
404 as "no data". It also checked CORS headers to confirm a browser could call the APIs directly, and found that
`wikimedia.org` rejects CORS preflight requests, so the code sends plain GETs with no custom headers.

### 3. Considering Google search data instead

> can we rework this so that instead its how many google searchs something gets, not how many wikipedia searches?

Claude searched for current options and reported back:

- Google's official Trends API was still invite-only.
- `pytrends` had been archived and often gets blocked with HTTP 429 errors.
- SerpApi could supply Google Trends data (real counts for trending topics, or 0–100 relative interest for
  any term), but it needs an API key. That would mean a Python/Flask backend, and the project couldn't run live
  on my portfolio.

I decided to **stay with Wikipedia**, since it's free, needs no key, and can run live on GitHub Pages.

## Design decisions that came out of the conversation

- **Filtering the top list:** namespace prefixes are fetched from each wiki instead of hard-coded, so
  German `Spezial:` pages are caught too. A desktop-vs-mobile share heuristic removes bot traffic, with
  thresholds chosen after looking at real August 2026 data.
- **Difficulty** is defined by the ratio between the two view counts (Easy ≥ 2.5×, Normal ≥ 1.25×, Hard within 1.02–1.3×).
- **No chart library:** a small hand-written SVG chart keeps the site dependency-free. Its colors were run
  through a colorblind-safety checker, and every chart has a table showing the same numbers.
- **Error handling** is centralized in `js/api.js` so every tab shows the same kinds of friendly messages.

## How the AI's output was checked

- **Raw API responses were inspected before any code was written,** and endpoints and parameters were checked
  against the Wikimedia docs rather than trusted from memory.
- **Unit tests** (`npm test`, 18 tests) cover filtering, pair picking, date gap-filling, and API error handling
  with a fake `fetch`. The first run caught a bad test fixture: the "hard" difficulty test had no articles close
  enough in views.
- **Browser testing** with headless Chromium played full games, used every Compare feature, switched to German
  Wikipedia, loaded a shared link, and tested on a phone-sized screen in dark mode. It also tried the
  "try to break it" cases: an empty title, a misspelled title, a redirect, too many articles, and going offline
  and then reconnecting. This caught real bugs, all of them fixed:
  - Arrow-key selection in the autocomplete list did nothing (an off-by-one error).
  - Portrait photos were cropped to foreheads.
  - Top-chart bars overflowed on phones.
  - `wiki.phtml` appeared as an "article" on German Wikipedia.
  - A sentence read "5% more views as" instead of "than".
