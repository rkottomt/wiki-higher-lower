# API exploration notes

Before writing any app code I called each endpoint with `curl` and read the raw
JSON. These notes record what came back and the surprises that shaped the code.

No API key is needed for any of these. Wikimedia asks clients to identify
themselves; `curl` sends a `User-Agent`, and in the browser the page's `Origin`
does that job.

## 1. Top articles for a month

```
GET https://wikimedia.org/api/rest_v1/metrics/pageviews/top/{project}/{access}/{year}/{month}/all-days
GET https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/2026/08/all-days
```

| Path parameter | Meaning | Values used |
| --- | --- | --- |
| `project` | which wiki | `en.wikipedia`, `de.wikipedia`, … |
| `access` | device type | `all-access`, `desktop`, `mobile-web` |
| `year` / `month` | the month to rank | `2026` / `08` |
| `day` | a single day, or the whole month | `all-days` |

Response (trimmed): the 1000 most-viewed pages, already sorted.

```json
{"items":[{"project":"en.wikipedia","access":"all-access","year":"2026","month":"08","day":"all-days",
  "articles":[
    {"article":"Main_Page","views":216848380,"rank":1},
    {"article":"Special:Search","views":25909984,"rank":2},
    {"article":"Wikipedia:Featured_pictures","views":21855862,"rank":3},
    {"article":"Hayden_Panettiere","views":15252992,"rank":4},
    ...
    {"article":".xxx","views":3404701,"rank":13},
    {"article":".xyz","views":3340171,"rank":14},
    {"article":"Neatsville,_Kentucky","views":2654312,"rank":15},
```

**Surprises**

- The list includes pages that are not articles: `Main_Page`, `Special:Search`,
  `Wikipedia:…`, `Portal:…`. The prefixes are translated on other wikis
  (`Spezial:Suche` on de.wikipedia), so the app asks each wiki for its own
  namespace names (see section 4) instead of hard-coding English ones.
- Some entries are clearly automated traffic that slipped past the bot filter
  (`.xxx`, `.xyz`, `Neatsville, Kentucky`, `Limonene`). Comparing the
  `desktop` and `mobile-web` top lists exposes them: real human interest is split
  across devices, bot traffic is almost all one device.

  | Article | desktop share | mobile-web share |
  | --- | --- | --- |
  | Dolly_Parton | 0.16 | 0.81 |
  | ChatGPT | 0.64 | 0.35 |
  | .xyz | **0.96** | <0.05 |
  | Neatsville,_Kentucky | **0.99** | <0.06 |
  | .xxx | 0.02 | **0.98** |

  The app drops articles with desktop share > 0.90 or mobile-web share > 0.95.
- Asking for a month that has not been published yet returns **404** with the
  message *"The date(s) you used are valid, but we either do not have data for
  those date(s)…"*. The app falls back to the previous month.

## 2. Views for one article over time

```
GET https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/{project}/{access}/{agent}/{article}/{granularity}/{start}/{end}
GET https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Black_hole/daily/20260801/20260803
```

| Path parameter | Meaning | Values used |
| --- | --- | --- |
| `agent` | who viewed it | `user` (excludes known spiders/bots) |
| `article` | title with spaces as `_`, URL-encoded | `Black_hole` |
| `granularity` | bucket size | `daily` or `monthly` |
| `start` / `end` | inclusive range, `YYYYMMDD` (or `YYYYMMDDHH`) | `20260801` / `20260803` |

```json
{"items":[
  {"project":"en.wikipedia","article":"Black_hole","granularity":"daily","timestamp":"2026080100","access":"all-access","agent":"user","views":4069},
  {"project":"en.wikipedia","article":"Black_hole","granularity":"daily","timestamp":"2026080200","access":"all-access","agent":"user","views":4297},
  {"project":"en.wikipedia","article":"Black_hole","granularity":"daily","timestamp":"2026080300","access":"all-access","agent":"user","views":4784}]}
```

**Surprises**

- **A misspelled title is not an error you can detect here.** `Blakc_hole`
  returns the same 404 "no data" message as a real article with no views in the
  range. The app checks titles with the MediaWiki API first (section 3).
- **Redirects are counted separately.** `Obama` got 3,598 views in August 2026
  because it only counts people who typed that exact redirect; the real article
  is `Barack_Obama`. The app resolves redirects before asking for views.
- Days with zero views are **omitted**, not returned as `0`, so the chart code
  fills gaps with zeros.
- Data starts on **2015-07-01**. Earlier start dates are silently clipped.
- A malformed date (`2026-08-01`) returns **400** *"start timestamp is invalid"*.

## 3. Checking / normalizing titles (MediaWiki Action API)

```
GET https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&titles=obama|blakc%20hole|taylor%20swift&origin=*
```

`origin=*` is required for the browser to allow the cross-origin request.

```json
{"query":{
  "normalized":[{"from":"obama","to":"Obama"}, {"from":"blakc hole","to":"Blakc hole"}, ...],
  "redirects":[{"from":"Obama","to":"Barack Obama"}, {"from":"Taylor swift","to":"Taylor Swift"}],
  "pages":[{"ns":0,"title":"Blakc hole","missing":true},
           {"pageid":534366,"ns":0,"title":"Barack Obama"},
           {"pageid":5422144,"ns":0,"title":"Taylor Swift"}]}}
```

For a "did you mean…?" hint when a title is missing:

```
GET https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&list=search&srsearch=blakc%20hole&srinfo=suggestion&srprop=&origin=*
→ {"query":{"searchinfo":{"suggestion":"black hole"},"search":[]}}
```

## 4. Autocomplete and namespace names

```
GET https://en.wikipedia.org/w/rest.php/v1/search/title?q=blakc%20hol&limit=3
→ {"pages":[{"id":4650,"key":"Black_hole","title":"Black hole","description":"Compact astronomical body","thumbnail":{...}}, ...]}

GET https://en.wikipedia.org/w/api.php?action=query&meta=siteinfo&siprop=general|namespaces|namespacealiases&format=json&formatversion=2&origin=*
→ namespace names like "Special", "Wikipedia", "Portal" (translated per wiki) and the Main Page title
```

## 5. Thumbnails and descriptions for many articles in one call

```
GET https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=pageimages|description&piprop=thumbnail&pithumbsize=400&titles=Dolly_Parton|Black_hole|Deaths_in_2026&origin=*
→ {"query":{"normalized":[{"from":"Dolly_Parton","to":"Dolly Parton"},...],
   "pages":[{"title":"Black hole","thumbnail":{"source":"https://thumb.wikimedia.org/...","width":400,"height":400},
             "description":"Compact astronomical body"}, ...]}}
```

Up to 50 titles per request. The `pages` come back in **a different order** than
requested, and underscores become spaces, so the app matches results by the
normalized title rather than by position.

## 6. CORS check (can a browser page call these directly?)

| Host | `Access-Control-Allow-Origin` | Preflight (`OPTIONS`) |
| --- | --- | --- |
| `wikimedia.org/api/rest_v1` | `*` | **405**: so no custom headers, plain `GET` only |
| `en.wikipedia.org/w/api.php` | `*` (with `origin=*`) | n/a |
| `en.wikipedia.org/api/rest_v1` | `*` | 200 |

Because none of these need a key and all allow cross-origin `GET`, the whole app
can be a static page with no backend, which is why it can run live on GitHub Pages.
