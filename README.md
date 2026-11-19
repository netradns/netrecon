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
- **Public DNS** via Cloudflare DoH (1.1.1.1) — A, AAAA, CNAME, MX, TXT, NS, SOA, CAA resolved in parallel
- **Email Security audit** — DKIM selector probing (12 common selectors), DMARC policy parsing with enforcement level, SPF mechanism breakdown with color-coded pills
- **IP Geolocation** — interactive Leaflet map with pin, org/ASN (clickable BGP.he.net link), PTR record, city/region/country, timezone
- **IPv4 + IPv6** — full support for both address families including IPv6 PTR lookups
- **Clickable IPs** — click any A/AAAA result to instantly run a full IP lookup with map
- **TLS Certificate check** — subject, issuer, SANs, expiry countdown, cipher, protocol version, full chain display
- **DNSSEC status** — shows whether a domain is signed and validated, partially configured, failing validation, or simply not signed (the common, harmless case). Includes the signing algorithm, DS records and key roles. Public lookups only.
- **Domain registration** — registrar, registered date and expiry countdown, read from the registry's public RDAP service. Registry status flags such as "client hold" are shown in red. Some registries (for example .io, .de, .us) offer no RDAP, so the card says so instead of guessing.
- **DNSBL Blacklist check** — tests IPs against 10 major blacklists (Spamhaus, SpamCop, Barracuda, SORBS, etc.) in parallel
- **Split-brain safe** — public tool uses Cloudflare DoH exclusively, never leaks internal records
- **Multi-type parallel resolution** — all record types resolved in one request (~300ms vs sequential ~6s)

### Internal DNS
- **Private DNS resolution** via your own DNS servers (Microsoft DNS, BIND, Unbound, etc.)
- **All record types** — A, AAAA, CNAME, MX, SRV, TXT, NS, PTR with TTL display
- **Health indicator** — real-time proxy connection status in sidebar
- **Domain allow-list** — optionally restrict which domains can be queried internally
- **Configurable quick links** — pre-populate common internal hostnames for one-click lookup
- **Timeout control** — configurable per-query timeout for slow internal DNS servers

### IP Calculator
- **CIDR analysis** — network, broadcast, mask, wildcard, first/last host, usable count
- **Binary display** — visual bit-level representation of IP, mask, and wildcard with colored network/host bits
- **Subnet splits** — expandable breakdown into /25, /26, /27, /28 with full details per subnet (click to expand)
- **Supernet summary** — shows parent networks for route summarization planning (clickable to recalculate)
- **RFC classification** — RFC 1918, loopback, link-local, multicast, reserved, documentation range detection
- **Quick examples** — common CIDR entries for fast access
- **Flexible input** — `/27`, `255.255.255.224` or wildcard `0.0.0.31` masks, with results that update as you type
- **Helpers** — prefix cheat sheet, "subnet for N hosts" finder, click any value to copy
- **Windows DHCP scope export** — generates PowerShell (`Add-DhcpServerv4Scope` etc.) to run on the DHCP server; gateway and pool are auto-filled
- **CSV / text export** — subnet details plus every subnet of a chosen size
- **IPv6 calculator** — enter an address such as `2001:db8::/32` for the first and last address, total size, address type (global, unique local, link-local, documentation...), reverse DNS zone, expanded and compressed forms, a hex view of the network and host parts, and splits and supernets in 4-bit steps. The Subnet Planner, Overlap Check and Summarize tabs are IPv4 only.
- **Subnet planner (VLSM)** — allocate subnets from a block by host count, largest first, with free-space and DHCP shortcuts
- **Overlap checker** — finds duplicate and nested subnets in a pasted list
- **Summarize / merge** — smallest route list covering exactly the same addresses

### Cloud CIDR Planning
- **AWS VPC, GCP VPC, Azure VNet** — automatic subnet allocation across AZs/regions
- **Configurable tiers** — name, prefix size, and color per subnet tier (e.g., public, private, database)
- **Color picker** — preset palette + custom hex input for visual subnet differentiation
- **Architecture notes** — provider-specific implementation guidance per plan (reserved IPs, AZ mapping, etc.)
- **XLSX export** — download the complete subnet plan as an Excel workbook for sharing with teams
- **Visual subnet map** — color-coded AZ breakdown with subnet names, CIDRs, and host counts

