# VM search kit (staging)

Staging's search on the 141 VM, apart from wso2-docs-site: Typesense with its keys kept on the VM, a gate that is the only thing CI's keys may run, and one Caddy snippet that publishes only the search endpoints. Pages, redirects and state stay on Cloudflare. Rules: `spec/edge-and-hosting.md` (VM search) and `spec/search.md` (Keys). Decided in `.scratch/wso2-docs-bundles/issues/06-vm-hosting-spec.md`, as amended.

| File | Installed as | |
|---|---|---|
| `setup.sh` | run from a copy of this folder | `check` verifies the VM, then reports drift; `apply` installs or updates everything. Safe to run again. |
| `docs-platform-gate` | `/usr/local/sbin/docs-platform-gate` (root, 755) | The gate key's forced command. Verbs, whole-string allow-listed, one at a time under `flock`: `search-index <space>/<segment>=<release> ...`, `search-check`, `search-check --fix`, `search-key`, `search-key --expires <YYYY-MM-DD>`, `status`. |
| `typesense/compose.yaml` | `/opt/docs-platform/typesense/compose.yaml` | Typesense 30.2 (pinned multi-arch digest, arm64 and amd64) as compose project `docs-platform-typesense` on `127.0.0.1:8109`, 4 GB memory limit. |
| `search-via-gate.sh` | not installed: CI runs it | Exports a release's search files from the bucket, uploads them with the upload key, runs the gate with the gate key. |

## Layout on the VM

```
/etc/docs-platform/gate.conf                  gate settings (root, 644)
/etc/docs-platform/typesense.env              TYPESENSE_ADMIN_KEY and TYPESENSE_SEARCH_PARENT_KEY (root:docs-platform 640),
                                              made on the VM, never printed or copied off it
/etc/docs-platform/hosting.conf               what apply was given: host, CORS origin, Platform repo and tag
/srv/docs-platform/search/incoming/           what CI uploads (the upload key, rrsync -wo -no-del), laid out as the bucket:
                                              _platform/state.json, _platform/composed.json,
                                              _releases/<space>/<segment>/<release>/_platform/{edition,search-records,pages}.json
/opt/docs-platform/<tag>/                     a Platform release (root-owned), with its runtime dependencies
/opt/docs-platform/current -> <tag>           what the gate runs: bin/wso2-release.mjs
/opt/docs-platform/node -> node-v22.23.4-linux-arm64   Node 22 from nodejs.org, sha256 pinned in setup.sh
/etc/ssh/authorized_keys/docs-platform        the two deploy keys with their forced commands (root, 644)
/etc/ssh/sshd_config.d/61-docs-platform.conf  Match User docs-platform: that keys file, no forwarding, no TTY, no password
/etc/caddy/docs-platform.caddy                https://<host>/_typesense/* -> 127.0.0.1:8109, search endpoints only;
                                              imported once from /etc/caddy/Caddyfile
```

User `docs-platform` has no sudo, no password and `/bin/sh`. Nothing under `/srv/docs`, user `deploy`, port 8108 or wso2-docs-site's Caddy site blocks is touched. The snippet's site address has a path (`<host>/_typesense/*`), so Caddy routes `/_typesense/` there first and leaves every other route of the same host as it was; Caddy logs that a path in a site address is deprecated, which is expected.

Browsers and the Edge Worker reach only `GET /collections/<c>/documents/search`, `POST /multi_search` and `GET /health` at `https://141-148-145-173.sslip.io/_typesense/`, with CORS for `https://wso2-docs-site.tharinduj.workers.dev`. Everything else there answers 404.

## Run it

You need: SSH to the VM as `ubuntu` with sudo (the 2026-10-20 key), a Platform release tag that includes this kit in `tharindulak/test-docs-platform` (public, so the VM clones it without a token), and `gh` signed in as an admin of the repo that runs `release.yml` for staging.

1. Make the two deploy keys on your computer, outside any repo:

   ```sh
   mkdir -m 700 docs-platform-keys && cd docs-platform-keys
   ssh-keygen -t ed25519 -N '' -C docs-platform-search-upload -f search-upload
   ssh-keygen -t ed25519 -N '' -C docs-platform-search-gate -f search-gate
   ```

2. Copy the kit and the two public halves to the VM:

   ```sh
   VM=ubuntu@141.148.145.173
   rsync -rp hosting/vm/ "$VM:docs-platform-vm/"
   ssh "$VM" 'mkdir -p docs-platform-keys'
   scp docs-platform-keys/search-upload.pub docs-platform-keys/search-gate.pub "$VM:docs-platform-keys/"
   ```

