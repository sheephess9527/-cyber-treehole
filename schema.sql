CREATE TABLE IF NOT EXISTS public_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  contact TEXT,
  created_at TEXT NOT NULL,
  reply TEXT
);

CREATE INDEX IF NOT EXISTS idx_public_posts_kind_created
ON public_posts (kind, created_at DESC);