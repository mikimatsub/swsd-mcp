---
title: Deployment
description: Self-host swsd-mcp via Docker, Azure Container Apps, or any container platform.
---

The [Quick start](/quickstart/) covers `npx`-based local stdio installs — one user, one machine, the right answer for individual use.

**Self-hosting in HTTP mode** is required for two scenarios:

1. **[Microsoft Copilot Studio](#microsoft-copilot-studio)** — Copilot Studio can't spawn local processes, so it needs a hosted HTTP endpoint
2. **Shared team instance** — one deploy, many users, each providing their own SWSD token per request

This page covers Docker (works anywhere) and a complete Azure Container Apps walkthrough (the recommended path for Copilot Studio integration).

## Docker

The published image at `ghcr.io/mikimatsub/swsd-mcp:latest` runs on any container platform.

### Quick smoke test

bash / zsh / Git Bash:

```bash
docker run --rm -d \
  --name swsd-mcp \
  -p 3000:3000 \
  -e SWSD_TRANSPORT=http \
  -e SWSD_TRUST_PROXY=1 \
  -e SWSD_BASE_URL=https://api.samanage.com \
  ghcr.io/mikimatsub/swsd-mcp:latest

# Verify
curl http://localhost:3000/healthz
# Expect: {"ok":true}
```

PowerShell (Windows):

```powershell
docker run --rm -d `
  --name swsd-mcp `
  -p 3000:3000 `
  -e SWSD_TRANSPORT=http `
  -e SWSD_TRUST_PROXY=1 `
  -e SWSD_BASE_URL=https://api.samanage.com `
  ghcr.io/mikimatsub/swsd-mcp:latest

# Verify
curl http://localhost:3000/healthz
# Expect: {"ok":true}
```

The `/mcp` endpoint accepts MCP requests with the user's token in the `Authorization: Bearer <token>` or `X-SWSD-Token: <token>` header (per-request, not configured server-side).

### Image properties

- **Base**: `node:24-alpine`, pinned by SHA256 digest for supply-chain safety
- **Multi-stage build**: dev dependencies dropped from runtime layer
- **Non-root user**: runs as `node` (UID 1000)
- **HEALTHCHECK** baked in: `node -e "fetch('/healthz')..."` every 30s

Image tags:

- `:latest` — the latest main-branch commit
- `:sha-XXXXXXX` — pinned to a specific commit (recommended for production)

Browse all tags at [GitHub Packages](https://github.com/mikimatsub/swsd-mcp/pkgs/container/swsd-mcp).

---

## Azure Container Apps

The recommended path for Microsoft Copilot Studio integration. Same Microsoft ecosystem (auth, networking, identity all integrate cleanly), scale-to-zero pricing, public HTTPS endpoint with auto-managed TLS, no Kubernetes complexity.

Typical cost for a single team's usage: **$0–5/month**.

### Prerequisites

- An **Azure subscription** ([free tier available](https://azure.microsoft.com/free/))
- **Azure CLI** installed locally — verify with `az --version`. [Install instructions](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli).
- A SolarWinds Service Desk **admin token** for verification (each end user will use their own; this is just for the smoke test)

### Step 1: Login to Azure

```bash
az login
```

Browser opens, you authenticate, terminal confirms.

### Step 2: Create a resource group

```bash
az group create \
  --name swsd-mcp-rg \
  --location eastus
```

Other location options: `westus2`, `westeurope`, `northeurope`, `southeastasia`. See `az account list-locations -o table` for the full list.

### Step 3: Create a Container Apps environment

```bash
az containerapp env create \
  --name swsd-mcp-env \
  --resource-group swsd-mcp-rg \
  --location eastus
```

This takes ~3 minutes.

### Step 4: Deploy the swsd-mcp container

```bash
az containerapp create \
  --name swsd-mcp \
  --resource-group swsd-mcp-rg \
  --environment swsd-mcp-env \
  --image ghcr.io/mikimatsub/swsd-mcp:latest \
  --target-port 3000 \
  --ingress external \
  --env-vars \
    SWSD_TRANSPORT=http \
    SWSD_BASE_URL=https://api.samanage.com \
    SWSD_TRUST_PROXY=1 \
    SWSD_PROFILE=operations \
    SWSD_WRITE_MODE=live \
    SWSD_RATE_LIMIT_MAX=200 \
  --min-replicas 0 \
  --max-replicas 3 \
  --cpu 0.25 \
  --memory 0.5Gi
```

Key flags:

| Flag | What it does |
|---|---|
| `--target-port 3000` | The container's internal listen port (matches the Dockerfile's EXPOSE) |
| `--ingress external` | Accept traffic from the public internet (required for Copilot Studio) |
| `SWSD_TRUST_PROXY=1` | Tell Express to trust Container Apps' reverse proxy so `req.ip` shows the real client (rate-limit accuracy) |
| `SWSD_PROFILE=operations` | Register the 64-tool ITSM operations profile; use `full` only when the deployment also needs every KB write tool |
| `SWSD_WRITE_MODE=live` | Allow writes. Use `dry-run` for payload previews or `disabled` for read-only hosted deployments |
| `SWSD_RATE_LIMIT_MAX=200` | Slightly higher than default since this is a shared instance |
| `--min-replicas 0` | Scale to zero when idle (the magic that makes this nearly free) |
| `--max-replicas 3` | Cap concurrent instances to control cost spikes |
| `--cpu 0.25 --memory 0.5Gi` | Right-sized for low/medium traffic |

This takes ~2 minutes.

### Step 5: Get the public URL

```bash
az containerapp show \
  --name swsd-mcp \
  --resource-group swsd-mcp-rg \
  --query properties.configuration.ingress.fqdn \
  --output tsv
```

Outputs something like `swsd-mcp.bluepebble-12345abc.eastus.azurecontainerapps.io`. Save this — you'll need it for Copilot Studio in the next step.

### Step 6: Verify

```bash
curl https://YOUR_FQDN/healthz
# Expect: {"ok":true}

# Test that /mcp rejects unauthenticated requests
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  https://YOUR_FQDN/mcp
# Expect: 401 with "Missing token..." message
```

If both responses match, the deployment is healthy.

### Cost monitoring

Azure Container Apps charges for vCPU-seconds and memory-GiB-seconds when active, plus a small per-request fee. With `min-replicas 0`, idle time is free.

| Usage pattern | Approximate cost |
|---|---|
| Personal testing (10s of requests/day) | $0–1/month |
| Small team (100s of requests/day) | $1–5/month |
| Active team (1000s of requests/day) | $5–20/month |
| Large org (10,000+ requests/day) | $20–100+/month |

Monitor via Azure Portal → Cost Management. Free tier credits often cover this entirely for the first year.

### Updating to a new version

The Container App auto-pulls the new `:latest` image on the next cold start. To force an immediate update:

```bash
az containerapp update \
  --name swsd-mcp \
  --resource-group swsd-mcp-rg \
  --image ghcr.io/mikimatsub/swsd-mcp:latest
```

Or pin to a specific version:

```bash
az containerapp update \
  --name swsd-mcp \
  --resource-group swsd-mcp-rg \
  --image ghcr.io/mikimatsub/swsd-mcp:sha-XXXXXXX
```

### Tearing down

```bash
# Delete just the container app (keeps the environment)
az containerapp delete --name swsd-mcp --resource-group swsd-mcp-rg --yes

# Or delete everything in the resource group
az group delete --name swsd-mcp-rg --yes --no-wait
```

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `curl /healthz` hangs | Container starting up (cold start) | Wait 30–60 seconds, retry. Cold starts are normal with `min-replicas 0`. |
| `404` from `/healthz` | Wrong FQDN, or container failed to start | `az containerapp logs show --name swsd-mcp --resource-group swsd-mcp-rg --follow` |
| `403` from `/mcp` | `SWSD_ALLOWED_ORIGINS` is set and rejecting your origin | Either remove the env var (safe behind Container Apps' ingress) or add the calling origin to the allowlist |
| Token forwarded but SWSD returns 401 | Token expired or invalid | Generate a fresh token in SWSD UI |

### Hardening for production

The recipe above is suitable for team use within a trusted network. For broader exposure:

- **Azure AD authentication** at the Container Apps level (Easy Auth) — restrict who can even reach `/mcp` before the SWSD token check
- **VNet integration + private endpoints** — bring the endpoint inside your corporate network
- **IP allowlisting** via Container Apps ingress restrictions — limit to known office/VPN IPs
- **Custom domain + your own TLS certificate** — looks more polished, allows custom DNS-rebinding-prevention

Each of these adds operational complexity in exchange for security.

---

## Microsoft Copilot Studio

After deploying the HTTP server (above), you import a Swagger 2.0 connector spec into Copilot Studio.

Per-profile Swagger files live in [`copilot-studio/`](https://github.com/mikimatsub/swsd-mcp/tree/main/copilot-studio) on GitHub:

- `triage.swagger.yaml` (14 tools)
- `agent.swagger.yaml` (37 tools, default)
- `knowledge.swagger.yaml` (15 tools)
- `operations.swagger.yaml` (64 tools)
- `full.swagger.yaml` (66 tools)

### Import steps

1. Pick the file matching your `SWSD_PROFILE` (`operations.swagger.yaml` for the deployment example above). Edit the `host:` line:
   ```yaml
   host: REPLACE_WITH_YOUR_HOST.example.com
   ```
   to your deployed FQDN (no `https://` prefix):
   ```yaml
   host: swsd-mcp.bluepebble-12345abc.eastus.azurecontainerapps.io
   ```
2. In Copilot Studio: **Add a tool → Custom connector → New connector → Import from OpenAPI file**
3. Wizard authentication settings:
   - **Authentication type**: API Key
   - **Parameter label**: `SWSD API Token` (or anything user-friendly)
   - **Parameter name**: `X-SWSD-Token` _(must match exactly)_
   - **Parameter location**: Header
4. Save the connector

### Test the connection

In Copilot Studio's connector test pane:

1. Click **Test → New connection**
2. Paste a valid SWSD API token
3. Click **Test operation** on `InvokeMCP`
4. Provide a minimal MCP JSON-RPC body for `tools/list`:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 1
}
```

Successful response: a JSON-RPC object with the tools array containing the entries for your selected profile.

### Notes

- `x-ms-agentic-protocol: mcp-streamable-1.0` is the Microsoft extension declaring the endpoint speaks MCP over Streamable HTTP — already present in the bundled Swagger files.
- Copilot Studio dropped MCP-over-SSE support in August 2025; only Streamable HTTP is supported, which is what these connectors declare.

---

## Other platforms

The Docker image runs anywhere — AWS App Runner, GCP Cloud Run, Render, Fly.io, your own VM. Concrete recipes for those platforms are not yet written; PRs welcome.