3. Check the VM. Every line must be `ok`; a `FAIL` stops `apply` before it changes anything:

   ```sh
   ssh "$VM" 'sudo docs-platform-vm/setup.sh check'
   ```

   If root login is not off, set `PermitRootLogin no` in `/etc/ssh/sshd_config` (after making sure `ubuntu` can still sudo), then `sudo systemctl reload ssh`.

4. Apply:

   ```sh
   ssh "$VM" 'sudo docs-platform-vm/setup.sh apply --keys docs-platform-keys --host 141-148-145-173.sslip.io --platform-ref <tag> --platform-repo tharindulak/test-docs-platform'
   ```

   Use a full release tag (`v1.3.0`), not the moving major tag (`v1`): a tag already installed under `/opt/docs-platform/` is not fetched again. It backs up `/etc/caddy/Caddyfile` to `Caddyfile.docs-platform-<time>.bak` before adding the import line, runs `caddy validate`, and restores the backup instead of reloading when validation fails. The Platform install (`npm ci --omit=dev --ignore-scripts`) takes a few minutes.

5. Check again. Every line must be `ok`, with no `DRIFT`:

   ```sh
   ssh "$VM" 'sudo docs-platform-vm/setup.sh check'
   ```

6. Pin the VM's SSH host key for CI. Compare the fingerprint `ssh-keyscan` prints with the one the VM itself reports:

   ```sh
   ssh-keyscan -t ed25519 141.148.145.173 > known_hosts && ssh-keygen -lf known_hosts
   ssh "$VM" 'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub'
   ```

7. Store the four secrets in the `staging` environment of the repo that runs `release.yml` (`tharindulak/test-docs-platform` for the fork; `tharindulak/test-docs-platform` per the ticket):

   ```sh
   REPO=tharindulak/test-docs-platform
   gh secret set DOCS_SEARCH_HOST --env staging --repo "$REPO" --body 141.148.145.173
   gh secret set DOCS_SEARCH_KNOWN_HOSTS --env staging --repo "$REPO" < known_hosts
   gh secret set DOCS_SEARCH_UPLOAD_KEY --env staging --repo "$REPO" < docs-platform-keys/search-upload
   gh secret set DOCS_SEARCH_GATE_KEY --env staging --repo "$REPO" < docs-platform-keys/search-gate
   ```

8. Make the browser key and give it to builds, then a separate, expiring key for the Edge Worker. The gate prints only the scoped key, never the keys it holds:

   ```sh
   ssh -i docs-platform-keys/search-gate -o IdentitiesOnly=yes docs-platform@141.148.145.173 search-key > search-key.txt
   gh variable set SEARCH_KEY_STAGING --repo "$REPO" < search-key.txt
   ssh -i docs-platform-keys/search-gate -o IdentitiesOnly=yes docs-platform@141.148.145.173 search-key --expires 2027-10-31 \
     | npx wrangler secret put TYPESENSE_SEARCH_KEY -c worker/wrangler.jsonc --env staging
   ```

   Then rebuild every staging Docs deployment so pages carry the key, and index them: run **Actions** > **Search consistency** > **Run workflow** with **fix** on.

9. Delete the private halves from your computer (`docs-platform-keys/search-upload`, `docs-platform-keys/search-gate`) once the secrets are set. To change a key later, make a new pair and repeat steps 2, 4 and 7.

## Verify

- `curl -s https://141-148-145-173.sslip.io/_typesense/health` answers `{"ok":true}`; `curl -s -o /dev/null -w '%{http_code}' https://141-148-145-173.sslip.io/_typesense/keys` answers `404`.
- `ssh -i docs-platform-keys/search-gate docs-platform@141.148.145.173 status` prints `typesense=ok` and the Platform tag.
- `ssh -i docs-platform-keys/search-gate docs-platform@141.148.145.173 'search-index x; id'` is refused.
- The **Search consistency** run's summary shows `"ok": true`; the search box on `https://wso2-docs-site.tharinduj.workers.dev/` finds pages.

## Change the Platform release the gate runs

```sh
ssh "$VM" 'sudo docs-platform-vm/setup.sh apply --platform-ref <new tag>'
```

The host, CORS origin, repo and keys stay as they were (`/etc/docs-platform/hosting.conf`). The older release folder stays under `/opt/docs-platform/` for going back.

## Tests

`test/vm-search.test.mjs`: shellcheck when installed, the Caddy snippet (adapted by `caddy` when `CADDY` names a binary), the compose file, and the gate's allow-list and verbs against a temporary folder and a stand-in Typesense (it needs `flock`, so Linux; skipped elsewhere).
