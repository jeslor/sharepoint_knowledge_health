# CI/CD — GitHub Actions → Azure Container Apps

How this repository is validated and deployed. Complements `deployment.md`
(target infra + env vars) and ADR-0009 (three independently-deployable apps).

## 1. Architecture

Two workflows:

- **`.github/workflows/ci.yml`** — validation. Runs on every **pull request**,
  and is **reusable** (`workflow_call`) so the deploy workflow runs the exact
  same gates. Steps (unchanged from the pre-existing CI): install → generate
  Prisma client → `migrate:deploy` against an ephemeral Postgres service
  container → lint → typecheck → test. **No Azure credentials, no production
  secrets, no deploy.**
- **`.github/workflows/deploy.yml`** — production deploy. Runs on **push to
  `main`**. Jobs are strictly ordered via `needs`:

  ```
  validate (reuses ci.yml)
    → build-and-push  (3 images to ACR, tagged with the commit SHA)
      → migrate       (prisma migrate deploy, once, against Neon)
        → deploy      (az containerapp update → new revision per app)
  ```

  Migrations run **before** any new app revision is activated. Migrations
  **never** run on container boot.

Deployment target (unchanged): Azure Container Apps (web/api/worker in one
environment) + ACR + **Neon** Postgres + **Upstash** Redis + Entra ID/Graph +
Key Vault. No Kubernetes, no Bicep/Terraform.

## 2. Required Azure resources (create once, manually)

