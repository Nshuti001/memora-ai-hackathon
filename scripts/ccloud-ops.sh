#!/usr/bin/env bash
#
# Memora cluster operations via the ccloud CLI.
#
# ccloud is CockroachDB Cloud's control plane in the terminal. Every command emits JSON, which is why
# this wrapper exists: an agent can call these subcommands and parse the result, instead of a human
# clicking through the Cloud Console. That makes cluster operations — backups, network rules, user
# management, health checks — available to the same agent that uses the database.
#
# Install:  brew install cockroachdb/tap/ccloud     (or see cockroachlabs.com/docs/cockroachcloud/ccloud-get-started)
# Auth:     ccloud auth login
#           For automation prefer a service account:
#             export CCLOUD_API_KEY=...      # granular RBAC, no interactive browser login
#
# Usage:    ./scripts/ccloud-ops.sh <command> [args]
#           CLUSTER=my-cluster ./scripts/ccloud-ops.sh status
#
set -euo pipefail

CLUSTER="${CLUSTER:-memora}"

die() { echo "error: $*" >&2; exit 1; }

require_ccloud() {
  command -v ccloud >/dev/null 2>&1 || die \
    "ccloud is not installed. brew install cockroachdb/tap/ccloud (see SETUP.md)"
}

cluster_id() {
  ccloud cluster list --format json \
    | jq -r --arg name "$CLUSTER" '.[] | select(.name == $name) | .id' \
    | head -1
}

usage() {
  cat <<'EOF'
Memora cluster operations (ccloud)

  status              Cluster health, region, and plan, as JSON
  backups             List available backups with their timestamps
  backup-now          Trigger an on-demand backup before a risky migration
  users               List SQL users on the cluster
  network             Show IP allowlist / connection restrictions
  connection-string   Print the connection string for server/.env
  audit               Recent control-plane audit log entries
  retention           Report the MVCC window time-travel recall can reach
  preflight           Run every read-only check before a deploy

Environment:
  CLUSTER   cluster name (default: memora)
EOF
}

cmd_status() {
  require_ccloud
  local id; id="$(cluster_id)"
  [ -n "$id" ] || die "no cluster named '$CLUSTER'. Run: ccloud cluster list"
  ccloud cluster describe "$id" --format json
}

cmd_backups() {
  require_ccloud
  local id; id="$(cluster_id)"
  [ -n "$id" ] || die "no cluster named '$CLUSTER'"
  # Newest first, so "did last night's backup run?" is answerable at a glance.
  ccloud cluster backup list "$id" --format json | jq 'sort_by(.created_at) | reverse'
}

cmd_backup_now() {
  require_ccloud
  local id; id="$(cluster_id)"
  [ -n "$id" ] || die "no cluster named '$CLUSTER'"
  echo "Triggering backup of $CLUSTER ($id)…" >&2
  ccloud cluster backup create "$id" --format json
}

cmd_users() {
  require_ccloud
  local id; id="$(cluster_id)"
  ccloud cluster user list "$id" --format json
}

cmd_network() {
  require_ccloud
  local id; id="$(cluster_id)"
  ccloud cluster networking allowlist list "$id" --format json
}

cmd_connection_string() {
  require_ccloud
  local id; id="$(cluster_id)"
  [ -n "$id" ] || die "no cluster named '$CLUSTER'"
  echo "Add this to server/.env as DATABASE_URL (it contains a password — do not commit it):" >&2
  ccloud cluster sql-connection-string "$id" --format json | jq -r '.connection_string'
}

cmd_audit() {
  require_ccloud
  ccloud audit-log list --format json | jq 'sort_by(.timestamp) | reverse | .[0:25]'
}

# Reads the retention window from the database rather than from the control plane, because
# gc.ttlseconds is a table-level property and it is what actually bounds time-travel recall.
cmd_retention() {
  [ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is not set (source server/.env first)"
  command -v cockroach >/dev/null 2>&1 || die "the cockroach binary is required for this command"

  cockroach sql --url "$DATABASE_URL" --format csv --execute \
    "SELECT raw_config_sql FROM [SHOW ZONE CONFIGURATION FOR TABLE memories];" \
    | grep -o 'gc.ttlseconds = [0-9]*' \
    || echo "gc.ttlseconds not set explicitly — cluster default applies (4h)"
}

# Everything here is read-only, so it is safe to run against production before a deploy.
cmd_preflight() {
  echo "=== cluster ==="
  cmd_status | jq '{name, state, cloud_provider, plan, regions: [.regions[]?.name]}'

  echo
  echo "=== most recent backup ==="
  cmd_backups | jq '.[0] // "no backups found"'

  echo
  echo "=== network allowlist ==="
  cmd_network | jq 'length as $n | if $n == 0 then "OPEN — no allowlist entries" else . end'

  echo
  echo "=== time-travel retention ==="
  cmd_retention || true

  echo
  echo "Preflight complete. Review anything above before deploying."
}

case "${1:-}" in
  status)             cmd_status ;;
  backups)            cmd_backups ;;
  backup-now)         cmd_backup_now ;;
  users)              cmd_users ;;
  network)            cmd_network ;;
  connection-string)  cmd_connection_string ;;
  audit)              cmd_audit ;;
  retention)          cmd_retention ;;
  preflight)          cmd_preflight ;;
  ""|-h|--help|help)  usage ;;
  *)                  die "unknown command '$1' (try --help)" ;;
esac
