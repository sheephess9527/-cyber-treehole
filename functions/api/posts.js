const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const allowedKinds = new Set(["whisper", "letter", "echo"]);

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
      created_at TEXT NOT NULL
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_public_posts_kind_created
    ON public_posts (kind, created_at DESC)
  `).run();
  schemaReady = true;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

export async function onRequestGet(context) {
  const db = context.env.DB;
  if (!db) return json({ error: "D1 binding DB is missing" }, 500);

  const url = new URL(context.request.url);
  const kind = url.searchParams.get("kind") || "whisper";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);

  if (!allowedKinds.has(kind)) return json({ error: "Invalid kind" }, 400);

  await ensureSchema(db);
  const result = await db.prepare(`
    SELECT id, kind, content, created_at
    FROM public_posts
    WHERE kind = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).bind(kind, limit).all();

  return json({ posts: result.results || [] });
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
