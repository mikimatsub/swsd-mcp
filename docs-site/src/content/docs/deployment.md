---
title: Deployment
description: Self-host swsd-mcp via Docker, Azure Container Apps, or any container platform.
---

The [Quick start](/quickstart/) covers `npx`-based local stdio installs: one user, one machine, the right answer for individual use.

**Self-hosting in HTTP mode** is required for two scenarios:

1. **[Microsoft Copilot Studio](#microsoft-copilot-studio)**: Copilot Studio can't spawn local processes, so it needs a hosted HTTP endpoint
2. **Shared team instance**: one deploy, many users, each providing their own SWSD token per request

This page covers Docker (works anywhere) and a complete Azure Container Apps walkthrough (the recommended path for Copilot Studio integration).

## Docker

The image is published at `ghcr.io/mikimatsub/swsd-mcp:latest` for compatible container hosts.

### Quick smoke test

bash / zsh / Git Bash:

```bash
docker run --rm -d \
  --name swsd-mcp \
  -p 127.0.0.1:3000:3000 \
  -e SWSD_TRANSPORT=http \
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
  -p 127.0.0.1:3000:3000 `
  -e SWSD_TRANSPORT=http `
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

- `:latest`: the latest main-branch commit
- `:sha-XXXXXXX`: pinned to a specific commit (recommended for production)
- `:X.Y.Z`: a release tag build
- `:X.Y`: the newest release tag build in that minor line

Browse all tags at [GitHub Packages](https://github.com/mikimatsub/swsd-mcp/pkgs/container/swsd-mcp).

---

## Azure Container Apps

The recommended path for Microsoft Copilot Studio integration. It provides managed HTTPS ingress and scaling without managing a Kubernetes cluster.

Costs depend on the Azure plan, region, traffic, and supporting resources. See [Cost monitoring](#cost-monitoring).

### Prerequisites

- An **Azure subscription** ([free tier available](https://azure.microsoft.com/free/))
- **Azure CLI** installed locally: verify with `az --version`. [Install instructions](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli).
- An SWSD **JSON Web Token** for verification (each end user will use their own; this is just for the smoke test)

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

Wait for the environment to finish provisioning before deploying the app.

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
| `SWSD_TRUST_PROXY=1` | Trust one proxy hop; verify this matches your ingress path before using it for rate limiting |
| `SWSD_PROFILE=operations` | Register all 145 tools, including KB authoring and guarded deletes; use `custom` for an explicit subset |
| `SWSD_WRITE_MODE=live` | Allow writes. Use `dry-run` for payload previews or `disabled` for read-only hosted deployments |
| `SWSD_RATE_LIMIT_MAX=200` | Slightly higher than default since this is a shared instance |
| `--min-replicas 0` | Allow scale to zero when idle |
| `--max-replicas 3` | Cap concurrent instances to control cost spikes |
| `--cpu 0.25 --memory 0.5Gi` | Example resource allocation; measure and adjust for your workload |

Wait for provisioning to complete before checking the endpoint.

### Step 5: Get the public URL

```bash
az containerapp show \
  --name swsd-mcp \
  --resource-group swsd-mcp-rg \
  --query properties.configuration.ingress.fqdn \
  --output tsv
```

Outputs something like `swsd-mcp.bluepebble-12345abc.eastus.azurecontainerapps.io`. Save this: you'll need it for Copilot Studio in the next step.

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

These responses verify the HTTP listener and missing-token check. To verify SWSD connectivity, connect an MCP client with your JSON Web Token and call `swsd_health_check`.

### Cost monitoring

Use [Azure Container Apps pricing](https://azure.microsoft.com/pricing/details/container-apps/) and Azure Portal → Cost Management to estimate and track your deployment. Compute, requests, logs, networking, and any supporting resources can affect the total. Scale-to-zero settings do not guarantee a zero bill.

### Updating to a new version

Deploy a selected image to update the Container App. For repeatable deployments, use a commit tag from [GitHub Packages](https://github.com/mikimatsub/swsd-mcp/pkgs/container/swsd-mcp) or an image digest rather than relying on a mutable `:latest` tag:

```bash
az containerapp update \
  --name swsd-mcp \
  --resource-group swsd-mcp-rg \
  --image ghcr.io/mikimatsub/swsd-mcp:sha-XXXXXXX
```

Replace `XXXXXXX` with the selected image's commit suffix. Release builds also provide `X.Y.Z` and `X.Y` tags. To pin an immutable digest:

```bash
az containerapp update \
  --name swsd-mcp \
  --resource-group swsd-mcp-rg \
  --image ghcr.io/mikimatsub/swsd-mcp@sha256:YOUR_IMAGE_DIGEST
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
| `403` from `/mcp` | The request's `Origin` or `Host` fails its allowlist | Check `SWSD_ALLOWED_ORIGINS` and `SWSD_ALLOWED_HOSTS`; empty origins allow only loopback browser origins |
| Token forwarded but SWSD returns 401 | Token expired or invalid | Generate a fresh token in SWSD UI |

### Hardening for production

The recipe above is suitable for team use within a trusted network. For broader exposure:

- **Azure AD authentication** at the Container Apps level (Easy Auth): restrict who can even reach `/mcp` before the SWSD token check
- **VNet integration + private endpoints**: bring the endpoint inside your corporate network
- **IP allowlisting** via Container Apps ingress restrictions: limit to known office/VPN IPs
- **Custom domain + TLS certificate**: configure HTTPS for your chosen hostname, with `SWSD_ALLOWED_HOSTS` for the accepted Host headers

Each of these adds operational complexity in exchange for security.

---

## Microsoft Copilot Studio

After deploying the HTTP server (above), you import a Swagger 2.0 connector spec into Copilot Studio.

Per-profile Swagger files live in [`copilot-studio/`](https://github.com/mikimatsub/swsd-mcp/tree/main/copilot-studio) on GitHub:

- `triage.swagger.yaml` (21 tools)
- `agent.swagger.yaml` (51 tools, default)
- `knowledge.swagger.yaml` (17 tools)
- `operations.swagger.yaml` (145 tools)

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
   - **Parameter label**: `SWSD JSON Web Token` (or anything user-friendly)
   - **Parameter name**: `X-SWSD-Token` _(must match exactly)_
   - **Parameter location**: Header
4. Save the connector

### Test the connection

In Copilot Studio's connector test pane:

1. Click **Test → New connection**
2. Paste a valid SWSD JSON Web Token
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

- `x-ms-agentic-protocol: mcp-streamable-1.0` is the Microsoft extension declaring the endpoint speaks MCP over Streamable HTTP: already present in the bundled Swagger files.
- Use Streamable HTTP for [Copilot Studio's MCP connection](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent); the bundled connector declares that transport.

---

## Other platforms

Use the Docker image on a compatible container platform or VM. Check that the platform supports the image architecture, configured port, and HTTP request/response streaming. Concrete recipes for other platforms are not yet written; PRs welcome.
