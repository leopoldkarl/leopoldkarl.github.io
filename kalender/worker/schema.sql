-- Eine Zeile, ein Block. Mehr braucht der Server nicht zu wissen.
CREATE TABLE IF NOT EXISTS state (
  id         TEXT PRIMARY KEY,
  version    INTEGER NOT NULL,
  updated_at TEXT    NOT NULL,
  blob       TEXT    NOT NULL
);
