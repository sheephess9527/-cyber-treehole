-- Schema for the Cyber Treehole D1 database (binding name: DB).
-- The worker also creates/migrates this automatically on first request via
-- ensureSchema(), so running this by hand is optional. Kept here as the
-- source-of-truth reference for the table shape.

CREATE TABLE IF NOT EXISTS public_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,          -- 'whisper' | 'echo' | 'letter'
  content TEXT NOT NULL,       -- plain text (whisper/letter) or JSON (echo)
  contact TEXT,                -- letter only; never returned by list/GET APIs
  created_at TEXT NOT NULL,    -- ISO 8601 UTC timestamp
  reply TEXT                   -- author's public reply to a letter (nullable)
);

CREATE INDEX IF NOT EXISTS idx_public_posts_kind_created
ON public_posts (kind, created_at DESC);
