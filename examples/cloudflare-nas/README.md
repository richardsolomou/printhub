# Cloudflare Tunnel on a NAS

The reference PrintHub deployment: the app runs next to the print files on a NAS, a Cloudflare Tunnel provides ingress without opening router ports, and everyone signs in with PrintHub's built-in accounts. Cloudflare is one supported recipe here, not an application dependency; PrintHub itself never talks to Cloudflare.

## Prerequisites

- A Cloudflare account with a zone, and a remotely managed tunnel created under **Zero Trust → Networks → Tunnels**. Copy its token.
- Two host directories: one for `/data` (metadata) and one for `/prints` (the STL files).

In the tunnel's **Public Hostname** settings, point your hostname at `http://printhub:3000`. The `cloudflared` container reaches the app over the Compose network, so PrintHub needs no published ports.

## Run it

```sh
cp .env.example .env
# set DATA_HOST_DIR, PRINTS_HOST_DIR, and CLOUDFLARE_TUNNEL_TOKEN
docker compose up -d
```

### First sign-in

Open your tunnel hostname and create the first operator; whoever submits the welcome form first claims the account. The tunnel makes a fresh instance publicly reachable, so do this right after `docker compose up` — or start with the tunnel service stopped, create the operator on the LAN, then start it. Add everyone else under **Settings → Users**.

An optional Cloudflare Access policy in front of the hostname works as an extra gate, but PrintHub does not read its identity headers — people still sign in with their PrintHub accounts.

## TrueNAS Custom App

The same deployment without Compose, using **Apps → Discover Apps → Custom App**:

- Image: `ghcr.io/richardsolomou/printhub:latest`, pull policy **Always**, restart **Unless Stopped**.
- Host path for `/data` (for example `/mnt/HDDs/STL/.printhub-data`) and host path for `/prints` (for example `/mnt/HDDs/STL`).
- Environment variables as in the Compose file above.
- Port: container `3000`, host `3010`, and run `cloudflared` separately (another Custom App or a plain container) pointing at `http://<nas-ip>:3010`.

TrueNAS can monitor the `latest` tag for updates. The unauthenticated `/api/health` endpoint suits its health checks: it returns success only after migrations and recovery finish and both mounts accept writes.

## Upload sizes

Cloudflare's proxy caps request bodies at 100 MB. PrintHub's chunked uploads stay under this, and the cap doubles as the ingress request-body limit that the main README requires in front of the multipart parser.
