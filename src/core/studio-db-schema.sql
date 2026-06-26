-- ============================================================================
-- opencode-studio — unified SQLite schema
-- Path: .studio/studio.db (disposable cache; source files are source of truth)
-- bun:sqlite ships with FTS5 enabled by default — zero extra deps.
--
-- One database holds EVERYTHING:
--   - Code intelligence (files, symbols, chunks, edges, imports)
--   - Workspace state  (plans, tasks, rules, branches, handoffs, pins)
--   - Cost ledger      (per-message token usage + $ cost)
--   - Misc             (meta, compressed-tool-output cache refs)
-- ============================================================================

-- --- Files: one row per indexed source file --------------------------------
CREATE TABLE IF NOT EXISTS files (
  id            INTEGER PRIMARY KEY,
  path          TEXT NOT NULL UNIQUE,
  lang          TEXT,
  size_bytes    INTEGER NOT NULL,
  mtime_ns      INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  parser        TEXT NOT NULL DEFAULT 'treesitter',
  indexed_at    TEXT NOT NULL,
  is_generated  INTEGER NOT NULL DEFAULT 0,
  symbol_count  INTEGER NOT NULL DEFAULT 0,
  chunk_count   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime_ns);

-- --- Symbols: definitions extracted by tree-sitter -------------------------
CREATE TABLE IF NOT EXISTS symbols (
  id            INTEGER PRIMARY KEY,
  file_id       INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  qualified     TEXT,
  kind          TEXT NOT NULL,
  line_start    INTEGER NOT NULL,
  line_end      INTEGER NOT NULL,
  signature     TEXT,
  parent_id     INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
  exported      INTEGER NOT NULL DEFAULT 0,
  in_degree     INTEGER NOT NULL DEFAULT 0,
  out_degree    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
CREATE INDEX IF NOT EXISTS idx_symbols_parent ON symbols(parent_id);

-- --- Chunks: text spans for FTS5 retrieval ---------------------------------
CREATE TABLE IF NOT EXISTS chunks (
  id            INTEGER PRIMARY KEY,
  file_id       INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  symbol_id     INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
  line_start    INTEGER NOT NULL,
  line_end      INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  content       TEXT NOT NULL,
  token_est     INTEGER NOT NULL,
  symbol_names  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_chunks_symbol ON chunks(symbol_id);

-- --- Edges: graph for impact analysis --------------------------------------
CREATE TABLE IF NOT EXISTS edges (
  id            INTEGER PRIMARY KEY,
  edge_type     TEXT NOT NULL,
  src_id        INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  src_kind      TEXT NOT NULL DEFAULT 'symbol',
  dst_id        INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
  dst_name      TEXT,
  file_id       INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  line          INTEGER,
  resolved      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_id);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_id);
CREATE INDEX IF NOT EXISTS idx_edges_dst_name ON edges(dst_name);
CREATE INDEX IF NOT EXISTS idx_edges_type_file ON edges(edge_type, file_id);

-- --- Imports: per-file import declarations ---------------------------------
CREATE TABLE IF NOT EXISTS imports (
  id            INTEGER PRIMARY KEY,
  file_id       INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,
  resolved_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  line          INTEGER NOT NULL,
  names         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_imports_file ON imports(file_id);
CREATE INDEX IF NOT EXISTS idx_imports_source ON imports(source);
CREATE INDEX IF NOT EXISTS idx_imports_resolved ON imports(resolved_file_id);

-- ============================================================================
-- Workspace state (replaces workspace.json)
-- ============================================================================

-- --- Plans: structured SDLC plans ------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  goal          TEXT NOT NULL DEFAULT '',
  research      TEXT NOT NULL DEFAULT '',   -- newline-separated
  architecture  TEXT NOT NULL DEFAULT '',
  file_structure TEXT NOT NULL DEFAULT '',
  steps_json    TEXT NOT NULL DEFAULT '[]', -- PlanStep[]
  acceptance    TEXT NOT NULL DEFAULT '',   -- newline-separated
  edge_cases    TEXT NOT NULL DEFAULT '',
  test_strategy TEXT NOT NULL DEFAULT '',
  revisions_json TEXT NOT NULL DEFAULT '[]',
  branch        TEXT,                       -- git branch when created (branch-aware)
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(active);
CREATE INDEX IF NOT EXISTS idx_plans_branch ON plans(branch);

-- --- Tasks: atomic units of work -------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|in_progress|done|blocked
  acceptance    TEXT NOT NULL DEFAULT '',   -- newline-separated
  notes         TEXT NOT NULL DEFAULT '',
  plan_id       TEXT REFERENCES plans(id) ON DELETE SET NULL,
  branch        TEXT,
  depends_on    TEXT NOT NULL DEFAULT '',   -- comma-separated task ids
  claimed_by    TEXT,                       -- agent name
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_tasks_branch ON tasks(branch);
CREATE INDEX IF NOT EXISTS idx_tasks_active ON tasks(active);

-- --- Rules: project-scoped user rules --------------------------------------
CREATE TABLE IF NOT EXISTS rules (
  id            INTEGER PRIMARY KEY,
  rule          TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL
);

-- --- Branches: in-workspace context-folding sub-goals ----------------------
CREATE TABLE IF NOT EXISTS branches (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  goal          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open',  -- open|folded
  summary       TEXT,
  parent_branch_id TEXT,
  plan_id       TEXT,
  git_branch    TEXT,                       -- actual git branch if tracked
  created_at    TEXT NOT NULL,
  folded_at     TEXT,
  active        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_branches_status ON branches(status);
CREATE INDEX IF NOT EXISTS idx_branches_active ON branches(active);

-- --- Handoffs: structured session summaries --------------------------------
CREATE TABLE IF NOT EXISTS handoffs (
  id            TEXT PRIMARY KEY,
  summary       TEXT NOT NULL,
  files_changed TEXT NOT NULL DEFAULT '',   -- newline-separated
  tests_run     TEXT,
  risks         TEXT,
  next_steps    TEXT,
  plan_id       TEXT,
  branch        TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_handoffs_created ON handoffs(created_at);

-- --- Pinned context: survives compaction -----------------------------------
CREATE TABLE IF NOT EXISTS pinned_context (
  id            INTEGER PRIMARY KEY,
  block         TEXT NOT NULL,
  pinned_at     TEXT NOT NULL
);

-- --- Verify state: latest gate result --------------------------------------
CREATE TABLE IF NOT EXISTS verify_state (
  id            INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row
  passed        INTEGER NOT NULL DEFAULT 0,
  at            TEXT NOT NULL DEFAULT '',
  commands      TEXT NOT NULL DEFAULT '',
  retry_count   INTEGER NOT NULL DEFAULT 0,
  last_failure  TEXT NOT NULL DEFAULT ''
);

-- ============================================================================
-- Cost ledger (Phase 3.6 — the differentiator)
-- ============================================================================

CREATE TABLE IF NOT EXISTS cost_events (
  id             INTEGER PRIMARY KEY,
  session_id     TEXT NOT NULL,
  message_id     TEXT NOT NULL,
  agent          TEXT,                       -- studio-explore, build, etc.
  provider_id    TEXT NOT NULL,
  model_id       TEXT NOT NULL,
  tokens_input          INTEGER NOT NULL DEFAULT 0,
  tokens_output         INTEGER NOT NULL DEFAULT 0,
  tokens_reasoning      INTEGER NOT NULL DEFAULT 0,
  cache_read            INTEGER NOT NULL DEFAULT 0,
  cache_write           INTEGER NOT NULL DEFAULT 0,
  cost_usd       REAL NOT NULL DEFAULT 0,
  branch         TEXT,
  cwd            TEXT,
  task_id        TEXT,                       -- attributed task if known
  created_at     INTEGER NOT NULL            -- unix ms (matches message time)
);
CREATE INDEX IF NOT EXISTS idx_cost_session ON cost_events(session_id);
CREATE INDEX IF NOT EXISTS idx_cost_created ON cost_events(created_at);
CREATE INDEX IF NOT EXISTS idx_cost_model ON cost_events(provider_id, model_id);
CREATE INDEX IF NOT EXISTS idx_cost_task ON cost_events(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_message ON cost_events(message_id);

-- ============================================================================
-- LSP diagnostics — real-time type/lint errors from the language server
-- ============================================================================
CREATE TABLE IF NOT EXISTS diagnostics (
  id          INTEGER PRIMARY KEY,
  file        TEXT NOT NULL,
  line        INTEGER NOT NULL,
  col         INTEGER NOT NULL DEFAULT 1,
  severity    TEXT NOT NULL,        -- error | warning | info | hint
  source      TEXT,                 -- ts, eslint, ruff, etc.
  message     TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(file, line, col, message)
);
CREATE INDEX IF NOT EXISTS idx_diag_file ON diagnostics(file);
CREATE INDEX IF NOT EXISTS idx_diag_severity ON diagnostics(severity);

-- ============================================================================
-- Meta: schema versioning + index stats
-- ============================================================================
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ============================================================================
-- FTS5: external-content table over chunks. bm25() for ranking.
-- ============================================================================
CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
  content,
  symbol_names,
  path UNINDEXED,
  content='chunks',
  content_rowid='id',
  tokenize = "unicode61 remove_diacritics 2 categories 'L* N* Co'"
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO fts_chunks(rowid, content, symbol_names, path)
  VALUES (new.id, new.content, new.symbol_names, (SELECT path FROM files WHERE id = new.file_id));
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO fts_chunks(fts_chunks, rowid, content, symbol_names, path)
  VALUES ('delete', old.id, old.content, old.symbol_names, (SELECT path FROM files WHERE id = old.file_id));
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO fts_chunks(fts_chunks, rowid, content, symbol_names, path)
  VALUES ('delete', old.id, old.content, old.symbol_names, (SELECT path FROM files WHERE id = old.file_id));
  INSERT INTO fts_chunks(rowid, content, symbol_names, path)
  VALUES (new.id, new.content, new.symbol_names, (SELECT path FROM files WHERE id = new.file_id));
END;
