CREATE TABLE users (
  id bigint PRIMARY KEY,
  username text,
  display_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payments (
  charge_id text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id),
  payload text NOT NULL,
  currency text NOT NULL,
  amount integer NOT NULL,
  status text NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid','refunded','chargeback')),
  is_recurring boolean NOT NULL DEFAULT false,
  is_first_recurring boolean NOT NULL DEFAULT false,
  subscription_expiration_date timestamptz,
  provider_charge_id text,
  raw jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id text NOT NULL REFERENCES payments(charge_id),
  user_id bigint NOT NULL,
  amount integer NOT NULL,
  status text NOT NULL CHECK (status IN ('requested','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE subscriptions (
  charge_id text PRIMARY KEY REFERENCES payments(charge_id),
  user_id bigint NOT NULL,
  period_seconds integer NOT NULL,
  expires_at timestamptz NOT NULL,
  canceled_at timestamptz
);
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','dead')),
  idempotency_key text UNIQUE,
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_ready_idx ON jobs (status, run_at);
CREATE TABLE broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed')),
  created_by bigint NOT NULL,
  last_user_id bigint NOT NULL DEFAULT 0,
  sent integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE TABLE broadcast_deliveries (
  broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed')),
  error text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (broadcast_id, chat_id)
);
CREATE INDEX broadcasts_status_idx ON broadcasts (status, created_at);
CREATE INDEX broadcast_deliveries_chat_idx ON broadcast_deliveries (chat_id);
