#!/usr/bin/env bash
# Convenience launcher: verifies prerequisites then starts all dev processes.
set -euo pipefail

if [ ! -f apps/api/.env ]; then
  echo "!! apps/api/.env is missing. Copy apps/api/.env.example and fill in values." >&2
  exit 1
fi

echo ">> Checking database connectivity..."
npm run db:check -w @contributor/api

echo ">> Starting dev processes (shared watch + API + Web)..."
npm run dev
