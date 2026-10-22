#!/usr/bin/env bash
# Operations for the PostgreSQL + Redis Docker host (see docs/runbook.md).
set -euo pipefail

REMOTE_USER_HOST="${BARA_INFRA_HOST:-${CONTRIBUTOR_INFRA_HOST:-training@192.168.0.62}}"
REMOTE_DIR="${BARA_INFRA_DIR:-${CONTRIBUTOR_INFRA_DIR:-~/contributor-ai-infra}}"
COMPOSE="docker compose --project-name bara"

usage() {
  echo "Usage: bash scripts/infra.sh <up|down|ps|logs|backup|deploy>"
  exit 1
}

[ $# -ge 1 ] || usage
cmd="$1"

case "$cmd" in
  deploy)
    echo ">> Copying compose files to ${REMOTE_USER_HOST}:${REMOTE_DIR}"
    ssh "$REMOTE_USER_HOST" "mkdir -p ${REMOTE_DIR}/initdb"
    scp infra/docker-compose.yml "$REMOTE_USER_HOST:${REMOTE_DIR}/docker-compose.yml"
    scp infra/initdb/01-test-db.sql "$REMOTE_USER_HOST:${REMOTE_DIR}/initdb/01-test-db.sql"
    if ! ssh "$REMOTE_USER_HOST" "test -f ${REMOTE_DIR}/.env"; then
      scp infra/.env "$REMOTE_USER_HOST:${REMOTE_DIR}/.env"
      echo ">> Uploaded infra/.env (generated locally, gitignored)"
    else
      echo ">> Remote .env already exists - left untouched"
    fi
    ;;
  up)
    ssh "$REMOTE_USER_HOST" "cd ${REMOTE_DIR} && ${COMPOSE} up -d && ${COMPOSE} ps"
    ;;
  down)
    ssh "$REMOTE_USER_HOST" "cd ${REMOTE_DIR} && ${COMPOSE} down"
    ;;
  ps)
    ssh "$REMOTE_USER_HOST" "cd ${REMOTE_DIR} && ${COMPOSE} ps"
    ;;
  logs)
    ssh "$REMOTE_USER_HOST" "cd ${REMOTE_DIR} && ${COMPOSE} logs --tail=100"
    ;;
  backup)
    stamp=$(date +%Y%m%d-%H%M%S)
    ssh "$REMOTE_USER_HOST" "docker exec bara-postgres pg_dump -U ca contributor_ai | gzip > ${REMOTE_DIR}/backup-contributor_ai-${stamp}.sql.gz && ls -lh ${REMOTE_DIR}/backup-contributor_ai-${stamp}.sql.gz"
    ;;
  *)
    usage
    ;;
esac
