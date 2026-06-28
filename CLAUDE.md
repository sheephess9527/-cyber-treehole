# CLAUDE.md — 赛博自留地 (Cyber Treehole)

Guidance for any AI assistant (or new developer) picking up this project. Read
this first; it captures the architecture, the non-obvious decisions, the
gotchas, and how to verify changes.

---

## 1. What this is

A personal, single-author "treehole" website (赛博自留地) with three sections:

- **呢喃墙 (whispers)** — short text notes. Author-only publishing.
- **光影与回响 (echoes)** — photo + title + body posts. Author-only publishing.
- **留白与信箱 (about / letters)** — anyone can leave a message (信箱); the
  author can reply publicly. Also holds backup import/export and author login.

It is intentionally tiny: one HTML file for the entire frontend, one Worker
file for the entire backend. No build step, no framework, no npm dependencies.

## 2. Architecture

```
Browser ──HTTPS──> Cloudflare Worker (worker.js)
                     ├─ /api/posts    → D1 (binding: DB)      posts CRUD
                     ├─ /api/photos   → R2 (binding: PHOTOS)  photo upload
                     ├─ /api/migrate  → D1 + R2               one-time data fix
                     └─ everything else → static assets (env.ASSETS), incl. index.html
```

- **Frontend:** `index.html` — a single file with inline `<style>` and
  `<script>`. Vanilla JS, no framework. All views are rendered by string
  templates into `#root`. State lives in module-scope variables.
- **Backend:** `worker.js` — a single Cloudflare Worker. This is the **active**
  backend (see wrangler.jsonc `main`). It serves both the API and the static
  assets.
- **Database:** Cloudflare **D1** (SQLite), binding `DB`, one table
  `public_posts` (see `schema.sql`). The worker auto-creates/migrates the
  schema on first request via `ensureSchema()`.
- **Object storage:** Cloudflare **R2**, binding `PHOTOS`, bucket
  `treehole-photos`. Echo photos are stored here; D1 only keeps the public URL.
- **PWA:** `manifest.webmanifest` + `sw.js` (service worker) + icons. Installs
  to the iOS/Android home screen.

### ⚠️ `functions/` is NOT used in production

There is a `functions/api/` directory (Cloudflare **Pages** Functions). The
site is deployed as a **Worker**, not Pages, so `functions/` is currently dead
code. `.assetsignore` also stops it from being served as static files.

**Keep `functions/api/*.js` in sync with `worker.js`** anyway (same logic,
Pages calling conventions) so the project can fall back to Pages if ever
needed. When you change a route in `worker.js`, mirror it in `functions/api/`.
The canonical, tested implementation is `worker.js`.

## 3. Deployment

- The site auto-deploys from the **`main`** branch (Cloudflare Git integration).
  **To make a change go live, it must land on `main`.**
- Feature work happens on `claude/website-bug-vulnerability-review-2ikyon`, then
  is fast-forwarded to `main`:
  ```bash
  git push -u origin claude/website-bug-vulnerability-review-2ikyon
  git push origin HEAD:main
  ```
- `wrangler.jsonc` declares: `main: worker.js`, static `assets` from `.`,
  SPA fallback, the `DB` (D1) binding, and the `PHOTOS` (R2) binding.
- After a deploy, the user may need a hard refresh (the service worker caches
  static assets, not HTML — navigations always hit the network).

## 4. Bindings & secrets (set in the Cloudflare dashboard)

| Name         | Type   | Notes                                                        |
|--------------|--------|-------------------------------------------------------------|
| `DB`         | D1     | database `treehole-db`, id in `wrangler.jsonc`              |
| `PHOTOS`     | R2     | bucket `treehole-photos`, public dev URL is `R2_PUBLIC_URL` |
| `AUTHOR_KEY` | Secret | the author password. **Never** hardcode it anywhere.       |

- `R2_PUBLIC_URL` (hardcoded in `worker.js` / `functions/` / referenced in tests)
  is the R2 bucket's public base URL: `https://pub-<hash>.r2.dev`. If the bucket
  or its public URL changes, update that constant in all three places.

