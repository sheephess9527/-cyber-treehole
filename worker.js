const ALLOWED_KINDS = new Set(["whisper", "letter"]);

async function ensureSchema(db) {
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

    const { results } = await env.DB.prepare(
      "SELECT id, kind, content, created_at FROM public_posts WHERE kind = ? ORDER BY id DESC LIMIT 100"
    )
      .bind(kind)
      .all();

    return json({ posts: results || [] });
  }

  if (request.method === "POST") {
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
    if (!content || content.length > 2000) {
      return json({ error: "Content must be 1-2000 characters." }, 400);
    }
    if (contact.length > 500) {
      return json({ error: "Contact must be 500 characters or fewer." }, 400);
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
