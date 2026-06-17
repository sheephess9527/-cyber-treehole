const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const allowedKinds = new Set(["whisper", "letter", "echo"]);

// Only the site owner may publish to these. "letter" (信箱) stays open to
// everyone so visitors can still reach out. Authorship is proven with a key
// kept in the AUTHOR_KEY environment secret — never shipped to the browser.
const restrictedKinds = new Set(["whisper", "echo"]);

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// Compare the supplied key against the configured one, trimming both ends.
// Secrets pasted into the dashboard on a phone often pick up a stray trailing
// space or newline; without this, that invisible character causes a permanent
// 401 that no amount of re-login can fix.
function authMatches(provided, expected) {
  return safeEqual(String(provided || "").trim(), String(expected || "").trim());
}

// Per-kind content limits. echo carries an embedded image payload, so it needs
// more room than a plain text post. Large media should ideally live in R2, but
// this keeps the bundled-image flow working without a separate storage binding.
const MAX_CONTENT = { whisper: 2000, letter: 2000, echo: 1000000 };
const MAX_CONTACT = 500;

// Best-effort, in-memory rate limit. State lives only inside the current
// isolate and is never persisted, so it adds no deanonymization surface. It
// will not stop a distributed flood, but it blunts trivial single-source spam.
const RATE_WINDOW_MS = 30000;
const RATE_MAX = 5;
const rateState = new Map();

let schemaReady = false;

function rateLimited(ip) {
  const now = Date.now();
  const hits = (rateState.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    rateState.set(ip, hits);
    return true;
  }
  hits.push(now);
  rateState.set(ip, hits);
  if (rateState.size > 5000) rateState.clear();
  return false;
}

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS public_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      contact TEXT,
      created_at TEXT NOT NULL,
      reply TEXT
    )
  `).run();
  // Migration for databases created before the reply column existed.
  try { await db.prepare("ALTER TABLE public_posts ADD COLUMN reply TEXT").run(); } catch {}
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_public_posts_kind_created
    ON public_posts (kind, created_at DESC)
  `).run();
  schemaReady = true;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

// Strip base64 photos from echo list responses to keep the payload small.
// R2-backed echoes store a short URL instead of base64, so those are left in —
// the startsWith guard keeps backward-compat with older base64 posts.
function lightenEchoContent(contentStr) {
  try {
    const obj = JSON.parse(contentStr);
    if (obj && typeof obj === "object" && obj.image && obj.image.startsWith("data:")) {
      const { image, ...rest } = obj;
      return JSON.stringify(rest);
    }
  } catch {}
  return contentStr;
}

export async function onRequestGet(context) {
  const db = context.env.DB;
  if (!db) return json({ error: "D1 binding DB is missing" }, 500);

  const url = new URL(context.request.url);
  await ensureSchema(db);

  // Lets the author confirm their login matches the server without publishing.
  // Never reveals the key — only whether it is configured and whether it matches.
  if (url.searchParams.get("check") === "author") {
    const configured = !!context.env.AUTHOR_KEY;
    const ok = configured && authMatches(context.request.headers.get("x-author-key"), context.env.AUTHOR_KEY);
    return json({ configured, ok });
  }

  const idParam = url.searchParams.get("id");
  if (idParam !== null) {
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) return json({ error: "A valid post id is required" }, 400);
    const post = await db.prepare(`
      SELECT id, kind, content, created_at, reply FROM public_posts WHERE id = ?
    `).bind(id).first();
    if (!post) return json({ error: "Not found" }, 404);
    return json({ post });
  }

  const kind = url.searchParams.get("kind") || "whisper";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);

  if (!allowedKinds.has(kind)) return json({ error: "Invalid kind" }, 400);

  let posts;
  if (kind === "echo") {
    // Strip inline base64 photos at the database layer so D1 never returns
    // multi-megabyte rows — pulling them all overflowed the query response and
    // broke the echo grid. R2-backed echoes keep their short URL; only "data:"
    // base64 blobs are removed. Full photos stay reachable via the by-id query.
    const result = await db.prepare(`
      SELECT id, kind,
        CASE WHEN json_valid(content)
                  AND substr(json_extract(content, '$.image'), 1, 5) = 'data:'
             THEN json_remove(content, '$.image')
             ELSE content END AS content,
        created_at, reply
      FROM public_posts
      WHERE kind = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).bind(kind, limit).all();
    posts = (result.results || []).map((p) => ({ ...p, content: lightenEchoContent(p.content) }));
  } else {
    const result = await db.prepare(`
      SELECT id, kind, content, created_at, reply
      FROM public_posts
      WHERE kind = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).bind(kind, limit).all();
    posts = result.results || [];
  }
  return json({ posts });
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  if (!db) return json({ error: "D1 binding DB is missing" }, 500);

  const ip = context.request.headers.get("CF-Connecting-IP") || "unknown";
  if (rateLimited(ip)) {
    return json({ error: "Too many requests. Please slow down." }, 429);
  }

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const kind = String(payload.kind || "").trim();
  const content = String(payload.content || "").trim();
  const contact = String(payload.contact || "").trim();

  if (!allowedKinds.has(kind)) return json({ error: "Invalid kind" }, 400);
  if (restrictedKinds.has(kind)) {
    if (!context.env.AUTHOR_KEY) return json({ error: "Author posting is not configured. Set the AUTHOR_KEY secret." }, 503);
    if (!authMatches(context.request.headers.get("x-author-key"), context.env.AUTHOR_KEY)) {
      return json({ error: "Unauthorized" }, 401);
    }
  }
  if (!content) return json({ error: "Content is required" }, 400);
  if (content.length > MAX_CONTENT[kind]) return json({ error: "Content is too long" }, 400);
  if (contact.length > MAX_CONTACT) return json({ error: "Contact is too long" }, 400);

  await ensureSchema(db);
  const createdAt = new Date().toISOString();
  const inserted = await db.prepare(`
    INSERT INTO public_posts (kind, content, contact, created_at)
    VALUES (?, ?, ?, ?)
    RETURNING id, kind, content, created_at
  `).bind(kind, content, contact || null, createdAt).first();

  return json({ post: inserted }, 201);
}

export async function onRequestDelete(context) {
  const db = context.env.DB;
  if (!db) return json({ error: "D1 binding DB is missing" }, 500);

  if (!context.env.AUTHOR_KEY) return json({ error: "Author actions are not configured. Set the AUTHOR_KEY secret." }, 503);
  if (!authMatches(context.request.headers.get("x-author-key"), context.env.AUTHOR_KEY)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(context.request.url);
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return json({ error: "A valid post id is required" }, 400);

  await ensureSchema(db);
  await db.prepare("DELETE FROM public_posts WHERE id = ?").bind(id).run();
  return json({ deleted: true, id });
}

export async function onRequestPut(context) {
  const db = context.env.DB;
  if (!db) return json({ error: "D1 binding DB is missing" }, 500);

  if (!context.env.AUTHOR_KEY) return json({ error: "Author actions are not configured. Set the AUTHOR_KEY secret." }, 503);
  if (!authMatches(context.request.headers.get("x-author-key"), context.env.AUTHOR_KEY)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(context.request.url);
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return json({ error: "A valid post id is required" }, 400);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const reply = String(body.reply || "").trim();
  if (reply.length > 2000) return json({ error: "Reply is too long" }, 400);

  await ensureSchema(db);
  await db.prepare("UPDATE public_posts SET reply = ? WHERE id = ? AND kind = 'letter'")
    .bind(reply || null, id)
    .run();
  return json({ updated: true, id, reply });
}
