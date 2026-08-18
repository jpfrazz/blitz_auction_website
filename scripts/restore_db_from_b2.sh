#!/usr/bin/env bash

# ==============================================================================
# Script: restore_db_from_b2.sh
# Purpose: Automatically downloads the latest database backup from Backblaze B2
#          using rclone, unpacks the SQL dump into ./db_init/, and restarts
#          docker compose (-v) so Postgres initializes with the backup.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# 1. Load environment variables from .env
if [ -f "${PROJECT_DIR}/.env" ]; then
    echo "[+] Loading environment variables from .env"
    export $(grep -v '^#' "${PROJECT_DIR}/.env" | xargs)
fi

B2_KEY_ID="${B2_KEY_ID:-}"
B2_APPLICATION_KEY="${B2_APPLICATION_KEY:-}"
B2_BUCKET_NAME="${B2_BUCKET_NAME:-}"
BACKUP_PREFIX="${BACKUP_PREFIX:-}" # e.g. "backups/"

TEMP_DIR="${PROJECT_DIR}/scratch"
INIT_DIR="${PROJECT_DIR}/db_init"

mkdir -p "${TEMP_DIR}" "${INIT_DIR}"
rm -rf "${INIT_DIR:?}"/* # Clear previous initialization files

# 2. Verify requirements
if ! command -v rclone &> /dev/null; then
    echo "[!] Error: 'rclone' is not installed."
    echo "    Install with: sudo apt install rclone (or curl https://rclone.org/install.sh | sudo bash)"
    exit 1
fi

if [ -z "${B2_KEY_ID}" ] || [ -z "${B2_APPLICATION_KEY}" ] || [ -z "${B2_BUCKET_NAME}" ]; then
    echo "[!] Error: Missing B2_KEY_ID, B2_APPLICATION_KEY, or B2_BUCKET_NAME in .env"
    exit 1
fi

# Configure rclone dynamic remote
export RCLONE_CONFIG_B2REMOTE_TYPE="b2"
export RCLONE_CONFIG_B2REMOTE_ACCOUNT="${B2_KEY_ID}"
export RCLONE_CONFIG_B2REMOTE_KEY="${B2_APPLICATION_KEY}"

REMOTE_PATH="b2remote:${B2_BUCKET_NAME}/${BACKUP_PREFIX}"

echo "=================================================="
echo " Backblaze B2 Database Restore Script (rclone)"
echo " Bucket: ${B2_BUCKET_NAME}"
echo "=================================================="

# 3. Find latest backup file in Backblaze B2 bucket
echo "[+] Querying latest database backup from Backblaze B2..."
LATEST_BACKUP_FILENAME=$(rclone lsl "${REMOTE_PATH}" \
    | sort -k2,2 -k3,3 \
    | tail -n 1 \
    | awk '{print $4}')

if [ -z "${LATEST_BACKUP_FILENAME}" ]; then
    echo "[!] Error: No backup files found in ${REMOTE_PATH}"
    exit 1
fi

echo "[+] Latest backup found: ${LATEST_BACKUP_FILENAME}"
DOWNLOAD_PATH="${TEMP_DIR}/${LATEST_BACKUP_FILENAME}"

# 4. Download latest backup
echo "[+] Downloading ${LATEST_BACKUP_FILENAME} via rclone..."
rclone copyto "${REMOTE_PATH}${LATEST_BACKUP_FILENAME}" "${DOWNLOAD_PATH}" --progress

# 5. Unpack/copy to ./db_init/01_init.sql for PostgreSQL initialization
echo "[+] Unpacking backup into ./db_init/01_init.sql..."
TARGET_INIT_SQL="${INIT_DIR}/01_init.sql"

if [[ "${DOWNLOAD_PATH}" == *.sql.gz ]] || [[ "${DOWNLOAD_PATH}" == *.gz ]]; then
    gunzip -c "${DOWNLOAD_PATH}" > "${TARGET_INIT_SQL}"
elif [[ "${DOWNLOAD_PATH}" == *.sql ]]; then
    cp "${DOWNLOAD_PATH}" "${TARGET_INIT_SQL}"
elif [[ "${DOWNLOAD_PATH}" == *.tar.gz ]] || [[ "${DOWNLOAD_PATH}" == *.tgz ]]; then
    tar -xzf "${DOWNLOAD_PATH}" -C "${INIT_DIR}"
elif [[ "${DOWNLOAD_PATH}" == *.zip ]]; then
    unzip -q "${DOWNLOAD_PATH}" -d "${INIT_DIR}"
else
    echo "[!] Unrecognized extension, copying directly to ${TARGET_INIT_SQL}"
    cp "${DOWNLOAD_PATH}" "${TARGET_INIT_SQL}"
fi

echo "[+] Backup successfully placed in ${TARGET_INIT_SQL}"

# 6. Wipe DB volume and restart compose environment
echo "[+] Running 'docker compose down -v' to wipe old database volume..."
cd "${PROJECT_DIR}"
docker compose down -v --remove-orphans

echo "[+] Starting containers with fresh database volume..."
docker compose up -d

echo "[+] Waiting for PostgreSQL to initialize..."
until docker exec auction-db pg_isready -U postgres &>/dev/null; do
    sleep 2
done

# 7. Cleanup unpacked init files after container startup
echo "[+] Cleaning up local temporary backup files..."
rm -f "${DOWNLOAD_PATH}"
rm -rf "${INIT_DIR:?}"/*

echo "=================================================="
echo " Restore completed! Database populated and services running."
echo "=================================================="
