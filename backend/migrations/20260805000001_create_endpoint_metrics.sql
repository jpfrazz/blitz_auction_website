CREATE TABLE IF NOT EXISTS endpoint_metrics (
    id BIGSERIAL PRIMARY KEY,
    path VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code SMALLINT NOT NULL,
    duration_ms DOUBLE PRECISION NOT NULL,
    request TEXT NOT NULL,
    response TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_endpoint_metrics_path_method ON endpoint_metrics(path, method);
CREATE INDEX IF NOT EXISTS idx_endpoint_metrics_created_at ON endpoint_metrics(created_at);
