# Deployment

How a commit becomes a running service, and what each step is allowed to do on
its own.

The rule the whole pipeline is built around: **publishing an artefact is
automatic, deciding what the world talks to is not.** Building images on every
green commit is harmless. Moving the enclave changes its measurement, and a
measurement that changes without a decision somebody can be held to is exactly
what the attestation exists to rule out.

## The shape of it

```
push to main
   │
   ├─ frontend ─┐
   ├─ backend  ─┼─ all three must pass
   └─ contracts ┘
                │
                ├─ has anything changed?
                │     ├─ frontend/ ............... → publish the frontend (4EVERLAND)
                │     └─ what enters the image ... → publish the backend image (GHCR)
                │                                        │
                │                                        └─ AUTO_DEPLOY says:
                │                                              none   → stop
                │                                              heroku → deploy to heroku ─┐
                │                                              phala  → deploy to phala ──┤
                │                                                                         └─ dns follows
                │
                └─ (pull requests stop here: checked, never published)
```

Manual entry points, at any time, for any published version:

- **deploy heroku** — `.github/workflows/deploy-heroku.yml`
- **deploy phala** — `.github/workflows/deploy-phala.yml`

## Where things run

| | Host | Hostname | Carries the attestation |
|---|---|---|---|
| Frontend | 4EVERLAND / IPFS | `votain.app` | — |
| Backend | Heroku container dyno *or* Phala Intel TDX enclave | `api.votain.app` | Phala only |
| Chain | local Hardhat through a named Cloudflare tunnel | `rpc.votain.app` | — |

`api.votain.app` is the switch. The frontend bakes that URL at build time and
never learns which host answers it, so moving between Heroku and Phala is a DNS
change and nothing else. Phala costs $42.34/month against $20 of credit, so it
is stopped between sessions and Heroku carries the service meanwhile.

## The workflows

### `checks.yml`

Runs on every push to `main` and every pull request into it. Three test jobs —
`frontend`, `backend`, `contracts` — each running the module exactly as it is
run locally. A CI that runs different commands is a CI that goes green while
the repository is broken for whoever clones it.

Everything that publishes anything is downstream of all three.

### Change detection

The job `has the backend changed` decides whether there is anything to publish.
The two halves use **different baselines**, and the difference is not an
oversight:

| | Baseline | Paths |
|---|---|---|
| Backend image | the newest `backend-v*` tag | only what the Dockerfile copies |
| Frontend | the previous tip of `main` (`github.event.before`) | all of `frontend/` |

The backend leaves a mark: every published image creates a tag, so the question
can be asked precisely — *has the backend changed since the last image?* — and
it survives a push of several commits, a re-run and a force push, all of which
defeat a `HEAD~1` comparison.

The frontend leaves no mark. 4EVERLAND builds from the branch and answers with
a task id, not a version, so there is no `frontend-v*` to compare against. When
the baseline is unusable — a force push, a newly created branch — it publishes
anyway. Rebuilding a static site needlessly costs nothing; skipping a real
change leaves `votain.app` stale, which is the failure nobody notices until
somebody reports a bug that was fixed a week earlier.

Before this existed, the first three automatic versions were `0.1.1`, `0.1.2`
and `0.1.3`, for commits that changed a workflow and a markdown file.

### `backend-image.yml`

Builds the issuer image, publishes it to GHCR and attests it. Called by
`checks.yml`, or run by hand, or fired by pushing a `backend-v*` tag.

**The version grows by itself.** The patch is bumped from the highest
`backend-v*` tag, and the new tag is pushed back so every digest traces to a
commit somebody can read. A version can also be named explicitly, for a minor
or major bump that no rule can guess.

**No version is ever reused.** A digest pinned in the compose is only immutable
if the tag beside it stays put, so the job refuses to overwrite a tag that
exists. The flow this replaced republished `0.1.0` on every run.

**There is no seed tag, deliberately.** Pushing `backend-v0.1.0` by hand would
fire the tag trigger and republish `0.1.0`, moving the registry tag away from
the digest the enclave was attested on. Instead the sequence starts from the
version the compose pins, which is by definition what is deployed.

### `deploy-heroku.yml`

