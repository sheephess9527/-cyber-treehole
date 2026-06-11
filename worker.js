const ALLOWED_KINDS = new Set(["whisper", "letter", "echo"]);

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
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS public_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        contact TEXT,
        created_at TEXT NOT NULL
      )`
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_public_posts_kind_created
       ON public_posts (kind, created_at DESC)`
    )
    .run();
  schemaReady = true;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function handlePosts(request, env) {
  if (!env.DB) {
    return json({ error: "D1 binding DB is not configured." }, 500);
  }

  await ensureSchema(env.DB);
  const url = new URL(request.url);

  if (request.method === "GET") {
    const kind = url.searchParams.get("kind") || "whisper";
    if (!ALLOWED_KINDS.has(kind)) {
      return json({ error: "Unsupported post kind." }, 400);
    }

    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit")) || 100, 1),
      100
    );

    const { results } = await env.DB.prepare(
      "SELECT id, kind, content, created_at FROM public_posts WHERE kind = ? ORDER BY id DESC LIMIT ?"
    )
      .bind(kind, limit)
      .all();

    return json({ posts: results || [] });
  }

  if (request.method === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (rateLimited(ip)) {
      return json({ error: "Too many requests. Please slow down." }, 429);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const kind = String(body.kind || "").trim();
    const content = String(body.content || "").trim();
    const contact = String(body.contact || "").trim();

    if (!ALLOWED_KINDS.has(kind)) {
      return json({ error: "Unsupported post kind." }, 400);
    }
    if (!content) {
      return json({ error: "Content is required." }, 400);
    }
    if (content.length > MAX_CONTENT[kind]) {
      return json({ error: "Content is too long." }, 400);
    }
    if (contact.length > MAX_CONTACT) {
      return json({ error: "Contact is too long." }, 400);
    }

    const createdAt = new Date().toISOString();
    const result = await env.DB.prepare(
      "INSERT INTO public_posts (kind, content, contact, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(kind, content, contact || null, createdAt)
      .run();

    return json(
      {
        post: {
          id: result.meta.last_row_id,
          kind,
          content,
          created_at: createdAt,
        },
      },
      201
    );
  }

  return json({ error: "Method not allowed." }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/posts") {
      return handlePosts(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
