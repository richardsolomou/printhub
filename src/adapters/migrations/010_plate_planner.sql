CREATE TABLE IF NOT EXISTS plate_model_analysis (
  request_id TEXT PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
  width_mm REAL NOT NULL,
  depth_mm REAL NOT NULL,
  height_mm REAL NOT NULL,
  analyzed_at INTEGER NOT NULL
);
