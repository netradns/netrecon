#!/bin/sh
# NetRecon: work out each visitor's real IP address when a proxy sits in front.
#
# Why: nginx sees the address of whatever connects to it. Behind Traefik, Caddy,
# an AWS/GCP/Azure load balancer or Cloudflare, that is the proxy, not the visitor.
# The sign-in lockout and the rate limits would then treat everyone as one person.
#
# This script runs when the container starts (the nginx image runs every script in
# /docker-entrypoint.d/) and writes the list of proxies nginx may believe. nginx
# then reads the visitor's address from the X-Forwarded-For header, but only when
# the connection really comes from one of those proxies, so visitors cannot fake it.
#
# Settings (all optional):
#   TRUSTED_PROXIES  Extra proxy addresses to trust, comma or space separated, for
#                    example "35.191.0.0/16,130.211.0.0/22". Added to the built-in
#                    list of private addresses, which already covers Traefik, Caddy
#                    and cloud load balancers inside a private network.
#   REAL_IP_HEADER   Header that carries the visitor's address. Default
#                    X-Forwarded-For. Cloudflare users can use CF-Connecting-IP.
#
# Bad values are ignored with a warning. They never stop nginx from starting.

set -f   # entries like "*" must not be expanded as file names

OUT="${NETRECON_REALIP_CONF:-/etc/nginx/netrecon-realip.conf}"
NGINX="${NGINX_BIN:-nginx}"

# Proxies on private networks: loopback, RFC 1918, carrier-grade NAT, link-local, IPv6 local
DEFAULTS="127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16 ::1/128 fc00::/7 fe80::/10"

warn() { echo "[netrecon] $*" >&2; }

# ── Header name ───────────────────────────────────────────────────
HEADER="${REAL_IP_HEADER:-X-Forwarded-For}"
case "$HEADER" in
  ""|*[!A-Za-z0-9-]*)
    warn "REAL_IP_HEADER must be a header name such as X-Forwarded-For. Using X-Forwarded-For."
    HEADER="X-Forwarded-For"
    ;;
esac

# ── Write a config for the given list of proxies ──────────────────
write_conf() {   # $1 = file, $2 = space separated list
  {
    echo "# Written by 40-netrecon-realip.sh when the container starts. Do not edit."
    for p in $2; do echo "set_real_ip_from $p;"; done
    echo "real_ip_header $HEADER;"
    echo "real_ip_recursive on;"
  } > "$1"
}

# Ask nginx itself whether a config file is acceptable, using a tiny stand-in config
accepted() {   # $1 = file to include
  probe="$1.probe"
  printf 'events {}\nhttp {\n  include %s;\n}\n' "$1" > "$probe"
  "$NGINX" -t -c "$probe" >/dev/null 2>&1
  rc=$?
  rm -f "$probe"
  return $rc
}

# ── Collect extra proxies ─────────────────────────────────────────
EXTRA=""
for item in $(printf '%s' "${TRUSTED_PROXIES:-}" | tr ',;' '  '); do
  EXTRA="$EXTRA $item"
done

LIST="$DEFAULTS"
if [ -n "$EXTRA" ]; then
  # Keep only the entries nginx accepts, so one typo cannot hide the others
  GOOD=""
  for item in $EXTRA; do
    write_conf "$OUT.try" "$item"
    if accepted "$OUT.try"; then
      GOOD="$GOOD $item"
    else
      warn "Ignoring TRUSTED_PROXIES entry \"$item\": not a valid IP address or CIDR range."
    fi
  done
  rm -f "$OUT.try"
  LIST="$DEFAULTS$GOOD"
fi

write_conf "$OUT" "$LIST"

# Last check: if the header name or anything else made nginx reject the file,
# fall back to the plain defaults so the container still starts.
if ! accepted "$OUT"; then
  warn "The proxy settings were rejected by nginx. Using the built-in defaults."
  HEADER="X-Forwarded-For"
  write_conf "$OUT" "$DEFAULTS"
fi

if [ -n "${GOOD:-}" ]; then
  echo "[netrecon] Trusting these proxies for the visitor's real IP, in addition to private networks:${GOOD}"
fi
exit 0
