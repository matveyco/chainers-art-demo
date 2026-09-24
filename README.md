# chainers.art

Playable demos from the Chainers team, live at **[chainers.art](https://chainers.art)**.

| Demo | URL | What it shows |
|---|---|---|
| Gaptooth Test Range | [/demos/gaptooth/](https://chainers.art/demos/gaptooth/) | An articulated voxel character with 26 animations and four weapons with moving parts. Third-person shooting range with toon VFX, 60-second score attack, animation studio, reference match; physically based and comic render styles; performance overlay. Built with PlayCanvas. |

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

## Gaptooth: what is in the build

- **Character**: 3.6k triangles, one draw call. Every convex edge is chamfered (1.2 cm) with authored normals, so edges catch the light like a moulded figure. Limbs are rigid segments that pivot over rounded joint cores at the elbows, wrists and knees; the body column bends over smooth weight zones with an edge loop every 2 cm. Metal/roughness map for vinyl skin, cotton, leather and rubber.
- **Lighting**: image-based lighting from a procedural sky and a studio light tent, built on the GPU at start-up (no HDR downloads). PCF 5×5 sun shadows in three texel-snapped cascades; the recoil FOV kick is applied through the projection matrix, so the cascades never resize and the shadows stay still.
- **Styles**: `PBR` (MSAA, SSAO, bloom, neutral tone mapping, grading) and `Comic` (cel-banded light, crisp terminators, flat ambient, rim light, ink lines found in the compose pass from the depth prepass). Toggle in the top bar or with `V`.
- **Effects**: every sprite effect (muzzle flashes, tracers, sparks, dust, smoke, fireballs, flames, shock rings) is one instanced, depth-sorted draw with premultiplied blending, so a particle can be anything from pure glow to a solid toon puff. Sprites dissolve along an erosion field; fireballs cool through a temperature ramp from white-hot to soot; soft edges come from the depth prepass; tracers keep a readable on-screen width. Smoke and fire lower the scene alpha so the comic ink lines stay behind them. Debris (brass, shells, splinters, paper flakes, chunks) is GPU-instanced, one draw per material.
- **Range**: pixel-art textures painted with an image model and cleaned to fixed palettes (nearest filtering, sRGB mip-maps); chamfered props merged per material, lathed oil drums, paper targets on hinged stands that keep their bullet holes until fresh paper goes up.
- **Run and gun**: the weapon layer is masked to the spine, so arms and aim stay on the gun while the legs walk or sprint.
- **Performance overlay**: the counter in the top bar (or `` ` ``) opens fps, a frame-time graph, draw calls, triangles drawn this frame, shadow and post settings.
- **Assets**: GLBs with 8-bit normals and weights and 16-bit UVs (`KHR_mesh_quantization`), int16 animation rotations; range textures as small palette PNGs, the effect atlas and its erosion field as WebP.

## Edit the Gaptooth demo

```bash
cd tools && npm install && npm run build
```

`build.mjs` writes `app.<hash>.js`, `style.<hash>.css` and `index.html` into `site/demos/gaptooth/`, and stamps the hub's tile and share images with their content hash. Assets in `site/demos/gaptooth/assets/` are requested with a content-hash query, so browsers and Cloudflare never serve stale files after an update.

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
