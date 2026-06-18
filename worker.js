const ALLOWED_KINDS = new Set(["whisper", "letter", "echo"]);

const RESTRICTED_KINDS = new Set(["whisper", "echo"]);

// Public base URL for the treehole-photos R2 bucket.
const R2_PUBLIC_URL = "https://pub-f42708c63abc452a9ea946efd7103d9a.r2.dev";

function r2KeyFromUrl(url) {
  if (!url || typeof url !== "string" || !url.startsWith(R2_PUBLIC_URL + "/")) return null;
  return url.slice(R2_PUBLIC_URL.length + 1);
}

async function deleteEchoPhotos(env, contentStr) {
  if (!env.PHOTOS || !contentStr) return;
  try {
    const obj = JSON.parse(contentStr);
    if (!obj || typeof obj !== "object") return;
    const key = r2KeyFromUrl(obj.image);
    if (key) await env.PHOTOS.delete(key);
  } catch {}
}

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

// Strip the full-size base64 photo from echo list responses so the grid
// payload stays small on mobile. R2-backed echoes store a short URL instead
// of base64, so those are cheap and can be left in — the guard on startsWith
// keeps backward-compat with older posts that still have inline base64.
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

// Echo content now stores only metadata + thumb + an R2 URL, so it is small.
// Keep a generous cap for backward-compat with older base64 posts.
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
        created_at TEXT NOT NULL,
        reply TEXT
      )`
    )
    .run();
  // Migration for databases created before the reply column existed.
  try { await db.prepare("ALTER TABLE public_posts ADD COLUMN reply TEXT").run(); } catch {}
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
    // Lets the author confirm their login matches the server without publishing.
    // Never reveals the key — only whether it is configured and whether it matches.
    if (url.searchParams.get("check") === "author") {
      const configured = !!env.AUTHOR_KEY;
      const ok = configured && authMatches(request.headers.get("x-author-key"), env.AUTHOR_KEY);
      return json({ configured, ok });
    }

    const idParam = url.searchParams.get("id");
    if (idParam !== null) {
      const id = Number(idParam);
      if (!Number.isInteger(id) || id <= 0) {
        return json({ error: "A valid post id is required." }, 400);
      }
      const post = await env.DB.prepare(
        "SELECT id, kind, content, created_at, reply FROM public_posts WHERE id = ?"
      )
        .bind(id)
        .first();
      if (!post) return json({ error: "Not found." }, 404);
      return json({ post });
    }

    const kind = url.searchParams.get("kind") || "whisper";
    if (!ALLOWED_KINDS.has(kind)) {
      return json({ error: "Unsupported post kind." }, 400);
    }

    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit")) || 100, 1),
      100
    );

    let posts;
    if (kind === "echo") {
      // Strip inline base64 photos at the database layer so D1 never has to
      // return multi-megabyte rows. Pulling the full base64 for every echo was
      // overflowing the query response and making the whole grid fail to load.
      // R2-backed echoes keep their short image URL untouched; only "data:"
      // base64 blobs are removed. The full photo for old posts is still
      // reachable through the by-id detail query above.
      const { results } = await env.DB.prepare(
        `SELECT id, kind,
           CASE WHEN json_valid(content)
                     AND substr(json_extract(content, '$.image'), 1, 5) = 'data:'
                THEN json_remove(content, '$.image')
                ELSE content END AS content,
           created_at, reply
         FROM public_posts WHERE kind = ? ORDER BY id DESC LIMIT ?`
      )
        .bind(kind, limit)
        .all();
      posts = (results || []).map((p) => ({ ...p, content: lightenEchoContent(p.content) }));
    } else {
      const { results } = await env.DB.prepare(
        "SELECT id, kind, content, created_at, reply FROM public_posts WHERE kind = ? ORDER BY id DESC LIMIT ?"
      )
        .bind(kind, limit)
        .all();
      posts = results || [];
    }
    return json({ posts });
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
    if (RESTRICTED_KINDS.has(kind)) {
      if (!env.AUTHOR_KEY) {
        return json({ error: "Author posting is not configured. Set the AUTHOR_KEY secret." }, 503);
      }
      if (!authMatches(request.headers.get("x-author-key"), env.AUTHOR_KEY)) {
        return json({ error: "Unauthorized." }, 401);
      }
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

  if (request.method === "DELETE") {
    if (!env.AUTHOR_KEY) {
      return json({ error: "Author actions are not configured. Set the AUTHOR_KEY secret." }, 503);
    }
    if (!authMatches(request.headers.get("x-author-key"), env.AUTHOR_KEY)) {
      return json({ error: "Unauthorized." }, 401);
    }
    const id = Number(url.searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return json({ error: "A valid post id is required." }, 400);
    }
    const row = await env.DB.prepare("SELECT kind, content FROM public_posts WHERE id = ?")
      .bind(id)
      .first();
    if (row && row.kind === "echo") await deleteEchoPhotos(env, row.content);
    await env.DB.prepare("DELETE FROM public_posts WHERE id = ?").bind(id).run();
    return json({ deleted: true, id });
  }

  if (request.method === "PUT") {
    if (!env.AUTHOR_KEY) {
      return json({ error: "Author actions are not configured. Set the AUTHOR_KEY secret." }, 503);
    }
    if (!authMatches(request.headers.get("x-author-key"), env.AUTHOR_KEY)) {
      return json({ error: "Unauthorized." }, 401);
    }
    const id = Number(url.searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return json({ error: "A valid post id is required." }, 400);
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }
    const reply = String(body.reply || "").trim();
    if (reply.length > 2000) {
      return json({ error: "Reply is too long." }, 400);
    }
    await env.DB.prepare("UPDATE public_posts SET reply = ? WHERE id = ? AND kind = 'letter'")
      .bind(reply || null, id)
      .run();
    return json({ updated: true, id, reply });
  }

  return json({ error: "Method not allowed." }, 405);
}

async function handlePhotos(request, env) {
  if (!env.PHOTOS) return json({ error: "R2 binding PHOTOS is not configured." }, 500);
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!env.AUTHOR_KEY) return json({ error: "Author actions are not configured." }, 503);
  if (!authMatches(request.headers.get("x-author-key"), env.AUTHOR_KEY)) {
    return json({ error: "Unauthorized." }, 401);
  }

  const contentType = request.headers.get("content-type") || "image/jpeg";
  const ext = (contentType.split("/")[1] || "jpeg").split(";")[0];
  const key = `photos/echo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  await env.PHOTOS.put(key, request.body, { httpMetadata: { contentType } });

  return json({ url: `${R2_PUBLIC_URL}/${key}` }, 201);
}

