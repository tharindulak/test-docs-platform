#!/bin/bash
# Sets up (or checks) docs-platform's search on the 141 VM, apart from wso2-docs-site (spec/edge-and-hosting.md,
# VM search; .scratch/wso2-docs-bundles/issues/06-vm-hosting-spec.md as amended): user docs-platform, Typesense on
# 127.0.0.1:8109 with its keys made here, the search-only gate, a Platform release to run it, two deploy keys, and
# one Caddy snippet that publishes only the search endpoints at https://<host>/_typesense/. Safe to run again.
#
#   sudo ./setup.sh check
#   sudo ./setup.sh apply --keys <dir> --host <public host> --platform-ref <tag> --platform-repo <owner/name>
#                         [--cors-origin https://<origin>]
#   ./setup.sh snippet --host <public host> [--cors-origin https://<origin>]   print the Caddy snippet (no root)
#
# --keys: a folder with the public halves of the two deploy keys (private halves stay in GitHub secrets):
#   search-upload.pub  rrsync, write-only, no deletes, into /srv/docs-platform/search/incoming   (DOCS_SEARCH_UPLOAD_KEY)
#   search-gate.pub    docs-platform-gate: search-index, search-check, search-key, status       (DOCS_SEARCH_GATE_KEY)
# Each must be one ssh-ed25519 public key. A re-run may leave out --keys, --host or --platform-ref to keep what is set.
#
# check verifies the VM first (Ubuntu 22.04+, arm64 or amd64, 4 GB memory free for Typesense, port 8109 free, Docker,
# Caddy, rrsync, root login off); apply refuses to change anything when that fails. After apply, check reports drift.
# Never touched: /srv/docs, user deploy, port 8108 and wso2-docs-site's Caddy site blocks.
# The checks read `test && ok ... || bad ...`: ok, bad, pass and fail always succeed.
# shellcheck disable=SC2015
set -euo pipefail
export LC_ALL=C
HERE=$(cd -- "$(dirname -- "$0")" && pwd)

USER_NAME=docs-platform
ETC=/etc/docs-platform
SEARCH_ROOT=/srv/docs-platform/search
INCOMING=$SEARCH_ROOT/incoming
OPT=/opt/docs-platform
GATE=/usr/local/sbin/docs-platform-gate
COMPOSE_DIR=$OPT/typesense
COMPOSE_PROJECT=docs-platform-typesense
PORT=8109
MEMORY_LIMIT=4294967296   # compose.yaml's mem_limit: 4g
KEYS_FILE=/etc/ssh/authorized_keys/docs-platform
SSHD_CONF=/etc/ssh/sshd_config.d/61-docs-platform.conf
RRSYNC=/usr/bin/rrsync
CADDYFILE=/etc/caddy/Caddyfile
SNIPPET=/etc/caddy/docs-platform.caddy
DEFAULT_CORS=https://wso2-docs-site.tharinduj.workers.dev   # staging (worker/wrangler.jsonc env.staging DOCS_HOST)

# Node 22 from the official tarball; the checksums are nodejs.org's SHASUMS256.txt for this version.
NODE_VERSION=22.23.4
node_sha256() {
  case $1 in
    arm64) echo 6287aa46b6c375d816e63ae66d024fbbfd70404825aabdfdf898a970871d2f4b ;;
    x64)   echo 1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce ;;
  esac
}

die() { echo "setup: $*" >&2; exit 1; }
need_root() { [[ $(id -u) == 0 ]] || die "run as root (sudo)"; }

HOST_RE='^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$'
ORIGIN_RE='^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$'
REF_RE='^v?[0-9][A-Za-z0-9._-]{0,62}$'
REPO_RE='^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$'

# ---- what apply writes (check compares against the same functions) ----

key_command() {
  case $1 in
    search-upload) echo "$RRSYNC -wo -no-del -munge $INCOMING" ;;
    search-gate)   echo "$GATE" ;;
  esac
}
KEY_NAMES=(search-upload search-gate)

sshd_conf() {
  cat <<EOF
# docs-platform deploy user (hosting/vm/setup.sh): keys in a root-owned file, so nothing the user writes changes them.
Match User $USER_NAME
    AuthorizedKeysFile $KEYS_FILE
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    DisableForwarding yes
    PermitTTY no
EOF
}

