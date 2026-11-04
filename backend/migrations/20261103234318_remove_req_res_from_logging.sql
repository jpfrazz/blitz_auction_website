ALTER TABLE endpoint_metrics
    DROP COLUMN IF EXISTS request,
    DROP COLUMN IF EXISTS response;