### 🔐 Security rules — do not break these

- **`AUTHOR_KEY` is a server-side secret.** It only ever exists as a Cloudflare
  environment secret. NEVER write it into any file, commit, comment, test, or
  log. Tests use a fake key (`"secret-key-123"`).
- Author actions (publish whisper/echo, delete, reply, upload photo, migrate)
  are gated by the `x-author-key` request header, compared server-side with a
  **constant-time** check (`safeEqual`) after trimming whitespace
  (`authMatches` — tolerates a stray trailing space/newline from mobile paste).
- The browser stores the key in `localStorage` only to decide whether to show
  the publish forms; the server is always the real gate.
- **All user content is HTML-escaped** via `safe()` before being inserted into
  templates (escapes `& < > " '`). Keep using it for any new rendered field.
- Letter **`contact` is never returned** by any GET/list response — it is
  write-only into D1.

## 5. Data model

Table `public_posts`:

| column       | meaning                                                              |
|--------------|---------------------------------------------------------------------|
| `id`         | autoincrement primary key                                           |
| `kind`       | `'whisper'` \| `'echo'` \| `'letter'`                               |
| `content`    | whisper/letter: plain text. echo: **JSON string** (see below).      |
| `contact`    | letter only; write-only, never read back                            |
| `created_at` | ISO 8601 UTC                                                        |
| `reply`      | author's public reply to a letter (nullable)                       |

**Echo `content` JSON shape:**
```json
{ "title": "...", "body": "...", "image": "<R2 url or data: base64>", "thumb": "data:image/jpeg;base64,..." }
```
- New echoes store `image` as a short **R2 URL**; `thumb` is a small inline
  base64 preview (~tens of KB) used by the grid.
- Old echoes stored `image` as a multi-MB inline base64 `data:` URL. These were
  migrated to R2 via `/api/migrate` (see §7).

## 6. API reference (`worker.js`)

All JSON, `cache-control: no-store`.

- `GET  /api/posts?kind=whisper|echo|letter&limit=N` — list newest-first.
  - For `kind=echo`, the query **strips inline base64 `image` at the SQL layer**
    (`json_remove` guarded by `json_valid`) so D1 never returns multi-MB rows.
    R2-URL images are kept; `thumb` is kept. This is critical — see §7.
- `GET  /api/posts?id=N` — single post with **full** `content` (base64 intact
  for old echoes). Used to lazy-load a full photo on the detail view.
- `GET  /api/posts?check=author` (header `x-author-key`) — returns
  `{ configured, ok }`. Lets login verify the key without publishing. Never
  echoes the key.
- `POST /api/posts` — create. Body `{ kind, content, contact? }`. whisper/echo
  require auth; letter is open. Rate-limited (5 / 30s / IP, in-memory).
  Validates length: whisper/letter ≤ 2000, echo ≤ 1,000,000, contact ≤ 500.
- `DELETE /api/posts?id=N` — author-only. For echoes it also deletes the photo
  from R2 (`deleteEchoPhotos` → `r2KeyFromUrl`) before removing the row.
- `PUT  /api/posts?id=N` — author-only; sets `reply` on a letter.
- `POST /api/photos` — author-only. Body is raw image bytes; stores in R2 and
  returns `{ url }`. Returns 500 if `PHOTOS` is unbound (frontend then falls
  back to inline base64).
- `POST /api/migrate` — author-only, idempotent. One-time data fix; see §7.

## 7. The base64 → R2 migration (important context)

Originally echo photos were stored as base64 inside D1 `content`. This caused a
real outage: listing echoes pulled every multi-MB row at once, overflowing D1's
query response, so the **entire echo grid failed to load** ("云端暂不可用").
Whispers/letters were fine because they have no base64.

The fix has three parts (all shipped):
1. **List query strips base64 at the SQL layer** (`json_remove`) so the grid is
   always light, regardless of migration state.
