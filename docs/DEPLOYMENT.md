# Deploying and running NetRecon

NetRecon is two small containers. It works with no domain name, no certificate and no proxy, and it works behind Traefik, Caddy, a cloud load balancer or Cloudflare. Pick the setup that matches yours.

| Your situation | Use | HTTPS from |
|---|---|---|
| Home lab or office, reached by IP address | [Simplest setup](#1-simplest-setup-no-domain-no-https) | None (HTTP) |
| You already run Traefik | [Traefik](#2-behind-traefik) | Traefik |
| You have a domain and want HTTPS with no effort | [Caddy](#3-automatic-https-with-caddy) | Caddy |
| AWS, Google Cloud or Azure load balancer | [Cloud load balancers](#4-cloud-load-balancers) | The load balancer |
| Cloudflare proxy or tunnel | [Cloudflare](#5-cloudflare) | Cloudflare |
| Anything else (nginx proxy manager, HAProxy, ...) | [Any other proxy](#6-any-other-proxy) | The proxy |

Every setup uses the same two images. Only the surrounding compose file changes.

---

## 1. Simplest setup (no domain, no HTTPS)

Save `docker-compose.example.yml` from this repository as `docker-compose.yml`, then:

```bash
docker compose up -d
```

Open `http://<server-ip>:8085` and finish the setup wizard.

You can sign in over plain HTTP. The login screen shows a short notice that the connection is not encrypted, which is accurate: people on the same network could read the password. On a trusted home or office network that is often acceptable. If NetRecon is reachable from the internet, use one of the HTTPS setups below.

## 2. Behind Traefik

Use `docker-compose.traefik.example.yml`. Change the domain, the Traefik network name and your entrypoint and certificate resolver names (each is marked in the file), then:

```bash
docker compose -f docker-compose.traefik.example.yml up -d
```

NetRecon publishes no ports in this setup. Traefik reaches it over the shared Docker network, and the visitor's real IP is picked up automatically.

## 3. Automatic HTTPS with Caddy

Use `docker-compose.caddy.example.yml`. Put your domain in the `command:` line. Your domain's DNS must point at the server and ports 80 and 443 must be open.

```bash
docker compose -f docker-compose.caddy.example.yml up -d
```

Caddy gets and renews the certificate itself.

## 4. Cloud load balancers

In every case the load balancer forwards plain HTTP to the NetRecon container on **port 80**, and the health check path is **`/health`** (it answers `200`). The load balancer handles HTTPS.

The one thing that differs is how the visitor's real address reaches NetRecon. NetRecon needs it so the sign-in lockout and rate limits apply to the right person instead of to the load balancer. You can always check it: sign in, then open **Settings → Security → Your Connection**. It shows the address NetRecon sees for you.

### AWS Application Load Balancer

- Target group: HTTP, port 80, health check path `/health`.
- Nothing else to set. The ALB adds the visitor's address to `X-Forwarded-For` by default ([AWS documentation](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/x-forwarded-headers.html)), and ALB nodes sit on private addresses inside your VPC, which NetRecon trusts automatically.
- Leave the ALB's `X-Forwarded-For` handling on its default (append). Do not turn on the option that adds the client port to the header, because nginx cannot read an address with a port.

### Google Cloud load balancer

- Backend service: HTTP, port 80, health check path `/health`.
- Google sends the visitor's address in `X-Forwarded-For` ([Google documentation](https://docs.cloud.google.com/load-balancing/docs/https/request-distribution)), but its proxies connect from the public ranges `35.191.0.0/16` and `130.211.0.0/22`, which NetRecon does not trust by default. Add them:

  ```yaml
  services:
    netrecon:
      environment:
        TRUSTED_PROXIES: "35.191.0.0/16,130.211.0.0/22"
  ```
- Your firewall rule must allow those two ranges to reach port 80.
- A *regional* load balancer uses a private proxy-only subnet, so it needs no `TRUSTED_PROXIES`.

### Azure Application Gateway

- Backend setting: HTTP, port 80. Health probe: path `/health`.
- Application Gateway writes `X-Forwarded-For` as `address:port`, which NetRecon cannot read. Add a **rewrite rule** (v2 SKU) that sets the request header `X-Forwarded-For` to the server variable `{var_add_x_forwarded_for_proxy}`. This removes the port ([Microsoft documentation](https://learn.microsoft.com/en-us/azure/application-gateway/rewrite-http-headers-url)).
- The gateway sits on a private address in your virtual network, which NetRecon trusts automatically.

## 5. Cloudflare

- **Cloudflare Tunnel (`cloudflared`)**: point the tunnel at `http://netrecon:80` and add `REAL_IP_HEADER: CF-Connecting-IP` to the `netrecon` service. The tunnel connects from a private address, so no `TRUSTED_PROXIES` is needed.
- **Orange-cloud proxy straight to your server**: Cloudflare connects from public addresses. Add its published ranges ([cloudflare.com/ips](https://www.cloudflare.com/ips/)) to `TRUSTED_PROXIES` and set `REAL_IP_HEADER: CF-Connecting-IP`. Also only allow those ranges to reach your server, otherwise anyone can talk to it directly.

## 6. Any other proxy

Forward HTTP to the container's port 80, keep the visitor's address in `X-Forwarded-For`, and use `/health` as the health check. If the proxy connects from a private address (almost every setup on a Docker network or private subnet), nothing else is needed. If it connects from a public address, add it to `TRUSTED_PROXIES`.

---

## How NetRecon finds the real visitor address

NetRecon reads the visitor's address from `X-Forwarded-For`, but only when the connection comes from a proxy it trusts. A visitor connecting directly cannot fake their address.

| Setting | What it does | Default |
|---|---|---|
| (built in) | Trusts proxies on private addresses: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `169.254.0.0/16` and the IPv6 equivalents | on |
| `TRUSTED_PROXIES` | Extra proxy addresses to trust. Comma or space separated, IPs or CIDR ranges | none |
| `REAL_IP_HEADER` | Header that carries the visitor's address | `X-Forwarded-For` |

Set them on the `netrecon` container, as in the Google example above. A typo never stops NetRecon from starting. The bad entry is ignored and a message is written to the container log (`docker compose logs netrecon`).

---

## Everyday management

**Update**

```bash
docker compose pull
docker compose up -d
```

Settings and history are kept. Older installs that stored data in a `./data` folder keep working. The container fixes the folder's ownership by itself.

**Back up**

Your settings, watched domains and statistics live in one place.

```bash
# named volume (the default in the example files)
docker run --rm -v netrecon-data:/data -v "$PWD":/backup alpine tar czf /backup/netrecon-backup.tgz -C /data .

# or, if you use a ./data folder, just copy it
cp -r ./data ./netrecon-backup
```

**Forgot the admin password**

```bash
docker compose exec -u node dns-proxy node reset-password.js
docker compose restart dns-proxy
```

This prints a new random password once. To choose your own, pass it in the environment so it stays out of your shell history:

```bash
docker compose exec -u node -e NEW_PASSWORD='your new passphrase' dns-proxy node reset-password.js
docker compose restart dns-proxy
```

**Look at the logs**

```bash
docker compose logs -f dns-proxy     # DNS, sign-ins, watched domains, alerts
docker compose logs -f netrecon      # web server
```

**Check that it is healthy**

```bash
docker compose ps
```

Both containers should show `healthy`.

**Run the tests (contributors)**

```bash
cd dns-proxy && npm test
```

---

## Outbound access the container needs

The dns-proxy container makes these outgoing HTTPS (port 443) connections. If you restrict outbound traffic with a firewall or security group, allow them:

| What for | Where to |
|---|---|
| Public DNS lookups and DNSSEC | `cloudflare-dns.com` (DNS over HTTPS) |
| Domain registration lookups and watches | `data.iana.org` (the list of registries) and each registry's RDAP server, for example `rdap.verisign.com` for .com |
| Certificate checks and watches | The servers you check, on the port you choose |
| Notifications | Your Slack, Teams, Discord, webhook or SMTP endpoints |

Without the registry access, everything else works. The Domain Registration card shows that details are unavailable.

---

## Before you expose it to the internet

1. Finish the setup wizard and choose a strong admin password. Until it is finished, anyone who can reach the page can finish it.
2. Use HTTPS (setups 2 to 5).
3. After signing in, open **Settings → Security → Your Connection** and confirm it shows *your* address, not your proxy's.
