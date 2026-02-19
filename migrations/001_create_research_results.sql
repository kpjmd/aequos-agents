CREATE TABLE research_results (
  id SERIAL PRIMARY KEY,
  consultation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'complete', 'failed')),
  intro TEXT,
  citations JSONB,
  search_query TEXT,
  studies_reviewed INTEGER,
  tier TEXT CHECK (tier IN ('basic', 'premium')),
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX idx_research_consultation_id ON research_results(consultation_id);
CREATE INDEX idx_research_status ON research_results(status);
