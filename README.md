# chainers.art

Playable demos from the Chainers team, live at **[chainers.art](https://chainers.art)**.

| Demo | URL | What it shows |
|---|---|---|
| Chainers Brawl | [/demos/brawl/](https://chainers.art/demos/brawl/) | Top-down brawler against bots: Gem Grab (3 vs 3) and Solo Showdown (six players, power boxes, closing gas). Four Chainers with their own outfits, weapons and supers, bushes to hide in, breakable walls, toon / PBR / pixel-art graphics, twin-stick touch controls. Built with PlayCanvas. |
| Gaptooth Test Range | [/demos/gaptooth/](https://chainers.art/demos/gaptooth/) | An articulated voxel character with 26 animations and four weapons with moving parts. Third-person shooting range with toon VFX, 60-second score attack, animation studio, reference match; physically based and comic render styles; performance overlay. Built with PlayCanvas. |

## Layout

```
site/                     static root, served as is
  index.html              demos hub (add a tile per demo)
  assets/                 favicon, shared fonts (OFL)
  vendor/playcanvas/      engine build shared by all demos (MIT)
  demos/<slug>/           one folder per demo
src/<slug>/               demo sources (ES modules, styles, page template): gaptooth, brawl
tools/build.mjs           bundles src/<slug> into site/demos/<slug> (all demos, or the slugs given)
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

## Chainers Brawl: what is in the build

- **Gem Grab**, 3 vs 3. A gem pops out of the mine every 7 s; a team holding 10 or more (and more than the other team) for 15 s wins, knocked-out brawlers drop every gem they carry, and when the 2:30 clock runs out the team with more gems wins.
- **Solo Showdown**, six players, no teams and no respawns. Power boxes (1500 health) drop a power cube each, and every cube held adds 10% health and damage; a knocked-out brawler spills their cubes. From 0:22 poison gas closes in from the edges over 85 s (700 damage a second, doubling toward the end) down to a small square in the middle. Last one standing wins; the results list everyone's place.
- **In both**: health regenerates after 3 s out of combat, ammo reloads one bar at a time, hits charge the super.
- **Brawlers**: the Gaptooth figure with four outfits painted into the same texture layout (the atlas is repainted in 3D space, so every face stays consistent) and voxel hats on the head bone. Gaptooth (SMG bursts; super: a long burst that smashes walls), Brick (shotgun spread; super: a knock-back blast that flattens cover), Rosa (splash rockets; super: a barrage on any spot in range), Pip (fast double shots; super: heals the squad, refills ammo and hastes everyone).
- **Bots**: A* paths on the tile grid, team-shared vision (bushes hide brawlers unless an enemy is within 2.6 m or they just fired), modes for fighting at their weapon's preferred range, collecting gems, holding the mine, protecting a lead and retreating to heal; they lead their shots, sidestep incoming bullets and pick their moments for supers. In Showdown they shoot open power boxes and pick up cubes, leave loot to whoever is closer and fight only when shot at for the first half minute, then hold bushes on their own side and move in ahead of the gas. Easy, normal and hard differ in reaction time, aim error, leading and dodging.
- **Arenas**: Gem Grab 17 × 29 tiles, Showdown 29 × 29, both mirrored both ways. The floor is baked into one pixel-art texture at start-up (grass and packed sand mixed by a noise mask, a light checker, contact shade at wall feet, wet sand round the ponds); walls and bushes are chamfered voxel blocks merged per material. Bushes sway, part around brawlers walking through them and turn see-through (dithered) round the player; the see-through circle lowers the scene alpha so the ink pass leaves it clean. The gas is a ground overlay shader with a bright rim, a translucent curtain along the edges and clouds rolling off the boundary. Water is a small toon shader with foam along the banks.
- **Graphics**: `Toon` (cel light, crisp shadows, ink lines), `PBR` (SSAO, bloom, soft grade) and `Pixel` (the toon look rendered at about a quarter of the resolution and scaled up with hard pixels). Switch in the top bar or with `V`.
- **Controls**: WASD and the mouse (click to shoot, hold right click or Space and release for the super, Q for a quick shot at the nearest enemy); on touch, a floating move stick and attack and super sticks that aim while dragged and fire on release (a tap fires at the nearest enemy).

## Edit a demo

```bash
cd tools && npm install && npm run build
```

`build.mjs` writes `app.<hash>.js`, `style.<hash>.css` and `index.html` into each `site/demos/<slug>/`, and stamps the hub's tile and share images with their content hash. Assets in `site/demos/<slug>/assets/` are requested with a content-hash query, so browsers and Cloudflare never serve stale files after an update.

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
