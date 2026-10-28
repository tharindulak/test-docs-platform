#!/bin/bash
# CI's side of VM search (spec/edge-and-hosting.md, VM search), run from a Platform checkout by release.yml,
# rollback.yml and search-consistency.yml in a job that runs no content code:
#   1. wso2-release search-export copies what search reads from the bucket (state, composed manifest, each
#      deployment's search files) to a temporary folder;
#   2. rsync uploads it with the write-only upload key (rrsync into the VM's incoming folder);
#   3. the gate key runs one allowed verb through docs-platform-gate, which indexes or checks on the VM.
# The Typesense admin key never leaves the VM. A failure exits non-zero for the step's continue-on-error: search
# never blocks a release. Connection failures retry with backoff.
#
#   search-via-gate.sh index --storage <s> --deploy "<space>/<segment>=<release> ..." [--policy <composed.json>]
#   search-via-gate.sh check --storage <s> [--fix] [--policy <composed.json>] [--out <report.json>]
#
# Environment (the GitHub environment's secrets): DOCS_SEARCH_HOST (the VM's SSH host), DOCS_SEARCH_KNOWN_HOSTS
# (its known_hosts line), DOCS_SEARCH_UPLOAD_KEY and DOCS_SEARCH_GATE_KEY (the private halves); plus the bucket's
# R2_* credentials for search-export.
set -euo pipefail
export LC_ALL=C
ROOT=$(cd -- "$(dirname -- "$0")/../.." && pwd)
SSH_USER=docs-platform
ATTEMPTS=${DOCS_SEARCH_ATTEMPTS:-3}

die() { echo "::warning title=Search index::$*"; exit 1; }

verb=${1:-}; shift || true
storage='' deploy='' policy='' fix='' out=''
while (( $# )); do
  case $1 in
    --storage) storage=$2; shift 2 ;;
    --deploy) deploy=$2; shift 2 ;;
    --policy) policy=$2; shift 2 ;;
    --fix) fix=--fix; shift ;;
    --out) out=$2; shift 2 ;;
    *) die "unknown option $1" ;;
  esac
done
[[ $verb == index || $verb == check ]] || die "usage: search-via-gate.sh index|check --storage <s> ..."
[[ -n $storage ]] || die "--storage is required"
for v in DOCS_SEARCH_HOST DOCS_SEARCH_KNOWN_HOSTS DOCS_SEARCH_UPLOAD_KEY DOCS_SEARCH_GATE_KEY; do
  [[ -n ${!v:-} ]] || die "$v is not set in this environment; search was not updated (hosting/vm/README.md)"
done
[[ $DOCS_SEARCH_HOST =~ ^[A-Za-z0-9.:-]+$ ]] || die "DOCS_SEARCH_HOST is not a host name"

WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
(umask 077
 printf '%s\n' "$DOCS_SEARCH_UPLOAD_KEY" >"$WORK/upload"
 printf '%s\n' "$DOCS_SEARCH_GATE_KEY" >"$WORK/gate"
 printf '%s\n' "$DOCS_SEARCH_KNOWN_HOSTS" >"$WORK/known_hosts")
SSH_OPTS=(-o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$WORK/known_hosts"
  -o ConnectTimeout=20 -o ServerAliveInterval=15)

# The search files, laid out as the bucket.
args=(search-export --storage "$storage" --out "$WORK/inputs")
[[ -n $deploy ]] && args+=(--deploy "$deploy")
[[ -n $policy ]] && args+=(--policy "$policy")
node "$ROOT/bin/wso2-release.mjs" "${args[@]}"

retry() {   # retry <exit codes that mean "try again"> <command...>
  local again=$1 n=1 status; shift
  while :; do
    status=0; "$@" || status=$?
    [[ $status == 0 ]] && return 0
    [[ " $again " == *" $status "* && $n -lt $ATTEMPTS ]] || return "$status"
    echo "attempt $n failed ($status); retrying" >&2
    sleep $((5 * 2 ** (n - 1))); n=$((n + 1))
  done
}

# Upload: rsync over the upload key; rrsync on the VM writes only into the incoming folder and deletes nothing.
retry "5 10 12 23 30 35 255" rsync -rc --chmod=D750,F640 -e "ssh ${SSH_OPTS[*]} -i $WORK/upload" \
  "$WORK/inputs/" "$SSH_USER@$DOCS_SEARCH_HOST:" || die "the upload to $DOCS_SEARCH_HOST failed"

# The gate: ssh exits 255 when it could not connect, which is retried; anything else is the gate's own answer.
# shellcheck disable=SC2329 # called through retry
gate() { ssh "${SSH_OPTS[@]}" -i "$WORK/gate" "$SSH_USER@$DOCS_SEARCH_HOST" "$1"; }
annotate() { sed -u 's/^warning: /::warning title=Search index::/'; }
if [[ $verb == index ]]; then
  read -r -a list <<<"$deploy"
  (( ${#list[@]} )) || die "--deploy lists no deployment"
  status=0
  retry 255 gate "search-index ${list[*]}" 2>&1 | annotate || status=$?
  exit "$status"
fi
status=0
retry 255 gate "search-check${fix:+ $fix}" >"$WORK/report.json" || status=$?
if [[ -n $out ]]; then cp "$WORK/report.json" "$out"; else cat "$WORK/report.json"; fi
exit "$status"
