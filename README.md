# chainers.art

Playable demos from the Chainers team, live at **[chainers.art](https://chainers.art)**.

| Demo | URL | What it shows |
|---|---|---|
| Gaptooth Test Range | [/demos/gaptooth/](https://chainers.art/demos/gaptooth/) | A voxel character with 26 animations and four weapons with moving parts. Third-person shooting range, 60-second score attack, animation studio, reference match. Built with PlayCanvas. |

## Layout

```
site/                     static root, served as is
  index.html              demos hub (add a tile per demo)
  assets/                 favicon, shared fonts (OFL)
  vendor/playcanvas/      engine build shared by all demos (MIT)
  demos/<slug>/           one folder per demo
src/gaptooth/             Gaptooth source (ES modules, styles, page template)
tools/build.mjs           bundles src/gaptooth into site/demos/gaptooth
nginx/                    config for the site container
compose.yml               the site container (nginx, localhost:4190)
deploy/                   server side: host nginx vhost, update and certificate scripts, systemd units
```

## Run locally

```bash
docker compose up -d          # http://localhost:4190
```

Any static server also works (`npx serve site`), without the production headers.

## Edit the Gaptooth demo

```bash
cd tools && npm install && npm run build
```

`build.mjs` writes `app.<hash>.js`, `style.<hash>.css` and `index.html` into `site/demos/gaptooth/`. Assets in `site/demos/gaptooth/assets/` are requested with a content-hash query, so browsers and Cloudflare never serve stale files after an update.

## Add a demo

1. Put the built demo in `site/demos/<slug>/` with an `index.html` and a `cover.jpg` (1200×750).
2. Add a tile to the Demos grid in `site/index.html`.
3. Push to `main`.

## Deploy

Pushing to `main` is the deploy. The server checks GitHub every two minutes and updates its checkout to match; the container serves `site/` straight from it.

- Checkout: `/opt/chainers-art`, container `chainers-art-web-1` on `127.0.0.1:4190` (read-only, 64 MB memory cap).
- Host nginx vhost `/etc/nginx/sites-available/chainers-art` (enabled as `zz-chainers-art`) terminates TLS and proxies to the container. Traffic arrives through Cloudflare.
- Certificate: Let's Encrypt via the certbot Docker image, renewed by `chainers-art-cert-renew.timer` (falls back to a self-signed certificate behind Cloudflare if issuance ever fails).
- Updates: `chainers-art-update.timer` runs `/usr/local/sbin/chainers-art-update` (pull only, never runs code from the repo).

Changes to `compose.yml` or `nginx/` need one manual step on the server:

```bash
cd /opt/chainers-art && docker compose up -d --force-recreate
```

`deploy/install.sh` performs the whole server setup and is safe to re-run: it only adds chainers-art files, tests nginx before every reload and rolls back a vhost that fails the test.

---

Maintained by [@matveyco](https://github.com/matveyco).