Takes a version, or defaults to the newest tag. Checks out that tag and
rebuilds, because Heroku's registry rejects OCI manifests and the attested GHCR
image is one. **The Heroku image therefore has a different digest and carries no
attestation**, which is the honest shape of the two deployments rather than
something to smooth over.

It distinguishes a release from a no-op. `heroku container:release` exits 0
either way; when the image is byte-identical to the running one it creates no
release and says so only in a warning. The summary reports which of the two
happened, and prints the release number before and after.

### `deploy-phala.yml`

Takes a version, or defaults to the newest tag, and then:

1. resolves the digest from the registry rather than trusting one typed by hand;
2. **verifies the provenance before the enclave sees it** — asking afterwards is
   asking too late;
3. pins that digest in `docker-compose.yml` and commits it back, because the
   file an outsider verifies has to match what is running;
4. hands the compose to Phala with the production environment;
5. waits for the CVM to report `running`, then checks what it is actually
   running.

**It asks the enclave, not the domain.** An earlier version ended by curling
`https://api.votain.app/health` and treating a 200 as success. That is worthless
here: the domain points wherever DNS says, and with the CVM off it points at
Heroku, so the check would have passed on a deployment that never reached the
enclave. Phala reports `docker_compose_hash`, the sha256 of the compose it was
given:

```bash
sha256sum docker-compose.yml
```

**The same compose has two legitimate hashes**, and this cost a failed run to
learn. `phala deploy --compose <file>` sends the file as it is, trailing newline
included. The dashboard takes the compose in a textarea, and a textarea eats the
final newline. So a CVM first provisioned through the web UI reports the hash of
the file *without* its last byte, and one deployed by the CLI reports it *with*.
One byte, nothing about what runs, so the job accepts either.

```bash
sha256sum docker-compose.yml                          # deployed by the CLI
printf '%s' "$(cat docker-compose.yml)" | sha256sum   # via the dashboard
```

The job fails unless the CVM reports one of the two. It answers the only
question worth asking — does the enclave run what a reader of this repository
can see? — and says nothing about who happens to answer a hostname.

## Secrets and variables

Repository secrets:

| Secret | Used by | What it is |
|---|---|---|
| `FOUREVERLAND_DEPLOY_HOOK` | `checks.yml` | the URL that triggers a frontend build. **The URL is the credential** |
| `HEROKU_API_KEY` | `deploy-heroku.yml` | Heroku API key; also the registry password |
| `PHALA_CLOUD_API_KEY` | `deploy-phala.yml` | Phala Cloud API key |
| `PHALA_ENV` | `deploy-phala.yml` | the whole production env file, 25 variables |
| `CLOUDFLARE_API_TOKEN` | `dns.yml` | scoped to Zone:DNS:Edit on `votain.app` only |

`PHALA_ENV` is not optional and the workflow refuses to start without it. The
enclave's environment is sealed to the deployment; an update that supplies none
can leave the backend without the keys it signs credentials with —
`ISSUER_PRIVATE_KEY`, `ELIGIBILITY_ATTESTER_PRIVATE_KEY`, `ENROLMENT_TAG_KEYS`.

**It is a copy.** Rotating a key means updating the secret *and* the file in
OneDrive. Two places, and nothing checks that they agree.

Repository variables:

| Variable | Values | Effect |
|---|---|---|
| `AUTO_DEPLOY` | unset / `none` / `heroku` / `phala` | what follows a green commit that produced a new image |

A variable rather than a secret, because which deployment is automatic is not
confidential and anyone reading a run should be able to see it without
permission to read secrets.

## The 4EVERLAND deploy hook answers GET

Every other deploy hook — Vercel, Netlify, Render — is a POST. 4EVERLAND's
answers `503 {"code":500,"message":"SERVICE ERROR"}` to a POST, which reads as
"their service is down" or "your hook is dead" and is neither. The same URL
succeeds as a GET and returns a queued task id.

The step checks the `code` in the body as well as the HTTP status, because this
API reports failure inside a 200.

## DNS follows the deployment

Both backends answer `api.votain.app`, so switching between them is a DNS
change and nothing else. `dns.yml` makes that change part of the deployment
instead of something to remember afterwards, and it is called by both deploy
workflows.