- Resource group.
- **Azure Container Registry** (Basic is fine).
- **Container Apps environment** + three apps: `web`, `api`, `worker`.
- **Key Vault** holding the three runtime secrets (see §4/§6).
- A **user-assigned managed identity** (or the apps' system-assigned identities)
  with **Key Vault `get` secret** permission, used by the apps to resolve
  Key Vault secret references.
- An **Entra app registration for GitHub OIDC** (the deploy identity) with a
  **federated credential** for this repo/branch and RBAC (see §5).

Neon and Upstash are provisioned in their own consoles; you only need their
connection strings.

## 3. Required GitHub repository *variables* (non-secret) — `Settings → Variables`

| Variable | Example | Used by |
|---|---|---|
| `ACR_NAME` | `sphpilotacr` | build + deploy |
| `AZURE_RESOURCE_GROUP` | `sph-pilot-rg` | deploy |
| `ACA_API_APP` | `sph-api` | deploy |
| `ACA_WORKER_APP` | `sph-worker` | deploy |
| `ACA_WEB_APP` | `sph-web` | deploy |
| `WEB_APP_ORIGIN` | `https://web.<env>.azurecontainerapps.io` | API CORS (runtime) |
| `NEXT_PUBLIC_API_BASE_URL` | `https://api.<env>.azurecontainerapps.io` | web **build** |
| `NEXT_PUBLIC_ENTRA_CLIENT_ID` | `<app-reg client id>` | web **build** |
| `NEXT_PUBLIC_REDIRECT_URI` | `https://web.<env>.azurecontainerapps.io` | web **build** |
| `NEXT_PUBLIC_ADMIN_CONSENT_REDIRECT_URI` | `https://web.<env>.azurecontainerapps.io/connect/admin-consent-callback` | web **build** |

These are public config, safe as plaintext variables. The `NEXT_PUBLIC_*` are
**build-time** (see §11).

## 4. Required GitHub *secrets* — `Settings → Secrets`

Kept to the minimum:

| Secret | Why |
|---|---|
| `AZURE_CLIENT_ID` | OIDC deploy identity (app registration) |
| `AZURE_TENANT_ID` | OIDC |
| `AZURE_SUBSCRIPTION_ID` | OIDC |
| `DATABASE_URL` | **only** the migration step uses it — Neon prod URL |

`REDIS_URL` and `ENTRA_CLIENT_SECRET` are **NOT** in GitHub — they live only in
Key Vault / Container Apps secrets and are never needed by the pipeline. (If you
prefer `DATABASE_URL` never touch GitHub either, run migrations via a temporary
Container Apps Job that reads it from Key Vault instead of the runner step —
documented as an alternative in §8.)

## 5. Azure OIDC (federated) setup — no long-lived Azure secret

1. Create/choose the Entra **app registration** used as the deploy identity.
2. Add a **federated credential**: entity = *Branch*, repo = `<org>/<repo>`,
   branch = `main` (subject `repo:<org>/<repo>:ref:refs/heads/main`), audience
   `api://AzureADTokenExchange`.
3. RBAC on the resource group (least privilege): **AcrPush** on the registry
   (for `az acr build`) and **Container Apps Contributor** (to update apps).
4. Put the app's client/tenant/subscription ids into the GitHub secrets in §4.
   `azure/login@v2` + `permissions: id-token: write` then authenticates with no
   stored secret.

## 6. First-time deployment (manual, once per environment)

Store secrets in Key Vault, then create the apps. Runtime secrets are wired as
Container Apps secrets that reference Key Vault (via the managed identity), so
the pipeline never handles them.

```bash
RG=sph-pilot-rg; ENV=sph-pilot-env; ACR=sphpilotacr; KV=sph-pilot-kv
MI=$(az identity show -g $RG -n sph-pilot-mi --query id -o tsv)   # user-assigned MI with KV get

# Key Vault secrets
az keyvault secret set --vault-name $KV --name database-url    --value "<neon prod url>"
az keyvault secret set --vault-name $KV --name redis-url       --value "<upstash url>"
az keyvault secret set --vault-name $KV --name entra-secret    --value "<entra client secret>"

# --- API: external ingress :3001, min 1, KV-backed secrets + runtime env ---
az containerapp create -n sph-api -g $RG --environment $ENV \
  --image $ACR.azurecr.io/sph-api:bootstrap \
  --ingress external --target-port 3001 --min-replicas 1 --max-replicas 3 \
  --cpu 0.25 --memory 0.5Gi --user-assigned $MI \
  --secrets database-url=keyvaultref:https://$KV.vault.azure.net/secrets/database-url,identityref:$MI \
            redis-url=keyvaultref:https://$KV.vault.azure.net/secrets/redis-url,identityref:$MI \
            entra-secret=keyvaultref:https://$KV.vault.azure.net/secrets/entra-secret,identityref:$MI \
  --env-vars NODE_ENV=production WEB_APP_ORIGIN=https://<web-host> \
             ENTRA_CLIENT_ID=<client-id> \
             DATABASE_URL=secretref:database-url REDIS_URL=secretref:redis-url \
             ENTRA_CLIENT_SECRET=secretref:entra-secret

# --- Worker: NO ingress, min 1 (in-process BullMQ scheduler), same secrets ---
az containerapp create -n sph-worker -g $RG --environment $ENV \
  --image $ACR.azurecr.io/sph-worker:bootstrap \
  --ingress disabled --min-replicas 1 --max-replicas 2 \
  --cpu 0.5 --memory 1.0Gi --user-assigned $MI \
  --secrets database-url=keyvaultref:https://$KV.vault.azure.net/secrets/database-url,identityref:$MI \
            redis-url=keyvaultref:https://$KV.vault.azure.net/secrets/redis-url,identityref:$MI \
            entra-secret=keyvaultref:https://$KV.vault.azure.net/secrets/entra-secret,identityref:$MI \
  --env-vars NODE_ENV=production ENTRA_CLIENT_ID=<client-id> \
             DATABASE_URL=secretref:database-url REDIS_URL=secretref:redis-url \
             ENTRA_CLIENT_SECRET=secretref:entra-secret

# --- Web: external ingress :3000, min 1 (NEXT_PUBLIC_* are baked at build) ---
az containerapp create -n sph-web -g $RG --environment $ENV \
  --image $ACR.azurecr.io/sph-web:bootstrap \
  --ingress external --target-port 3000 --min-replicas 1 --max-replicas 3 \
  --cpu 0.25 --memory 0.5Gi --env-vars NODE_ENV=production
```

**API health probes** (liveness `/health`, readiness `/health/ready`) are set on
the API app's template — the CLI `create` flags don't cover HTTP probe paths, so
apply this once with `az containerapp update --yaml api-probes.yaml` (or in the
portal). Probe fragment:

```yaml
# api-probes.yaml (template.containers[0].probes)
probes:
  - type: Liveness
    httpGet: { path: /health, port: 3001 }
    periodSeconds: 30
  - type: Readiness
    httpGet: { path: /health/ready, port: 3001 }
    periodSeconds: 15
    failureThreshold: 3
```

> The bootstrap image tag is a placeholder for the first create; the pipeline
> replaces it with a SHA-tagged image on the next push to `main`.

## 7. Subsequent deployments

Merge/push to **`main`** → `deploy.yml` runs automatically: validate → build 3
SHA-tagged images → migrate → `az containerapp update --image …:<sha>` per app
(each creates a new revision). Nothing manual.

## 8. Database migration process

- `prisma migrate deploy` runs **once per deploy**, from the runner, against the
  Neon prod `DATABASE_URL` (Neon is internet-reachable, so no in-Azure job is
  needed). It is gated to run **after** images are published and **before** app
  rollout (`deploy` `needs: migrate`).
- **No migrate-on-boot**: neither `apps/api` nor `apps/worker` runs migrations at
  startup (`main.ts` only calls `validateEnvOrExit()` + `NestFactory`).
- Migrations are **forward-only** (see §9).
- *Alternative (keeps `DATABASE_URL` out of GitHub):* run migrations as a
  temporary Container Apps Job built from the API image (which contains the
  Prisma CLI + schema) with command `pnpm --filter @sph/database run
  migrate:deploy`, reading `DATABASE_URL` from a Key Vault-backed job secret.
  More moving parts; use if policy forbids DB creds in GitHub.

## 9. Rollback

- Images are **immutable, SHA-tagged**, and the previous image is retained in ACR
  (do not prune aggressively).
- App changes are **revisions** — the prior revision remains available.
- To roll back an app to the previous revision:
  ```bash
  az containerapp revision list -n sph-api -g $RG -o table          # find prior revision
  az containerapp revision activate -n sph-api -g $RG --revision <prior-revision>
  # (or) az containerapp update -n sph-api -g $RG --image <acr>.azurecr.io/sph-api:<prior-sha>
  ```
- **Database:** Prisma migrations are **forward-only** — there is no automatic
  DB rollback. If a migration must be undone, restore Neon to a point-in-time
  before the deploy (Neon branching/PITR) and redeploy the prior image. Design
  migrations to be backward-compatible with the previous app revision so an app
  rollback alone is safe.

## 10. Required Entra configuration (unchanged permission model)

Multi-tenant app registration; **application (app-only)** permissions:
`Files.Read.All`, `Sites.Read.All`, `Sites.ReadWrite.All` (no `Files.ReadWrite.All`).
Two SPA redirect URIs matching `NEXT_PUBLIC_REDIRECT_URI` and
`NEXT_PUBLIC_ADMIN_CONSENT_REDIRECT_URI`. One client secret → Key Vault
(`entra-secret`). `REQUIRED_PERMISSION_VERSION=2` in code, so tenants must
complete the v2 admin consent. **No permission changes are introduced by CI/CD.**

## 11. Web build-time environment variables (important)

`NEXT_PUBLIC_*` are **inlined into the client bundle at build time** by Next.js.
`apps/web/Dockerfile` declares them as build `ARG`s; the deploy workflow passes
them via `az acr build --build-arg` from the repository **variables** in §3.
**Changing a `NEXT_PUBLIC_*` requires rebuilding the web image** — setting a
Container Apps *runtime* env var will **not** change an already-built bundle. The
web container therefore takes no `NEXT_PUBLIC_*` at runtime; only `PORT`/`NODE_ENV`.

## 12. Worker configuration

The worker is a long-running background process with **no HTTP server**
(`createApplicationContext`, ADR-0009) and an **in-process BullMQ repeatable
scheduler** (15-min scan tick + hourly notification sweep). It therefore runs on
Container Apps with **ingress disabled** and **min replicas = 1** — it must not
scale to zero, or the repeatable ticks never fire. **No HTTP health endpoint is
added to satisfy Container Apps** (none is required for a no-ingress app).

## 13. Inspecting deployment logs

```bash
# Pipeline: GitHub → Actions → Deploy run.
# Live app logs:
az containerapp logs show -n sph-api    -g $RG --follow
az containerapp logs show -n sph-worker -g $RG --follow    # scan/scheduler activity
az containerapp logs show -n sph-web    -g $RG --follow
# Revisions / rollout status:
az containerapp revision list -n sph-api -g $RG -o table
```

## 14. Verifying health

```bash
# Liveness (dependency-free):
curl -fsS https://<api-host>/health            # {"status":"ok",...}
# Readiness (checks Postgres + Redis; 503 when degraded):
curl -fsS https://<api-host>/health/ready      # {"status":"ok","checks":{"database":"ok","redis":"ok"}}
```

A `degraded` readiness (503) means the API can't reach Neon or Upstash — check
the Key Vault secret values and that the app's managed identity can read them.