2. **`/api/migrate`** moves each old base64 image into R2 and rewrites the row
   to a short URL. It reads **ids first, then one row at a time**, so it can't
   hit the same response-size overflow.
3. The author can trigger it from the UI — the 「留白与信箱」 backup area has a
   `[ 迁移旧图片到 R2 ]` button (`runMigrate`). It is also curl-callable:
   ```bash
   curl -X POST https://<site>/api/migrate -H "x-author-key: <AUTHOR_KEY>"
   # → {"migrated":N,"skipped":M,"errors":0,"total":T}
   ```

## 8. Frontend notes (`index.html`)

- **Routing:** hash-based. `#whispers`, `#echoes`, `#echoes/<index>`, `#about`.
  `applyRoute()` reads `location.hash`; `go()`/`switchTab()` set it. Refresh and
  back button work. Echo detail uses the **array index** into the combined list
  (public + local + default) — fragile if order changes, but fine in practice.
- **Caching:** whispers, letters, and echoes use stale-while-revalidate via
  `localStorage` (`treehole.cache.*`), revalidated once per session. The echo
  cache stores a **lightened** form only — `lightenEchoForCache`/`writeEchoCache`
  drop any base64 `image`/`thumb` blobs and keep just http(s) URLs + metadata, so
  the cache can't bloat or hit quota (the original bug that broke the echo tab).
  Never write raw base64 into the echo cache.
- **Photos:** on echo submit → `compressImage` (≤~2MB) → `makeThumb` (small
  preview) → `uploadPhotoToR2` → store `{title,body,image:<r2url>,thumb}` in D1.
  If R2 upload fails (non-auth), it falls back to inline base64 (subject to the
  1MB cap, so very large photos then save locally only).
- **Drafts:** half-written whisper/echo/letter autosave to `localStorage`
  (`treehole.drafts`) per kind; cleared on successful publish.
- **Auto-backup:** after each successful publish, a text-only snapshot is
  written to `treehole.autobackup`. It preserves not-yet-loaded sections from
  the previous snapshot (so publishing without visiting a tab can't wipe that
  tab's backup).
- **Letter reply:** inline editor (not `window.prompt`) —
  `startReplyLetter`/`submitReplyLetter`/`cancelReplyLetter` render a textarea in
  place via `letterArticleHtml`. Saving an empty reply deletes it. Letters
  paginate with `showMoreLetters`. Times can render as relative
  (`relativeTime`/`formatTimeHtml`).
- **SEO:** `<head>` has Open Graph / Twitter card meta; `robots.txt` and
  `sitemap.xml` are served as static assets.
- **Author login:** inline input (not `window.prompt`) with
  `autocapitalize/autocorrect/spellcheck=off` so iOS can't silently alter the
  key. Verified against `?check=author` before being trusted.

## 9. How to verify changes (tests)

Pure-Node tests using the built-in `node:sqlite` (Node 22+) — no install needed.
They import `worker.js` directly and shim D1/R2.

```bash
node tests/core.test.mjs      # posts, auth, rate limit, privacy, echo stripping
node tests/r2.test.mjs        # photo upload + echo R2 flow
node tests/migrate.test.mjs   # /api/migrate, idempotency
```

All three should print `N 通过 / 0 失败`. **Run them after any `worker.js`
change.** If you change behavior, update the tests too. Note: these test
`worker.js`; if you also edit `functions/api/*`, keep it mirrored (it has no
separate harness).

## 10. Conventions & gotchas

- Reply to the user in **Chinese** (the project and user are Chinese).
- Keep the zero-dependency, single-file ethos. Don't add a build step or
  framework without a strong reason.
- Don't cache `/api/*` in the service worker — data must stay live. When
  changing static caching, bump `VERSION` in `sw.js`.
- The in-memory rate limiter is per-isolate and best-effort (not a real DDoS
  defense); it resets when the isolate recycles.
- `created_at` is UTC; the frontend converts to local time for display.
- When editing, match the surrounding style and comment density.
- Do **not** open a PR unless the user explicitly asks.