**It only acts on a real switch.** It reads the current CNAME, works out which
host it names, and if that is already the target it changes nothing. Rewriting
the same records on every redeploy would be churn with a blast radius: each
write is a chance to break resolution for a service that was working, and TLS
issuance rides on two of these records.

**The two sets are not symmetric.**

| | Records | Proxied |
|---|---|---|
| `heroku` | one CNAME to the app's `herokudns.com` target | yes |
| `phala` | CNAME to the dstack gateway, CAA, and `_dstack-app-address` TXT | yes |

Switching to Heroku **removes** the CAA and the TXT. Left in place, the CAA
authorises only the enclave's Let's Encrypt account over DNS-01, and Heroku's
ACM could not issue a certificate for a name it now serves. Switching to Phala
writes all three: the CAA authorises the ingress's ACME account, and the TXT
tells the dstack gateway which app and port to route to. The CNAME alone
resolves to a gateway that will not answer for this name.

Both CNAMEs are proxied. `dstack-ingress` wrote its own record unproxied, and
that is how the enclave was first verified, so this is a deliberate departure.
Nothing about the proxy should trouble it: DNS-01 validation runs on a TXT
record, which is never proxied, and the origin already serves a certificate
valid for this name, so Cloudflare reaches it over TLS like any other origin.
If the ingress ever fails to renew a certificate, this is the first thing to
suspect, and it is one boolean in `dns.yml`.

`force: true` rewrites the records even when they already name the right host.
The guard compares hosts, so it cannot see that a record's *shape* should
change -- proxied or not, a different TTL -- while the host stays the same.
Without it, changing one boolean would mean switching away and back, which
costs downtime and a certificate reissue.

**The ingress does not restore these.** Measured, by deleting the records and
restarting the CVM and waiting five minutes for nothing: `dstack-ingress`
writes its DNS records only on FIRST provisioning. That is why they are kept in
this workflow rather than trusted to reappear, with a copy in
`OneDrive/UNI/4/TFG/.env/produccion/dns-api-votain-app.json`.

**The one we left is turned off, last.** Paying for two backends to answer the
same hostname is waste, and the one nobody is watching is the one that quietly
runs up a bill. So a real switch ends by stopping the previous host -- the
Heroku dyno scaled to 0, or the CVM stopped.

Neither is deleted, and for Phala that distinction is the deployment. Deleting a
CVM destroys the sealed environment with it: the keys the issuer signs
credentials with are encrypted to that instance and do not come back. A stopped
CVM keeps its disk, its identity and its measurement, and starts again in about
a minute.

It happens only after the replacement has been seen to **answer**, not merely to
resolve. A CNAME can be correct in the zone while the world still reaches the
old host from cache. The check reads the reply and knows who sent it: Heroku's
router stamps `via: 1.1 heroku-router` on every response and the enclave's
ingress stamps nothing, so "the record says Phala" and "Phala answered" stay
different claims. If the new host never answers, nothing is turned off and the
run fails with the old one still serving.

Each deploy workflow therefore brings its own host up before it serves:
`deploy-heroku.yml` scales the dyno back to 1, and `deploy-phala.yml` starts the
CVM and waits for it. Without that, the first switch back would release
successfully onto nothing.

The Heroku workflow checks `/health` in a separate job **after** the switch. Run
before it, that check would be interrogating whichever host DNS happened to
name, and a 200 from the enclave would say nothing about the release that just
went out.

## Verifying it from outside

Nothing here asks to be trusted. Both links can be checked by anyone:

```bash
# The image came from this repository, built by this workflow, from this commit.
gh attestation verify \
  oci://ghcr.io/codeinia/votain-backend:<version> --repo CodeInIA/votain

# The enclave runs the compose in this repository.
# Either hash is valid: with the trailing newline if the CLI deployed it,
# without it if the CVM was provisioned through the dashboard.
sha256sum docker-compose.yml
printf '%s' "$(cat docker-compose.yml)" | sha256sum
phala cvms get --cvm-id <app-id> --json | jq -r '.docker_compose_hash'
```

The chain, with no link that asks for trust:

```
public commit → public build log → signed provenance → image digest
              → compose pinning that digest → TEE attestation of that compose
```

Heroku is outside this chain by construction, and the README says so. It is the
deployment that stays up cheaply; Phala is the one that carries the argument.