### DNS Change Monitoring
- **Watched Domains** — add any domain (public or internal) to a watch list with configurable poll intervals (5m, 15m, 1h, 6h, 24h)
- **Change Detection** — compares current records against the last snapshot and surfaces added, removed, or modified entries
- **Change History** — full audit log per domain showing what changed, when, and the before/after values
- **Multi-record support** — monitor A, AAAA, MX, TXT, NS, CNAME, SOA, CAA, or all at once
- **Public + Internal** — watch domains against Cloudflare DoH or your own private DNS servers
- **TLS certificate watching** — optional per entry. Alerts once as a certificate crosses each warning threshold (default 30, 14 and 7 days), when it expires, when it is renewed or replaced, and when checks keep failing. Works with IP addresses, internal servers, self-signed certificates and any port (LDAPS, 8443, ...), so no public domain or public certificate is needed
- **Domain registration watching** — optional per entry, public domains only. Alerts once as the registration crosses each warning threshold (default 60, 30, 14 and 7 days), when it expires, when it is renewed, and when the registry puts it on hold or in redemption. A host name such as `www.example.com` is checked as its registered domain. Checks run at most every 12 hours.
- **Detail panel** — click any watched domain to see its current snapshot, last check time, and full change log. The same panel has a "What is watched" box: tick or untick DNS record types, the TLS certificate and the domain registration, or change the interval, and save. The entry keeps its history, so there is no need to delete and re-add it.

### Notifications & Alerting
- **Multi-channel** — Slack (Block Kit), Microsoft Teams (Adaptive Cards), Discord (Embeds), generic webhooks, and email
- **Simultaneous delivery** — alerts fire to all configured channels in parallel
- **DNS change alerts** — notified immediately when a watched domain's records change
- **Delivery log** — rolling log of the last 200 delivery attempts with success/failure status and duration
- **Per-channel test** — verify each integration with a one-click test button
- **SMTP support** — send email alerts through your own relay (no external dependencies)
- **Webhook secret** — optional `X-Webhook-Secret` header for verifying inbound requests at your endpoint

### Stats Dashboard
- **Usage tracking** — per-tool counters, recent lookups, top queried domains
- **DNS proxy health** — response time, server status, nginx connection metrics
- **Hourly volume chart** — 24-hour query volume visualization
- **Record type distribution** — breakdown of which DNS record types are queried most
- **Error tracking** — NXDOMAIN, timeouts, and other failures counted and displayed
- **Login protected** — password checked on the server and stored as a salted scrypt hash, with expiring server-side sessions and login lockout

### General
- **First-run setup wizard** — browser-based setup on first launch, no config files to edit
- **Zero-config Docker deployment** — `docker compose up -d` and open the browser
- **All settings in the UI** — DNS servers, notifications, password, quick links — all configurable without restarting
- **Hot-reload** — DNS resolver reconfigures instantly when settings change
- **Dark / Light / System** theme toggle with persistence
- **Collapsible sidebar** — collapse to icon-only mode, state remembered across sessions
- **Mobile responsive** — full breakpoint support for tablets and phones
- **Keyboard shortcuts** — Enter to search, sidebar navigation
- **Rate limited** — nginx rate limiting on all API endpoints prevents abuse
- **Security hardened** — CSP headers, non-root containers, request size limits, input validation, private-address guard on the public TLS check, admin and stats endpoints behind a login
- **Zero npm dependencies** — dns-proxy uses only Node.js built-ins (no supply chain risk)
- **Persistent data** — all settings, stats, watched domains, and notification logs survive container restarts

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

### 1. Create `docker-compose.yml`

```bash
mkdir netrecon && cd netrecon
```

Save this as `docker-compose.yml` (it is also in the repository as `docker-compose.example.yml`):

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
      - netrecon-data:/data
    networks:
      - netrecon-internal
    expose:
      - "3053"

volumes:
  netrecon-data:

networks:
  netrecon-internal:
    driver: bridge
```

### 2. Start

```bash
docker compose up -d
```

No folders to create and no permissions to fix.

### 3. Complete setup

Open `http://<server-ip>:8085` (or `http://localhost:8085`). The setup wizard asks for:
- An admin password (8 characters or more)
- Optionally, your internal DNS servers

All settings can be changed later in the admin panel (Settings → Server).

You do not need a domain name or a certificate. NetRecon works by IP address over plain HTTP. If you want HTTPS, or you run it behind Traefik, a cloud load balancer or Cloudflare, see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. Ready-made files are included:

| File | For |
|------|-----|
| `docker-compose.example.yml` | The simplest setup above |
| `docker-compose.traefik.example.yml` | You already run Traefik |
| `docker-compose.caddy.example.yml` | A domain name with automatic HTTPS |

### Without Docker Compose

```bash
docker network create netrecon-internal
docker volume create netrecon-data

docker run -d --name netrecon-dns-proxy \
  --network netrecon-internal \
  -v netrecon-data:/data \
  --expose 3053 \
  --restart unless-stopped \
  ghcr.io/netradns/netrecon-dns-proxy:latest

docker run -d --name netrecon \
  --network netrecon-internal \
  -p 8085:80 \
  --restart unless-stopped \
  ghcr.io/netradns/netrecon:latest
```

### Where things are

| URL | Description |
|-----|-------------|
| `http://localhost:8085` | Main application |
| `http://localhost:8085/admin` | Admin panel: usage stats, watched domains, settings. Sign in as `admin` with the password from the setup wizard. |

> **Change the admin password** any time under **Settings → Security → Change Password** (8 characters or more). Takes effect immediately, no restart. Until you set your own, the admin panel shows a reminder.

### Managing NetRecon

```bash
docker compose pull && docker compose up -d     # update to the latest version
docker compose logs -f dns-proxy                # watch what it is doing
docker compose ps                               # both containers should say "healthy"
```

**Forgot the admin password?**

```bash
docker compose exec -u node dns-proxy node reset-password.js
docker compose restart dns-proxy
```

It prints a new random password once. Backups, choosing your own password and more are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
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

### Security Notes