gate_conf() {
  cat <<EOF
# docs-platform-gate settings (hosting/vm/setup.sh). Root-owned: the gate sources it.
SEARCH_ROOT=$SEARCH_ROOT
PLATFORM=$OPT/current
NODE=$OPT/node/bin/node
SEARCH_ENV=staging
TYPESENSE_URL=http://127.0.0.1:$PORT
TYPESENSE_ENV=$ETC/typesense.env
STALE_MINUTES=1440
EOF
}

# The one Caddy snippet: a site address with a path, so it takes /_typesense/* on the host and leaves every other
# route of any site block for the same host as it is (Caddy orders the more specific path first). Only Typesense's
# search endpoints pass: GET /collections/<c>/documents/search, POST /multi_search, GET /health; CORS for one origin.
caddy_snippet() {   # $1 host, $2 CORS origin
  cat <<EOF
# docs-platform search (hosting/vm/setup.sh; imported once from $CADDYFILE). Generated: edit setup.sh, not this file.
# Only Typesense's search endpoints on 127.0.0.1:$PORT, at https://$1/_typesense/, with CORS for $2.
$1/_typesense/* {
	request_body {
		max_size 64KB
	}
	uri strip_prefix /_typesense
	header {
		Access-Control-Allow-Origin "$2"
		Vary Origin
		-Server
	}
	@search {
		method GET
		path_regexp ^/collections/[A-Za-z0-9_-]+/documents/search$
	}
	@multi {
		method POST
		path /multi_search
	}
	@health {
		method GET
		path /health
	}
	@preflight {
		method OPTIONS
		path_regexp ^/(multi_search|collections/[A-Za-z0-9_-]+/documents/search)$
	}
	handle @preflight {
		header Access-Control-Allow-Methods "GET, POST, OPTIONS"
		header Access-Control-Allow-Headers "Content-Type, X-TYPESENSE-API-KEY"
		header Access-Control-Max-Age "86400"
		respond 204
	}
	handle @search {
		reverse_proxy 127.0.0.1:$PORT
	}
	handle @multi {
		reverse_proxy 127.0.0.1:$PORT
	}
	handle @health {
		reverse_proxy 127.0.0.1:$PORT
	}
	handle {
		respond 404
	}
}
EOF
}

# Install $2 at $3 with owner $1 and mode $4 when it differs; report what changed.
put() {
  if [[ -f $3 ]] && cmp -s -- "$2" "$3" && [[ $(stat -c '%U:%G %a' -- "$3") == "$1 $4" ]]; then return 0; fi
  install -o "${1%%:*}" -g "${1##*:}" -m "$4" -- "$2" "$3"
  echo "updated $3"
}

node_arch() { case $(dpkg --print-architecture) in arm64) echo arm64 ;; amd64) echo x64 ;; *) return 1 ;; esac; }
typesense_running() { [[ -n $(docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" 2>/dev/null) ]]; }
typesense_healthy() { curl -fsS --max-time 5 "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"ok":true'; }

# ---- the VM's own requirements: checked before apply changes anything ----

preflight() {
  local failed=0 version arch avail
  pass() { echo "ok     $*"; }
  fail() { echo "FAIL   $*"; failed=1; }
  # shellcheck source=/dev/null
  version=$(. /etc/os-release && [[ $ID == ubuntu ]] && echo "$VERSION_ID") || version=''
  [[ -n $version ]] && dpkg --compare-versions "$version" ge 22.04 && pass "Ubuntu $version" || fail "not Ubuntu 22.04 or newer"
  arch=$(dpkg --print-architecture 2>/dev/null || true)
  [[ $arch == arm64 || $arch == amd64 ]] && pass "architecture $arch" || fail "architecture ${arch:-unknown} (arm64 or amd64 only)"
  if typesense_running; then
    pass "Typesense already running (its memory is in use, not free)"
  else
    avail=$(awk '/^MemAvailable:/ { print int($2 / 1048576) }' /proc/meminfo)
    (( avail >= 4 )) && pass "${avail} GB memory available" || fail "${avail} GB memory available; Typesense needs 4 GB"
    [[ -z $(ss -Htln "sport = :$PORT") ]] && pass "port $PORT free" || fail "port $PORT is in use by something else"
  fi
  command -v docker >/dev/null && docker compose version >/dev/null 2>&1 && pass "Docker with compose" || fail "Docker with the compose plugin is not installed"
  command -v caddy >/dev/null && systemctl is-active --quiet caddy && pass "Caddy running" || fail "Caddy is not installed and running"
  [[ -f $CADDYFILE ]] && pass "$CADDYFILE" || fail "no $CADDYFILE"
  [[ -x $RRSYNC ]] && "$RRSYNC" -help 2>&1 | grep -q -- -no-del && pass "rrsync with -no-del" || fail "$RRSYNC missing or too old (rsync 3.2.4+)"
  [[ $(sshd -T 2>/dev/null | awk '/^permitrootlogin/ { print $2 }') == no ]] && pass "root login off" || fail "root login is not off (PermitRootLogin no)"
  return $failed
}

# ---- installs ----

install_node() {
  local arch dir tarball sum pinned
  arch=$(node_arch) || die "no Node build for $(dpkg --print-architecture)"
  pinned=$(node_sha256 "$arch")
  dir=$OPT/node-v$NODE_VERSION-linux-$arch
  if [[ ! -x $dir/bin/node ]]; then
    tarball=$TMP/node.tar.xz
    curl -fsSL --proto '=https' "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$arch.tar.xz" -o "$tarball"
    sum=$(sha256sum "$tarball" | awk '{ print $1 }')
    [[ $sum == "$pinned" ]] || die "Node $NODE_VERSION ($arch) checksum $sum is not the pinned $pinned"
    install -d -m 755 "$dir.tmp"
    tar -xJf "$tarball" -C "$dir.tmp" --strip-components 1 --no-same-owner
    mv -T -- "$dir.tmp" "$dir"
    echo "installed Node $NODE_VERSION ($arch)"
  fi
  ln -sfn -- "${dir##*/}" "$OPT/node.tmp" && mv -Tf -- "$OPT/node.tmp" "$OPT/node"
}

