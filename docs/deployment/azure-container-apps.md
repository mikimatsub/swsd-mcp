# Deploy swsd-mcp to Azure Container Apps

End-to-end recipe for hosting the swsd-mcp HTTP transport on **Azure Container Apps**, suitable for Microsoft Copilot Studio integration or any team that wants a shared self-hosted instance.

## Why Azure Container Apps for this use case

- **Same Microsoft ecosystem** as Copilot Studio — auth flows, networking, identity all integrate cleanly
- **Scale-to-zero pricing** — when nobody's using the server, you pay nothing for compute
- **Public HTTPS endpoint** with auto-managed TLS — no certificate management
- **Container-native** — uses our published Docker image as-is, no rebuild
- **Simple ops** — no Kubernetes complexity, no VM patching

Typical cost for a single team's usage: **$0–5/month**.

## Prerequisites

- An **Azure subscription** ([free tier available](https://azure.microsoft.com/free/))
- **Azure CLI** installed locally — verify with `az --version`. Install: [docs.microsoft.com/cli/azure/install-azure-cli](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli)
- A SolarWinds Service Desk **admin token** for verification (each end user will use their own; this is just for the smoke test)

> **Shell note:** examples below use bash line continuation (`\`). On Windows PowerShell, either replace `\` with backtick (`` ` ``), or run the same commands inside Git Bash / WSL — they work verbatim there.

## Step 1: Login to Azure

```bash
az login
```

Browser opens, you authenticate, terminal confirms.

## Step 2: Create a resource group

A resource group is a logical container for related Azure resources. Pick whichever region is closest to your users.

```bash
az group create \
  --name swsd-mcp-rg \
  --location eastus
```

Other location options: `westus2`, `westeurope`, `northeurope`, `southeastasia`, etc. See `az account list-locations -o table` for the full list.

## Step 3: Create a Container Apps environment

The environment is the runtime that hosts your container apps. One environment can host many apps; we'll only create one for this guide.

```bash
az containerapp env create \
  --name swsd-mcp-env \
  --resource-group swsd-mcp-rg \
  --location eastus
```

This takes ~3 minutes. While you wait, the CLI shows progress dots.

## Step 4: Deploy the swsd-mcp container

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

Key flags explained:

| Flag | What it does |
|---|---|
| `--target-port 3000` | The container's internal listen port (matches our Dockerfile EXPOSE) |
| `--ingress external` | Accept traffic from the public internet (required for Copilot Studio) |
| `--env-vars SWSD_TRANSPORT=http` | Tell swsd-mcp to use HTTP transport, not stdio |
| `--env-vars SWSD_TRUST_PROXY=1` | Tell Express to trust Container Apps' reverse proxy so `req.ip` shows the real client |
| `--env-vars SWSD_PROFILE=operations` | Register the 64-tool ITSM operations profile; use `full` only when the deployment also needs every KB write tool |
| `--env-vars SWSD_WRITE_MODE=live` | Allow writes. Use `dry-run` for payload previews or `disabled` for read-only hosted deployments |
| `--env-vars SWSD_RATE_LIMIT_MAX=200` | Slightly higher than default since this is a shared instance |
| `--min-replicas 0` | Scale to zero when idle (the magic that makes this nearly free) |
| `--max-replicas 3` | Cap concurrent instances to control cost spikes |
| `--cpu 0.25 --memory 0.5Gi` | Right-sized for low/medium traffic |

This takes ~2 minutes.

## Step 5: Get the public URL

```bash
az containerapp show \
  --name swsd-mcp \
  --resource-group swsd-mcp-rg \
  --query properties.configuration.ingress.fqdn \
  --output tsv
```

Outputs something like `swsd-mcp.bluepebble-12345abc.eastus.azurecontainerapps.io`. Save this — you'll need it for Copilot Studio in the next step.

## Step 6: Verify the deployment

```bash
curl https://YOUR_FQDN/healthz
# Expect: {"ok":true}

# Test that /mcp rejects requests without an auth token (security check)
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  https://YOUR_FQDN/mcp
# Expect: {"error":"Missing token. Provide either \"Authorization: Bearer <token>\" or \"X-SWSD-Token: <token>\" header."}
```

If both responses match, the deployment is healthy.

## Step 7: Connect Microsoft Copilot Studio

1. Open one of the Swagger files in [`copilot-studio/`](../../copilot-studio/) — pick the one matching your `SWSD_PROFILE` (we set `operations` above, so use `operations.swagger.yaml`).
2. Edit the `host:` line:
   ```yaml
   host: REPLACE_WITH_YOUR_HOST.example.com
   ```
   to:
   ```yaml
   host: swsd-mcp.bluepebble-12345abc.eastus.azurecontainerapps.io
   ```
   (your actual FQDN from Step 5, no `https://` prefix)
3. Follow [`copilot-studio/README.md`](../../copilot-studio/README.md) from the **"Import into Copilot Studio"** step.

## Cost monitoring

Azure Container Apps charges for vCPU-seconds and memory-GiB-seconds when active, plus a small per-request fee. With `min-replicas 0`, idle time is free.

Estimated monthly cost ranges:

| Usage pattern | Approximate cost |
|---|---|
| Personal testing (10s of requests/day) | $0–1/month |
| Small team (100s of requests/day) | $1–5/month |
| Active team (1000s of requests/day) | $5–20/month |
| Large org (10,000+ requests/day) | $20–100+/month |

Monitor actual cost in Azure Portal → Cost Management. Free tier credits often cover this entirely for the first year.

## Updating to a new swsd-mcp version

When swsd-mcp publishes a new version, the Container App automatically pulls the new `:latest` Docker image on the next cold start. To force an immediate update:

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

(Find available tags at https://github.com/mikimatsub/swsd-mcp/pkgs/container/mcp-swsd)

## Tearing down

When you're done (or want to recreate from scratch):

```bash
# Delete just the container app (keeps the environment)
az containerapp delete --name swsd-mcp --resource-group swsd-mcp-rg --yes

# Or delete everything in the resource group
az group delete --name swsd-mcp-rg --yes --no-wait
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `curl /healthz` hangs | Container starting up (cold start) | Wait 30–60 seconds, retry. Cold starts are normal with `min-replicas 0`. |
| `404` from `/healthz` | Wrong FQDN, or container failed to start | Run `az containerapp logs show --name swsd-mcp --resource-group swsd-mcp-rg --follow` to see startup logs |
| `403` from `/mcp` | `SWSD_ALLOWED_ORIGINS` is set and rejecting your origin | Either remove the env var (it's safe behind Container Apps' ingress) or add the calling origin to the allowlist |
| Copilot Studio import fails | Swagger file's `host:` not updated, or contains `https://` prefix | Edit the file: `host:` should be just the FQDN, no protocol |
| Token forwarded but SWSD returns 401 | Token expired or invalid | Generate a fresh token in SWSD UI; tokens forwarded by swsd-mcp are not stored, so each request uses what the caller sent |

## Hardening for production

The recipe above is suitable for team use within a trusted network. For broader exposure, consider:

- **Azure AD authentication** at the Container Apps level (Easy Auth) — restrict who can even reach `/mcp` before the SWSD token check
- **VNet integration** + private endpoints — bring the endpoint inside your corporate network
- **IP allowlisting** via Container Apps ingress restrictions — limit to known office/VPN IPs
- **Custom domain** + your own TLS certificate — looks more polished, allows custom DNS-rebinding-prevention

Each of these adds operational complexity in exchange for security. For most internal-team use cases, the basic recipe above is sufficient.
