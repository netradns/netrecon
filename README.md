# NetRecon

![Node.js](https://img.shields.io/badge/Node.js-22--alpine-green)
![Docker](https://img.shields.io/badge/Docker-ready-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)
![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen)
![Cloudflare DoH](https://img.shields.io/badge/DNS-Cloudflare_DoH-F48120)
![Multi--Cloud](https://img.shields.io/badge/Cloud-AWS_%7C_GCP_%7C_Azure-0078D4)

**DNS Intelligence & Network Planning** — public DNS lookups, internal DNS resolution, IP calculator with subnet/supernet analysis, and multi-cloud CIDR planning. Self-hosted, zero external dependencies, runs entirely in Docker.

> **From the makers of [Netra](https://netradns.com)** — enterprise DNS change management with approval workflows, drift detection, and audit trails for Windows DNS, Route 53, Cloud DNS, Azure DNS, and Cloudflare.

---

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Quick Start](#quick-start)
4. [Configuration](#configuration)
5. [File Structure](#file-structure)
6. [Contributing](#contributing)
7. [Troubleshooting](#troubleshooting)

---

## Features

### DNS / IP Lookup
- **Public DNS** via Cloudflare DoH (1.1.1.1) — A, AAAA, CNAME, MX, TXT, NS, SOA, CAA
- **Email Security** — DKIM selector probing, DMARC policy parsing, SPF mechanism breakdown
- **IP Geolocation** — interactive Leaflet map, org/ASN, PTR record, IPv4 + IPv6 support
- **Clickable IPs** — click any A/AAAA result to run a full IP lookup instantly
- **Split-brain safe** — public tool uses Cloudflare DoH only, never touches internal DNS

### Internal DNS
- **Private DNS resolution** via your own DNS servers (Microsoft DNS, BIND, Unbound, etc.)
- **All record types** — A, AAAA, CNAME, MX, SRV, TXT, NS, PTR with TTL display
- **Health indicator** — real-time proxy connection status in sidebar
- **Configurable quick links** — pre-populate common internal hostnames

### IP Calculator
- **CIDR analysis** — network, broadcast, mask, wildcard, first/last host, usable count
- **Binary display** — visual bit-level representation of IP, mask, and wildcard
- **Subnet splits** — expandable breakdown into /25, /26, /27, /28 with all subnet details
- **Supernet summary** — shows parent networks for route summarization planning (clickable)
- **RFC classification** — RFC 1918, loopback, link-local, multicast, reserved detection

### Cloud CIDR Planning
- **AWS VPC, GCP VPC, Azure VNet** — automatic subnet allocation across AZs/regions
- **Configurable tiers** — name, prefix size, color per subnet tier
- **Color picker** — preset palette + custom hex input
- **Architecture notes** — provider-specific implementation guidance per plan
- **XLSX export** — download complete subnet plan as Excel workbook

### Stats Dashboard
- **Usage tracking** — per-tool counters, recent lookups, top queried domains
- **DNS proxy health** — response time, server status, nginx metrics
- **Hourly volume chart** — 24-hour query volume visualization
- **Login protected** — SHA-256 hashed credentials, session-based auth

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     Browser                         │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────┐
│                    nginx                            │
│  • Serves static frontend                           │
│  • Proxies /api/* → dns-proxy                       │
│  • Rate limiting, CSP headers, gzip                 │
└──────────────────────┬──────────────────────────────┘
                       │ Internal network only
┌──────────────────────▼──────────────────────────────┐
│                  dns-proxy (Node.js)                │
│  • Public DNS  → Cloudflare DoH (1.1.1.1)           │
│  • Internal DNS → your DNS_SERVERS (UDP)            │
│  • IP Geolocation → ipinfo.io / ip-api.com          │
│  • Stats persistence → /data/stats.json             │
└─────────────────────────────────────────────────────┘
```

**Zero external dependencies** — the dns-proxy uses only Node.js built-ins (`dns`, `http`, `https`, `fs`). No npm packages required.

---

## Quick Start

### Prerequisites
- Docker + Docker Compose
- Your internal DNS server IPs (for the Internal DNS tool)

### 1. Create the project directory

```bash
mkdir netrecon && cd netrecon
```

### 2. Create `docker-compose.yml`

```yaml
services:
  netrecon:
    image: ghcr.io/netradns/netrecon:latest
    container_name: netrecon
    restart: unless-stopped
    ports:
      - "8085:80"
    networks:
      - netrecon-internal
    depends_on:
      - dns-proxy

  dns-proxy:
    image: ghcr.io/netradns/netrecon-dns-proxy:latest
    container_name: netrecon-dns-proxy
    restart: unless-stopped
    volumes:
      - ./data:/data
    networks:
      - netrecon-internal
    expose:
      - "3053"

networks:
  netrecon-internal:
    driver: bridge
```

### 3. Start

```bash
mkdir -p ./data && sudo chown 1000:1000 ./data
docker compose up -d
```

### 4. Complete Setup

Open `http://localhost:8085` — the setup wizard will guide you through:
- Setting an admin password
- Optionally configuring internal DNS servers

All settings can be changed later in the admin panel (Settings → Server).

### Without Docker Compose

```bash
docker network create netrecon-internal

mkdir -p /docker/netrecon/data && sudo chown 1000:1000 /docker/netrecon/data

docker run -d --name netrecon-dns-proxy \
  --network netrecon-internal \
  -v /docker/netrecon/data:/data \
  --expose 3053 \
  --restart unless-stopped \
  ghcr.io/netradns/netrecon-dns-proxy:latest

docker run -d --name netrecon \
  --network netrecon-internal \
  -p 8085:80 \
  --restart unless-stopped \
  ghcr.io/netradns/netrecon:latest
```

### 3. Access

| URL | Description |
|-----|-------------|
| `http://localhost:8085` | Main application |
| `http://localhost:8085/admin` | Admin panel — usage stats, watched domains, settings (login: admin / admin) |

> **Change the admin password** — log in to the admin panel and go to **Settings → Security → Change Password**. Takes effect immediately, no container restart needed.

---

## Configuration

All configuration is managed through the web UI — no environment variables or file editing required.

On first launch, a setup wizard guides you through the initial configuration. After that, all settings are available in the admin panel under **Settings → Server**.

| Setting | Where to Configure | Description |
|---------|-------------------|-------------|
| Admin password | Setup wizard / Settings → Security | Password for the admin panel |
| Internal DNS servers | Setup wizard / Settings → Server | Your private DNS server IPs |
| Public DNS | Settings → Server | Public DNS for connectivity tests (default: 1.1.1.1, 8.8.8.8) |
| Allowed domains | Settings → Server | Restrict internal DNS to specific domains |
| DNS timeout | Settings → Server | Internal DNS query timeout in ms |
| Internal DNS toggle | Settings → General | Show/hide the Internal DNS tool |
| Notifications | Settings → Notifications | Slack, Teams, Discord, Webhook, Email alerts |
| Quick links | Settings → General | Customize the quick-link chips on lookup pages |

All changes take effect immediately — no container restart required.

### Customizing Quick Links

**Public DNS** — edit `frontend/js/dns/dns.js`:
```js
var DNS_QUICK_LINKS = ['example.com', 'google.com', 'cloudflare.com'];
```

**Internal DNS** — edit `frontend/js/idns/idns.js`:
```js
var IDNS_QUICK_LINKS = [
  { label: 'intranet.corp.local', value: 'intranet.corp.local' },
];
```

### Customizing Cloud Defaults

Edit `frontend/js/cloud/cloud-data.js` to change default subnet tiers for each provider.

---

## File Structure

```
netrecon/
├── docker-compose.yml          # Production deployment
├── docker-compose.example.yml  # Template for new deployments
├── Dockerfile                  # nginx container
├── nginx.conf                  # Reverse proxy + security headers
├── dns-proxy/
│   ├── server.js               # Entry point (routing only)
│   ├── Dockerfile
│   └── lib/
│       ├── config.js           # All environment variables
│       ├── resolver.js         # DoH + UDP DNS resolution
│       ├── handlers.js         # HTTP route handlers
│       ├── stats.js            # Stats persistence
│       ├── admin/
│       │   ├── config-store.js # Runtime config I/O (/data/config.json)
│       │   ├── password.js     # Password hash/verify logic
│       │   └── handlers.js     # HTTP handlers for /admin/* routes
│       ├── notify/
│       │   ├── dispatcher.js   # Routes events to all configured channels
│       │   ├── format.js       # Shared color/timestamp helpers
│       │   ├── log.js          # Delivery log persistence
│       │   └── channels/
│       │       ├── slack.js    # Slack Block Kit sender
│       │       ├── teams.js    # Teams Adaptive Card sender
│       │       ├── discord.js  # Discord embed sender
│       │       ├── webhook.js  # Generic JSON POST sender
│       │       └── email.js    # Raw SMTP sender (no dependencies)
│       └── watcher/
│           ├── index.js        # Scheduler — single interval, per-domain check
│           ├── snapshot.js     # Watched domains state I/O (/data/watched.json)
│           ├── poller.js       # Resolves a single domain, returns records
│           ├── diff.js         # Pure function: compares two record sets
│           └── alerts.js       # Formats + dispatches change notifications
└── frontend/
    ├── index.html              # Main application
    ├── admin.html              # Admin panel (dashboard, watched domains, settings)
    ├── style.css               # All styles
    └── js/
        ├── core/
        │   ├── utils.js        # Shared helpers, IP math, TTL formatting
        │   ├── theme.js        # Light/dark/system theme
        │   ├── nav.js          # Page routing, hash-based deep links
        │   ├── routing.js      # URL hash routing + copy buttons
        │   └── custom-select.js # App-native dropdown component
        ├── dns/
        │   ├── dns.js          # DNS/IP lookup logic
        │   └── dns-render.js   # Results rendering (10 record type cards)
        ├── idns/
        │   ├── idns.js         # Internal DNS logic
        │   └── idns-render.js  # Results rendering
        ├── calc/
        │   ├── calc.js         # CIDR calculation logic
        │   └── calc-render.js  # Binary display, subnet splits, supernets
        ├── cloud/
        │   ├── cloud-data.js   # Default tier presets (AWS/GCP/Azure)
        │   ├── cloud.js        # Planning logic, color picker
        │   └── cloud-render.js # VPC/VNet rendering, XLSX export
        ├── stats/              # Dashboard stats modules (loaded by admin.html)
        │   ├── stats.js        # Orchestration + auto-refresh
        │   ├── stats-proxy.js  # DNS proxy health
        │   ├── stats-nginx.js  # Nginx metrics
        │   ├── stats-server.js # Server info
        │   ├── stats-usage.js  # Tool usage bars
        │   ├── stats-queries.js # Top queries + recent lookups
        │   ├── stats-records.js # Record type distribution
        │   ├── stats-errors.js  # Error tracking
        │   └── stats-chart.js   # Hourly volume chart
        └── admin/              # Admin panel modules
            ├── admin.js        # Page orchestrator
            ├── admin-auth.js   # Login gate + authenticated fetch helper
            ├── admin-nav.js    # Tab routing (Dashboard / Watched / Settings)
            ├── settings/
            │   ├── settings.js # Settings page orchestrator + tab switching
            │   ├── general.js  # Internal DNS toggle
            │   ├── notify.js   # Notification channel list (Slack/Teams/Discord/Webhook/Email)
            │   ├── smtp.js     # SMTP configuration
            │   ├── password.js # Change admin password
            │   └── guides.js   # Collapsible setup guides per channel type
            └── watched/
                ├── watched.js       # Watched domains page orchestrator
                ├── watched-table.js # Domain list table + remove
                ├── watched-detail.js # Domain detail slide-in panel
                └── watched-form.js  # Add domain form + validation
```

---

## Contributing

Contributions are welcome. The codebase is intentionally modular — each feature lives in its own directory with a clear separation between logic and rendering.

### Adding a new tool

1. Create `frontend/js/mytool/mytool.js` and `mytool-render.js`
2. Add a page div to `frontend/index.html`
3. Add a sidebar nav item in `index.html`
4. Update `PAGE_TITLES` in `frontend/js/core/nav.js`
5. Load the scripts at the bottom of `index.html`

### Code style

- `'use strict';` at the top of every file
- Plain ES5-compatible JavaScript (no build step, no transpiler)
- Comments on anything non-obvious
- Small, single-purpose functions
- No external npm packages in the frontend

### Before submitting a PR

- Test in light and dark themes
- Test on mobile viewport
- Check browser console for errors
- Verify the stats page still works

---

## Troubleshooting

**Public DNS returns no results**
- Check outbound HTTPS (port 443) is allowed from the container to `1.1.1.1`
- Run `docker logs netrecon-dns-proxy` and look for DoH errors

**Internal DNS not working**
- Verify `DNS_SERVERS` are reachable from the container network
- Check port 53 UDP is open between the container and your DNS servers
- Run `docker logs netrecon-dns-proxy` for connectivity test results

**Stats page permission error**
- The `./data` directory needs to be writable by UID 1000
- Run: `mkdir -p ./data && sudo chown 1000:1000 ./data`

**Port conflict**
- Change `8085:80` in `docker-compose.yml` to any available port

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>A free tool by the makers of <a href="https://netradns.com">Netra</a> — enterprise DNS change management with approval workflows, drift detection, and audit trails.</sub>
</p>