# A Platform release at /opt/docs-platform/<ref>, root-owned, with its runtime dependencies (no install scripts);
# `current` points at it once it runs.
install_platform() {   # $1 ref, $2 repo
  local ref=$1 repo=$2 dir=$OPT/$1 work
  if [[ ! -f $dir/bin/wso2-release.mjs ]]; then
    work=$TMP/platform
    git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$ref" -- "https://github.com/$repo.git" "$work"
    grep -q TYPESENSE_SEARCH_PARENT_KEY "$work/bin/wso2-release.mjs" \
      || die "$repo $ref predates the VM search gate (no search-export or TYPESENSE_SEARCH_PARENT_KEY); release a newer Platform"
    (cd "$work" && PATH=$OPT/node/bin:$PATH npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
    rm -rf -- "$work/.git"
    chown -R root:root "$work" && chmod -R go-w "$work"
    rm -rf -- "$dir.tmp" && mv -T -- "$work" "$dir.tmp" && mv -T -- "$dir.tmp" "$dir"
    echo "installed the Platform $repo $ref at $dir"
  fi
  (cd "$dir" && "$OPT/node/bin/node" bin/wso2-release.mjs help >/dev/null) || die "the Platform at $dir does not run"
  ln -sfn -- "$ref" "$OPT/current.tmp" && mv -Tf -- "$OPT/current.tmp" "$OPT/current"
}

apply_keys() {   # $1 folder of .pub files
  local name line
  : >"$TMP/keys"
  for name in "${KEY_NAMES[@]}"; do
    [[ -f $1/$name.pub ]] || die "no $1/$name.pub"
    line=$(grep -v '^\s*$' "$1/$name.pub")
    [[ $(wc -l <<<"$line") == 1 && $line =~ ^ssh-ed25519\ [A-Za-z0-9+/]+=*(\ [^\"]*)?$ ]] || die "$name.pub is not one ssh-ed25519 public key"
    printf 'restrict,command="%s" %s\n' "$(key_command "$name")" "$line" >>"$TMP/keys"
  done
  [[ $(awk '{ print $3 }' "$TMP/keys" | sort -u | wc -l) == 2 ]] || die "the upload and gate keys must differ"
  install -d -o root -g root -m 755 /etc/ssh/authorized_keys
  put root:root "$TMP/keys" "$KEYS_FILE" 644
}

apply_caddy() {   # $1 host, $2 CORS origin
  local backup=''
  # Another config already publishing /_typesense would collide with this one.
  grep -rlF --exclude="${SNIPPET##*/}" '/_typesense' /etc/caddy >/dev/null 2>&1 && die "another Caddy file already uses /_typesense; nothing changed"
  caddy_snippet "$1" "$2" >"$TMP/snippet"
  local import="import $SNIPPET"
  if [[ -f $SNIPPET ]] && cmp -s "$TMP/snippet" "$SNIPPET" && grep -qxF "$import" "$CADDYFILE"; then return 0; fi
  backup=$CADDYFILE.docs-platform-$(date -u +%Y%m%dT%H%M%SZ).bak
  cp -a -- "$CADDYFILE" "$backup"
  [[ -f $SNIPPET ]] && cp -a -- "$SNIPPET" "$TMP/snippet.before"
  install -o root -g root -m 644 -- "$TMP/snippet" "$SNIPPET"
  grep -qxF "$import" "$CADDYFILE" || printf '\n# docs-platform search (hosting/vm/setup.sh)\n%s\n' "$import" >>"$CADDYFILE"
  if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >"$TMP/validate" 2>&1; then
    cp -a -- "$backup" "$CADDYFILE"
    if [[ -f $TMP/snippet.before ]]; then cp -a -- "$TMP/snippet.before" "$SNIPPET"; else rm -f -- "$SNIPPET"; fi
    tail -5 "$TMP/validate" >&2
    die "caddy validate rejected the change; $CADDYFILE and the snippet are restored, Caddy was not reloaded"
  fi
  systemctl reload caddy
  echo "updated $SNIPPET (Caddyfile backed up to $backup); Caddy reloaded"
}

# The values apply was given, kept so a re-run and check can use them.
hosting_conf() {   # host cors repo ref
  printf 'HOST=%s\nCORS_ORIGIN=%s\nPLATFORM_REPO=%s\nPLATFORM_REF=%s\n' "$1" "$2" "$3" "$4"
}
read_hosting_conf() {
  HOST='' CORS_ORIGIN='' PLATFORM_REPO='' PLATFORM_REF=''
  [[ -f $ETC/hosting.conf ]] || return 0
  local k v
  while IFS='=' read -r k v; do
    case $k in HOST|CORS_ORIGIN|PLATFORM_REPO|PLATFORM_REF) printf -v "$k" '%s' "$v" ;; esac
  done <"$ETC/hosting.conf"
}

apply() {
  local keys='' host='' cors='' ref='' repo=''
  while (( $# )); do
    case $1 in
      --keys) keys=$2; shift 2 ;;
      --host) host=$2; shift 2 ;;
      --cors-origin) cors=$2; shift 2 ;;
      --platform-ref) ref=$2; shift 2 ;;
      --platform-repo) repo=$2; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  read_hosting_conf
  host=${host:-$HOST}; cors=${cors:-${CORS_ORIGIN:-$DEFAULT_CORS}}; ref=${ref:-$PLATFORM_REF}; repo=${repo:-$PLATFORM_REPO}
  [[ $host =~ $HOST_RE ]] || die "--host must be the public host name, such as 141-148-145-173.sslip.io"
  [[ $cors =~ $ORIGIN_RE ]] || die "--cors-origin must be an https origin"
  [[ $ref =~ $REF_RE ]] || die "--platform-ref must be a Platform release tag, such as v1.2.0"
  [[ $repo =~ $REPO_RE ]] || die "--platform-repo must be <owner>/<name>"
  [[ -n $keys || -f $KEYS_FILE ]] || die "--keys is needed the first time"
  [[ -z $keys || -d $keys ]] || die "--keys must name a folder of public keys"

  echo "Checking the VM first:"
  preflight || die "the VM does not meet the requirements above; nothing was changed"

  TMP=$(mktemp -d); trap 'rm -rf -- "$TMP"' EXIT
  local pkgs=() p
  for p in jq rsync curl ca-certificates xz-utils git openssl; do dpkg -s "$p" >/dev/null 2>&1 || pkgs+=("$p"); done
  (( ${#pkgs[@]} )) && { apt-get update -qq && apt-get install -y -qq "${pkgs[@]}" >/dev/null && echo "installed ${pkgs[*]}"; }

  # The user: no sudo, no password, /bin/sh (a forced command then never runs bash login files).
  id "$USER_NAME" >/dev/null 2>&1 || { useradd --create-home --user-group --shell /bin/sh "$USER_NAME"; echo "created user $USER_NAME"; }
  usermod -s /bin/sh "$USER_NAME"
  passwd -l "$USER_NAME" >/dev/null
  local g
  for g in sudo admin docker; do id -nG "$USER_NAME" | grep -qw "$g" && die "$USER_NAME must not be in group $g"; done
  install -d -o root -g root -m 755 /srv/docs-platform
  install -d -o "$USER_NAME" -g "$USER_NAME" -m 750 "$SEARCH_ROOT" "$INCOMING"

  # Settings, and the Typesense keys: made once here, never printed. Only root and the gate (as docs-platform) read them.
  install -d -o root -g root -m 755 "$ETC" "$OPT" "$COMPOSE_DIR"
  gate_conf >"$TMP/gate.conf"
  put root:root "$TMP/gate.conf" "$ETC/gate.conf" 644
  if [[ ! -f $ETC/typesense.env ]]; then
    (umask 077; printf 'TYPESENSE_ADMIN_KEY=%s\nTYPESENSE_SEARCH_PARENT_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" >"$TMP/ts.env")
    install -o root -g "$USER_NAME" -m 640 "$TMP/ts.env" "$ETC/typesense.env"
    echo "created $ETC/typesense.env (new admin and search-only parent keys, not shown)"
  fi
  chown root:"$USER_NAME" "$ETC/typesense.env" && chmod 640 "$ETC/typesense.env"

  # Typesense: its own compose project, on loopback 8109.
  put root:root "$HERE/typesense/compose.yaml" "$COMPOSE_DIR/compose.yaml" 644
  docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_DIR/compose.yaml" --env-file "$ETC/typesense.env" up -d --quiet-pull
  local _
  for _ in $(seq 60); do typesense_healthy && break; sleep 2; done
  typesense_healthy || die "Typesense did not become healthy on 127.0.0.1:$PORT"

  install_node
  install_platform "$ref" "$repo"
  put root:root "$HERE/docs-platform-gate" "$GATE" 755

  # Keys and sshd: write, validate, then reload.
  [[ -n $keys ]] && apply_keys "$keys"
  sshd_conf >"$TMP/sshd"
  put root:root "$TMP/sshd" "$SSHD_CONF" 644
  sshd -t || die "sshd rejects the configuration; it was not reloaded"
  # Ubuntu 24.04 starts sshd per connection (ssh.socket), so a reload may have nothing to do.
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  rm -f "/home/$USER_NAME/.ssh/authorized_keys"   # superseded by $KEYS_FILE

  apply_caddy "$host" "$cors"
  hosting_conf "$host" "$cors" "$repo" "$ref" >"$TMP/hosting.conf"
  put root:root "$TMP/hosting.conf" "$ETC/hosting.conf" 644
  echo "applied; run ./setup.sh check"
}

# ---- drift ----

drift_check() {
  local drift=0 name cmd
  ok() { echo "ok     $*"; }
  bad() { echo "DRIFT  $*"; drift=1; }
  read_hosting_conf
  TMP=$(mktemp -d); trap 'rm -rf -- "$TMP"' EXIT
  [[ $(getent passwd "$USER_NAME" | cut -d: -f7) == /bin/sh ]] && ok "$USER_NAME shell /bin/sh" || bad "$USER_NAME shell is not /bin/sh"
  [[ $(passwd -S "$USER_NAME" 2>/dev/null | awk '{ print $2 }') == L ]] && ok "$USER_NAME password locked" || bad "$USER_NAME password not locked"
  for name in sudo admin docker; do id -nG "$USER_NAME" 2>/dev/null | grep -qw "$name" && bad "$USER_NAME is in group $name" || ok "$USER_NAME not in $name"; done
  for name in "$SEARCH_ROOT" "$INCOMING"; do
    [[ $(stat -c '%U %a' "$name" 2>/dev/null) == "$USER_NAME 750" ]] && ok "$name" || bad "$name missing or not $USER_NAME 750"
  done
  [[ $(stat -c '%U:%G %a' "$ETC/typesense.env" 2>/dev/null) == "root:$USER_NAME 640" ]] && ok "typesense.env root:$USER_NAME 640" || bad "typesense.env missing or permissions"
  gate_conf >"$TMP/gate.conf"; cmp -s "$TMP/gate.conf" "$ETC/gate.conf" && ok "$ETC/gate.conf" || bad "$ETC/gate.conf differs"
  cmp -s "$HERE/docs-platform-gate" "$GATE" && ok "$GATE" || bad "$GATE differs from the kit"
  cmp -s "$HERE/typesense/compose.yaml" "$COMPOSE_DIR/compose.yaml" && ok "compose file" || bad "compose file differs from the kit"
  typesense_healthy && ok "Typesense healthy on 127.0.0.1:$PORT" || bad "Typesense not healthy on 127.0.0.1:$PORT"
  ss -Htln "sport = :$PORT" | awk '{ print $4 }' | grep -qv '^127\.0\.0\.1:' && bad "port $PORT listens beyond loopback" || ok "port $PORT on loopback only"
  local cid; cid=$(docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" 2>/dev/null | head -1)
  [[ -n $cid && $(docker inspect -f '{{.HostConfig.Memory}}' "$cid") == "$MEMORY_LIMIT" ]] && ok "Typesense memory limit 4 GB" || bad "Typesense memory limit is not 4 GB"
  [[ -x $OPT/node/bin/node && $("$OPT/node/bin/node" --version 2>/dev/null) == "v$NODE_VERSION" ]] && ok "Node $NODE_VERSION" || bad "Node is not $NODE_VERSION"
  [[ -n $PLATFORM_REF && $(readlink "$OPT/current" 2>/dev/null) == "$PLATFORM_REF" && -f $OPT/current/bin/wso2-release.mjs ]] \
    && ok "Platform $PLATFORM_REPO $PLATFORM_REF is current" || bad "$OPT/current is not the Platform release apply installed"
  [[ -z $(find "$OPT/current/" -maxdepth 3 ! -user root -print -quit 2>/dev/null) ]] && ok "Platform files root-owned" || bad "Platform files not root-owned"
  sshd_conf >"$TMP/sshd"; cmp -s "$TMP/sshd" "$SSHD_CONF" && ok "$SSHD_CONF" || bad "$SSHD_CONF differs"
  [[ $(sshd -T -C "user=$USER_NAME,host=x,addr=127.0.0.1" 2>/dev/null | awk '/^authorizedkeysfile/ { print $2 }') == "$KEYS_FILE" ]] \
    && ok "sshd uses $KEYS_FILE for $USER_NAME" || bad "sshd does not use $KEYS_FILE for $USER_NAME"
  [[ $(stat -c '%U %a' "$KEYS_FILE" 2>/dev/null) == "root 644" ]] && ok "$KEYS_FILE root 644" || bad "$KEYS_FILE missing or not root 644"
  for name in "${KEY_NAMES[@]}"; do
    cmd=$(key_command "$name")
    grep -qF "restrict,command=\"$cmd\" " "$KEYS_FILE" 2>/dev/null && ok "key $name" || bad "no $name key"
  done
  grep -vF -e "restrict,command=\"$(key_command search-upload)\" " -e "restrict,command=\"$(key_command search-gate)\" " "$KEYS_FILE" 2>/dev/null | grep -q . \
    && bad "$KEYS_FILE has lines without a known forced command" || ok "no unrestricted keys"
  if [[ -n $HOST ]]; then
    caddy_snippet "$HOST" "$CORS_ORIGIN" >"$TMP/snippet"
    cmp -s "$TMP/snippet" "$SNIPPET" && ok "$SNIPPET for $HOST" || bad "$SNIPPET differs"
    [[ $(grep -cxF "import $SNIPPET" "$CADDYFILE") == 1 ]] && ok "imported once from $CADDYFILE" || bad "$CADDYFILE does not import $SNIPPET exactly once"
    caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1 && ok "caddy validate" || bad "caddy validate fails"
    curl -fsS --max-time 10 "https://$HOST/_typesense/health" 2>/dev/null | grep -q '"ok":true' && ok "https://$HOST/_typesense/health" || bad "https://$HOST/_typesense/health does not answer"
    [[ $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$HOST/_typesense/keys" 2>/dev/null) == 404 ]] && ok "only search endpoints published" || bad "https://$HOST/_typesense/keys is not refused"
  else
    bad "no host recorded in $ETC/hosting.conf"
  fi
  return $drift
}

check() {
  need_root
  echo "The VM:"
  local status=0
  preflight || status=1
  if [[ ! -f $ETC/hosting.conf ]]; then
    echo "note   not applied yet: run ./setup.sh apply"
    return $status
  fi
  echo "What apply set up:"
  drift_check || status=2
  return $status
}

snippet() {
  local host='' cors=$DEFAULT_CORS
  while (( $# )); do
    case $1 in
      --host) host=$2; shift 2 ;;
      --cors-origin) cors=$2; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  [[ $host =~ $HOST_RE ]] || die "--host must be the public host name"
  [[ $cors =~ $ORIGIN_RE ]] || die "--cors-origin must be an https origin"
  caddy_snippet "$host" "$cors"
}

case ${1:-} in
  apply) shift; need_root; apply "$@" ;;
  check) check ;;
  snippet) shift; snippet "$@" ;;
  *) die "usage: setup.sh apply --keys <dir> --host <host> --platform-ref <tag> --platform-repo <owner/name> [--cors-origin <origin>] | setup.sh check | setup.sh snippet --host <host>" ;;
esac
