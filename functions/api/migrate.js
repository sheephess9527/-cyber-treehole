const R2_PUBLIC_URL = "https://pub-f42708c63abc452a9ea946efd7103d9a.r2.dev";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
};

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function authMatches(provided, expected) {
  return safeEqual(String(provided || "").trim(), String(expected || "").trim());
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

// One-time migration: moves inline base64 images from old echo posts into R2.
// Idempotent — posts already pointing at R2 URLs are counted as skipped.
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.AUTHOR_KEY) return json({ error: "Author actions are not configured." }, 503);
  if (!authMatches(request.headers.get("x-author-key"), env.AUTHOR_KEY)) {
    return json({ error: "Unauthorized." }, 401);
  }
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500);
  if (!env.PHOTOS) return json({ error: "R2 binding PHOTOS is not configured." }, 500);

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
      await env.PHOTOS.put(key, bytes.buffer, {
        httpMetadata: { contentType: mimeType, cacheControl: "public, max-age=31536000, immutable" },
      });
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