// One-time migration: moves inline base64 images from old echo posts into R2.
// Idempotent — posts already pointing at R2 URLs are counted as skipped.
async function handleMigrate(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!env.AUTHOR_KEY) return json({ error: "Author actions are not configured." }, 503);
  if (!authMatches(request.headers.get("x-author-key"), env.AUTHOR_KEY)) {
    return json({ error: "Unauthorized." }, 401);
  }
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500);
  if (!env.PHOTOS) return json({ error: "R2 binding PHOTOS is not configured." }, 500);

  await ensureSchema(env.DB);
  // Pull ids only first. The base64 rows can be megabytes each, so selecting
  // every content at once would overflow the query response — the same failure
  // that breaks the echo grid. Fetching one row at a time keeps each query small.
  const idRows = await env.DB.prepare(
    "SELECT id FROM public_posts WHERE kind = 'echo' ORDER BY id"
  ).all();
  const ids = (idRows.results || []).map((r) => r.id);

  let migrated = 0, skipped = 0, errors = 0;

  for (const id of ids) {
    try {
      const row = await env.DB.prepare("SELECT content FROM public_posts WHERE id = ?")
        .bind(id)
        .first();
      if (!row) { skipped++; continue; }

      let obj;
      try { obj = JSON.parse(row.content); } catch { skipped++; continue; }
      if (!obj || typeof obj !== "object" || !obj.image || !obj.image.startsWith("data:")) {
        skipped++;
        continue;
      }

      const comma = obj.image.indexOf(",");
      if (comma === -1) { skipped++; continue; }
      const meta = obj.image.slice(0, comma);
      const b64 = obj.image.slice(comma + 1);
      const mimeMatch = meta.match(/data:([^;]+)/);
      const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
      const ext = (mimeType.split("/")[1] || "jpeg").split(";")[0];

      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const key = `photos/echo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      await env.PHOTOS.put(key, bytes.buffer, { httpMetadata: { contentType: mimeType } });
      const r2Url = `${R2_PUBLIC_URL}/${key}`;

      await env.DB.prepare("UPDATE public_posts SET content = ? WHERE id = ?")
        .bind(JSON.stringify({ ...obj, image: r2Url }), id)
        .run();

      migrated++;
    } catch {
      errors++;
    }
  }

  return json({ migrated, skipped, errors, total: ids.length });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/posts") return handlePosts(request, env);
    if (url.pathname === "/api/photos") return handlePhotos(request, env);
    if (url.pathname === "/api/migrate") return handleMigrate(request, env);

    return env.ASSETS.fetch(request);
  },
};
