#!/usr/bin/env bash
# One-time (and re-runnable) server setup for chainers.art on a host that already runs nginx + Docker.
# Touches only chainers-art files. Every nginx reload is preceded by `nginx -t`; if the new vhost
# fails the test it is removed again and nginx is left exactly as it was.
#
#   git clone https://github.com/matveyco/chainers-art-demo.git /opt/chainers-art
#   bash /opt/chainers-art/deploy/install.sh
set -euo pipefail
APP=/opt/chainers-art
PORT=4190
SITE=/etc/nginx/sites-available/chainers-art
LINK=/etc/nginx/sites-enabled/zz-chainers-art     # loads after the other sites: never the default 443 server
log() { echo "[chainers-art] $*"; }

# ---- preflight: tools present, current nginx config healthy, port free (or already ours)
for c in docker git nginx curl openssl; do command -v "$c" >/dev/null || { echo "missing $c"; exit 1; }; done
nginx -t -q || { echo "existing nginx config does not test clean, stopping"; exit 1; }
if ss -tln | grep -q "127.0.0.1:$PORT " && ! docker ps --format '{{.Names}}' | grep -qx 'chainers-art-web-1'; then
  echo "port $PORT is taken by something else, stopping"; exit 1
fi

# ---- checkout
if [ -d "$APP/.git" ]; then git -C "$APP" pull --ff-only --quiet; else git clone --quiet https://github.com/matveyco/chainers-art-demo.git "$APP"; fi
log "checkout at $(git -C "$APP" rev-parse --short HEAD)"

# ---- container (localhost only)
cd "$APP"
docker compose up -d --quiet-pull
for i in $(seq 1 30); do curl -fsS --noproxy '*' -o /dev/null "http://127.0.0.1:$PORT/healthz" && break; sleep 1; done
curl -fsS --noproxy '*' -o /dev/null "http://127.0.0.1:$PORT/" || { echo "container did not come up"; docker compose logs --tail 30; exit 1; }
log "container up on 127.0.0.1:$PORT"

# ---- nginx pieces that cannot affect other sites
install -m 644 "$APP/deploy/cloudflare-realip.conf" /etc/nginx/snippets/chainers-art-cloudflare-realip.conf
install -d -m 755 /var/www/chainers-art-acme /etc/nginx/ssl/chainers-art
install -m 755 "$APP/deploy/chainers-art-update" /usr/local/sbin/chainers-art-update
install -m 755 "$APP/deploy/chainers-art-renew-cert" /usr/local/sbin/chainers-art-renew-cert

enable_vhost() {   # $1 = vhost file to install; rolls back on a failed test
  local backup=""
  [ -f "$SITE" ] && backup=$(mktemp) && cp "$SITE" "$backup"
  install -m 644 "$1" "$SITE"
  ln -sfn "$SITE" "$LINK"
  if nginx -t -q; then
    systemctl reload nginx
  else
    if [ -n "$backup" ]; then cp "$backup" "$SITE"; else rm -f "$LINK" "$SITE"; fi
    nginx -t -q && systemctl reload nginx
    echo "new vhost failed nginx -t, rolled back"; exit 1
  fi
}

# ---- certificate: HTTP-only vhost first so Let's Encrypt can reach the challenge
if [ ! -e /etc/nginx/ssl/chainers-art/fullchain.pem ]; then
  boot=$(mktemp)
  cat > "$boot" <<CONF
server {
    listen 80;
    listen [::]:80;
    server_name chainers.art www.chainers.art;
    location /.well-known/acme-challenge/ { root /var/www/chainers-art-acme; }
    location / { proxy_pass http://127.0.0.1:$PORT; proxy_set_header Host \$host; }
}
CONF
  enable_vhost "$boot"
  log "bootstrap vhost live, requesting certificate"
  /usr/local/sbin/chainers-art-renew-cert
fi

# ---- final vhost (HTTP -> HTTPS, TLS, proxy to the container)
enable_vhost "$APP/deploy/nginx-chainers-art.conf"
log "vhost live"

# ---- timers: certificate renewal, pull-based deploys from GitHub
install -m 644 "$APP"/deploy/systemd/chainers-art-*.service "$APP"/deploy/systemd/chainers-art-*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now chainers-art-cert-renew.timer chainers-art-update.timer >/dev/null
log "timers enabled"

# ---- check through nginx, as a browser would
code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -k --resolve chainers.art:443:127.0.0.1 https://chainers.art/ || true)
log "https://chainers.art via local nginx -> $code"
readlink -f /etc/nginx/ssl/chainers-art/fullchain.pem | sed 's/^/[chainers-art] certificate: /'
