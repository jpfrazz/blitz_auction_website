#!/usr/bin/env bash
set -euo pipefail

# ==========================================
# CONFIGURATION
# ==========================================
LIVE_COMPOSE_SERVICE="db"                 # Docker compose service name for live DB
LIVE_DB_USER="postgres"                   # Live DB username
LIVE_DB_NAME="auction_db"                       # Live DB database name
BACKUP_FILE_PATH="../backups/db_backup_20260915_030001.sql.gz"        # Path on host to your .sql.gz backup
PG_VERSION="18"                           # Should match your live DB major version

TARGET_TABLES=("teams" "boss_battle_history")
TARGET_TABLES_SQL=$(printf "'%s'," "${TARGET_TABLES[@]}")
TARGET_TABLES_SQL="ARRAY[${TARGET_TABLES_SQL%,}]"

TEMP_CONTAINER_NAME="temp_restore_pg"
TEMP_PASSWORD="temp_secret_password"
# ==========================================

# 1. Cleanup hook to guarantee no leftover containers or FDW artifacts
cleanup() {
  echo "==> Cleaning up foreign data wrapper and temporary container..."
  docker compose exec -T "$LIVE_COMPOSE_SERVICE" psql -U "$LIVE_DB_USER" -d "$LIVE_DB_NAME" >/dev/null 2>&1 <<EOSQL || true
    DROP SCHEMA IF EXISTS backup_data CASCADE;
    DROP SERVER IF EXISTS temp_server CASCADE;
EOSQL
  docker rm -f "$TEMP_CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Step 1: Locating Docker network..."
COMPOSE_NETWORK=$(docker compose ps -q "$LIVE_COMPOSE_SERVICE" | xargs docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' | head -n 1)
if [ -z "$COMPOSE_NETWORK" ]; then
  echo "Error: Could not detect Docker network for service: $LIVE_COMPOSE_SERVICE" >&2
  exit 1
fi
echo "    Found network: $COMPOSE_NETWORK"

echo "==> Step 2: Creating safety snapshot of the live database..."
LIVE_BACKUP_FILE="safety_pre_merge_$(date +%Y%m%d_%H%M%S).sql.gz"
docker compose exec -T "$LIVE_COMPOSE_SERVICE" pg_dump -U "$LIVE_DB_USER" "$LIVE_DB_NAME" | gzip > "$LIVE_BACKUP_FILE"
echo "    Live backup saved to $LIVE_BACKUP_FILE"

echo "==> Step 3: Spinning up temporary isolated container..."
docker run -d \
  --name "$TEMP_CONTAINER_NAME" \
  --network "$COMPOSE_NETWORK" \
  -e POSTGRES_PASSWORD="$TEMP_PASSWORD" \
  "postgres:${PG_VERSION}" >/dev/null

echo "==> Waiting for temporary database to be ready..."
until docker exec -i "$TEMP_CONTAINER_NAME" pg_isready -U postgres >/dev/null 2>&1; do
  sleep 1
done

echo "==> Step 4: Streaming and restoring .sql.gz backup into temporary database..."
docker exec -i "$TEMP_CONTAINER_NAME" createdb -U postgres "$LIVE_DB_NAME"

# Stream decompress directly into psql
gunzip -c "$BACKUP_FILE_PATH" | docker exec -i "$TEMP_CONTAINER_NAME" psql -U postgres -d "$LIVE_DB_NAME" >/dev/null

echo "==> Step 5: Setting up postgres_fdw link on live database..."
docker compose exec -T "$LIVE_COMPOSE_SERVICE" psql -U "$LIVE_DB_USER" -d "$LIVE_DB_NAME" <<EOSQL
  CREATE EXTENSION IF NOT EXISTS postgres_fdw;
  DROP SERVER IF EXISTS temp_server CASCADE;
  CREATE SERVER temp_server
    FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host '$TEMP_CONTAINER_NAME', port '5432', dbname '$LIVE_DB_NAME');
  CREATE USER MAPPING FOR CURRENT_USER
    SERVER temp_server
    OPTIONS (user 'postgres', password '$TEMP_PASSWORD');
  DROP SCHEMA IF EXISTS backup_data CASCADE;
  CREATE SCHEMA backup_data;
  IMPORT FOREIGN SCHEMA public FROM SERVER temp_server INTO backup_data;
EOSQL

echo "==> Step 6: Merging specific tables and resynchronizing their sequences..."
docker compose exec -T "$LIVE_COMPOSE_SERVICE" psql -U "$LIVE_DB_USER" -d "$LIVE_DB_NAME" <<EOSQL
DO \$\$
DECLARE
    target_list text[] := ${TARGET_TABLES_SQL};
    rec RECORD;
    seq_rec RECORD;
    v_count_before bigint;
    v_count_after bigint;
    v_diff bigint;
BEGIN
    -- Topological sort filtered strictly to specified tables
    FOR rec IN
        WITH RECURSIVE fk_tree AS (
            SELECT 
                c.conrelid::regclass::text AS child_table,
                c.confrelid::regclass::text AS parent_table
            FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE c.contype = 'f' AND n.nspname = 'public'
        ),
        filtered_tables AS (
            SELECT unnest(target_list) AS tbl
        ),
        order_calc AS (
            SELECT tbl, 0 AS level
            FROM filtered_tables
            WHERE tbl NOT IN (
                SELECT child_table FROM fk_tree 
                WHERE parent_table IN (SELECT tbl FROM filtered_tables)
            )
            UNION ALL
            SELECT f.child_table, o.level + 1
            FROM fk_tree f
            JOIN order_calc o ON f.parent_table = o.tbl
            WHERE f.child_table IN (SELECT tbl FROM filtered_tables)
        ),
        ranked_tables AS (
            SELECT tbl, max(level) as depth
            FROM order_calc
            GROUP BY tbl
        ),
        pk_info AS (
            SELECT 
                tc.table_name,
                kcu.column_name as pk_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
              ON tc.constraint_name = kcu.constraint_name 
             AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY' 
              AND tc.table_schema = 'public'
              AND tc.table_name = ANY(target_list)
            GROUP BY tc.table_name, kcu.column_name
            HAVING count(*) = 1
        )
        SELECT r.tbl AS table_name, p.pk_column
        FROM ranked_tables r
        JOIN pk_info p ON r.tbl = p.table_name
        ORDER BY r.depth ASC
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = 'backup_data' AND table_name = rec.table_name
        ) THEN
            EXECUTE format('SELECT count(*) FROM public.%I', rec.table_name) INTO v_count_before;

            EXECUTE format(
                'INSERT INTO public.%I SELECT * FROM backup_data.%I ON CONFLICT (%I) DO NOTHING',
                rec.table_name, rec.table_name, rec.pk_column
            );

            EXECUTE format('SELECT count(*) FROM public.%I', rec.table_name) INTO v_count_after;
            v_diff := v_count_after - v_count_before;
            RAISE NOTICE 'Table %: Restored % missing rows.', rec.table_name, v_diff;
        ELSE
            RAISE WARNING 'Table % not found in backup schema. Skipped.', rec.table_name;
        END IF;
    END LOOP;

    -- Reset sequences ONLY for the selected tables
    FOR seq_rec IN
        SELECT 
            t.table_name,
            c.column_name,
            pg_get_serial_sequence(format('%I.%I', t.table_schema, t.table_name), c.column_name) AS seq_name
        FROM information_schema.tables t
        JOIN information_schema.columns c 
          ON t.table_schema = c.table_schema 
         AND t.table_name = c.table_name
        WHERE t.table_schema = 'public'
          AND t.table_name = ANY(target_list)
          AND pg_get_serial_sequence(format('%I.%I', t.table_schema, t.table_name), c.column_name) IS NOT NULL
    LOOP
        EXECUTE format(
            'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM public.%I), 0) + 1, false)',
            seq_rec.seq_name,
            seq_rec.column_name,
            seq_rec.table_name
        );
        RAISE NOTICE 'Reset sequence % for %', seq_rec.seq_name, seq_rec.table_name;
    END LOOP;
END \$\$;
EOSQL
echo "==> Complete! Check the row notices above to see exactly how many records were recovered."
