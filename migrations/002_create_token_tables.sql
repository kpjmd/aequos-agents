CREATE TABLE IF NOT EXISTS agent_wallets (
  agent_id TEXT PRIMARY KEY,
  agent_name TEXT UNIQUE NOT NULL,
  address TEXT NOT NULL,
  network TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_balances (
  agent_id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  wallet_address TEXT,
  token_balance INTEGER NOT NULL DEFAULT 0,
  total_earned INTEGER NOT NULL DEFAULT 0,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS token_transactions (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  outcome JSONB,
  additional_data JSONB,
  track TEXT,
  blockchain_tx TEXT,
  status TEXT NOT NULL,
  from_agent_id TEXT,
  to_agent_id TEXT,
  reason TEXT,
  timestamp TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_token_tx_agent_id ON token_transactions(agent_id);
CREATE INDEX IF NOT EXISTS idx_token_tx_timestamp ON token_transactions(timestamp DESC);

CREATE TABLE IF NOT EXISTS predictions (
  consultation_id TEXT PRIMARY KEY,
  case_data JSONB NOT NULL,
  agent_predictions JSONB NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prediction_resolutions (
  consultation_id TEXT NOT NULL,
  source TEXT NOT NULL,
  outcomes JSONB,
  agent_results JSONB,
  timestamp TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (consultation_id, source)
);

CREATE TABLE IF NOT EXISTS agent_performance (
  agent_id TEXT PRIMARY KEY,
  total_predictions INTEGER NOT NULL DEFAULT 0,
  total_staked INTEGER NOT NULL DEFAULT 0,
  total_won INTEGER NOT NULL DEFAULT 0,
  total_lost INTEGER NOT NULL DEFAULT 0,
  average_accuracy REAL NOT NULL DEFAULT 0,
  prediction_count INTEGER NOT NULL DEFAULT 0,
  dimension_accuracy JSONB,
  last_updated TIMESTAMP DEFAULT NOW()
);