- **Works without HTTPS or a domain.** You can reach NetRecon by IP address over plain HTTP, for example `http://192.168.1.50:8085`, and still sign in. The login screen shows a gentle notice in that case because the password crosses your network unencrypted. Put NetRecon behind HTTPS when you can, and always do so if it is reachable from the internet.
- **Login.** The password is sent once to the server, which checks it and returns a random session token. Sessions end after 2 hours without use or 12 hours in total, when you sign out, and when the password is changed elsewhere. Restarting the container signs everyone out.
- **Lockout.** 5 wrong passwords from one IP lock that IP out for 15 minutes, on top of the nginx rate limit.
- **Upgrading.** Existing installs keep working. The old password hash is upgraded to a salted hash the first time you sign in.
- **Behind a proxy or load balancer.** Lockouts and rate limits count per visitor. NetRecon reads the visitor's real address from X-Forwarded-For, but only when the connection comes from a proxy on a private address (Traefik, Caddy, AWS ALB and Azure Application Gateway all qualify), so a visitor cannot fake it. If your proxy connects from a public address, such as Google Cloud's load balancer or Cloudflare, add it with the TRUSTED_PROXIES setting. **Settings → Security → Your Connection** shows the address NetRecon sees for you. Details are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- **Public TLS check.** It refuses private, loopback and link-local addresses, so it cannot be pointed at your internal network. Certificate watches of internal hosts are configured by the admin and are allowed to reach private addresses.
- **Activity.** The admin **Activity** page is one place for what happened: sign-ins (including failed and blocked attempts), setting, password and watch changes, command-line password resets, watch alerts (DNS changes, certificate and registration events), notification deliveries and failures, and server starts. It pages through the list (10 to 100 per page), filters by group and exports to CSV. The last 1000 admin events, 200 deliveries and 100 watch alerts are kept. It records the names of settings that changed, never their values, passwords, webhook secrets or web addresses.
- **Domain registration lookups.** The container asks the public RDAP services listed by IANA (`data.iana.org`). It only connects over HTTPS to registry servers, never to IP addresses or private networks, and caps the answer size and time.
- **Set the admin password before exposing a new instance.** Until the first-run wizard is finished, anyone who can reach the page can finish it.

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
├── docker-compose.example.yml  # Template for new deployments (simplest setup)
├── docker-compose.traefik.example.yml  # Behind Traefik
├── docker-compose.caddy.example.yml    # Automatic HTTPS with Caddy
├── Dockerfile                  # nginx container
├── nginx.conf                  # Reverse proxy + security headers
├── docker/nginx/
│   └── 40-netrecon-realip.sh   # Works out the real visitor IP behind a proxy (runs at container start)
├── docs/
│   └── DEPLOYMENT.md           # Traefik, Caddy, AWS/GCP/Azure, Cloudflare, backups, password reset
├── dns-proxy/
│   ├── test/                   # Unit and end-to-end tests (node:test, no dependencies)
│   ├── server.js               # Entry point (routing only)
│   ├── reset-password.js       # Command-line admin password reset
│   ├── docker-entrypoint.sh    # Prepares /data and drops root privileges
│   ├── Dockerfile
│   └── lib/
│       ├── config.js           # All environment variables
│       ├── resolver.js         # DoH + UDP DNS resolution
│       ├── handlers.js         # HTTP route handlers
│       ├── dnssec.js           # DNSSEC status (validated, partial, failing, not signed)
│       ├── net-guard.js        # Private/reserved address checks for the public TLS tool
│       ├── tls-check.js        # TLS certificate reader
│       ├── rdap.js             # Domain registration lookup (RDAP)
│       ├── rdap-handler.js     # GET /rdap endpoint
│       ├── stats.js            # Stats persistence
│       ├── admin/
│       │   ├── config-store.js # Runtime config I/O (/data/config.json)
│       │   ├── password.js     # Salted scrypt hashing, verify, change
│       │   ├── session.js      # Session tokens, login lockout, auth guard
│       │   ├── handlers.js     # HTTP handlers for /admin/* routes
│       │   ├── audit.js        # Admin activity log (/data/audit.json)
│       │   ├── audit-handlers.js # GET /admin/audit
│       │   ├── activity.js        # Merges audit, delivery and watch alerts into one feed
│       │   ├── watched-rules.js   # Rules for what a watch may contain (add and edit)
│       │   └── watched-edit.js    # PATCH /admin/watched/:id
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
│           ├── cert.js         # Certificate alert rules (pure, unit-tested)
│           ├── cert-check.js   # Runs one certificate check and records the result
│           ├── domain-expiry.js # Registration alert rules (pure, unit-tested)
│           ├── expiry-check.js # Runs one registration check
│           ├── expiry-alerts.js # Registration notifications
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
        │   ├── dns-render.js   # Results rendering (10 record type cards)
        │   ├── dns-dnssec.js   # DNSSEC badge and card
        │   └── dns-rdap.js     # Domain Registration card
        ├── idns/
        │   ├── idns.js         # Internal DNS logic
        │   └── idns-render.js  # Results rendering
        ├── calc/
        │   ├── calc.js          # Input parsing and subnet math
        │   ├── calc-render.js   # Binary display, subnet splits, supernets
        │   ├── calc-ip6.js      # IPv6 maths (BigInt), unit-tested
        │   ├── calc-ip6-render.js # IPv6 result display
        │   ├── calc-tools.js    # Cheat sheet, host finder, live results
        │   ├── calc-nettools.js # Pure logic: VLSM, overlaps, summarize, CSV
        │   ├── calc-dhcp.js     # Windows DHCP scope PowerShell dialog
        │   └── calc-planner.js  # Tabs and planner UI
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
            ├── admin-pager.js  # Shared page-size and Newer/Older bar
            ├── audit/
            │   └── audit.js    # Activity page (paging, groups, CSV export)
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
                ├── watched-expiry.js # Registration badge and detail section
                ├── watched-edit.js   # "What is watched" editor in the detail panel
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

### Tests

The dns-proxy has tests built on Node's own test runner, so there is still nothing to install:

```bash
cd dns-proxy
npm test
```

They cover the admin login, password upgrade, certificate alert rules, DNSSEC parsing, the private-address guard, and real TLS handshakes against a local test server. CI runs them before building the images.

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

**Settings or stats will not save**
- The container fixes the ownership of its data folder by itself when it starts. If you still see permission errors in `docker logs netrecon-dns-proxy`, the data folder is probably on a network share that refuses ownership changes. NetRecon then runs as root so saving keeps working, and logs a message saying so.
- Using a named volume (as in the example files) avoids the problem.

**Everyone is locked out of sign-in, or one person's wrong passwords lock out everyone**
- A proxy or load balancer is probably in front of NetRecon and its address is not trusted, so NetRecon sees every visitor as the proxy. Sign in and check **Settings → Security → Your Connection**, then see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Lockouts also clear by themselves after 15 minutes, or immediately with `docker compose restart dns-proxy`.

**Port conflict**
- Change `8085:80` in `docker-compose.yml` to any available port

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>A free tool by the makers of <a href="https://netradns.com">Netra</a> — enterprise DNS change management with approval workflows, drift detection, and audit trails.</sub>
</p>
