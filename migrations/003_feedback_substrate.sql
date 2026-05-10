-- Drop prediction market tables (mechanically faulty; replaced by consultation_feedback)
DROP TABLE IF EXISTS prediction_resolutions CASCADE;
DROP TABLE IF EXISTS predictions CASCADE;
DROP TABLE IF EXISTS agent_performance CASCADE;

-- Create feedback ingest table as V2 prediction market substrate.
-- Receives MD review, user modal, and PROMIS follow-up payloads from existing
-- frontend / admin dashboard / Farcaster integrations. Accumulates passively
-- until V2 prediction market is designed from real outcome data.
CREATE TABLE IF NOT EXISTS consultation_feedback (
  id SERIAL PRIMARY KEY,
  consultation_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('user_modal', 'md_review', 'follow_up')),
  payload JSONB NOT NULL,
  submitted_by TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_consultation_id ON consultation_feedback(consultation_id, feedback_type);
