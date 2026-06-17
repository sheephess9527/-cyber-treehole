const R2_PUBLIC_URL = "https://pub-f42708c63abc452a9ea946efd7103d9a.r2.dev";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
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

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.PHOTOS) return json({ error: "R2 binding PHOTOS is not configured." }, 500);
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
