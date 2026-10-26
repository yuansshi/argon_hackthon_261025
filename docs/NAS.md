# NAS public practice deployment

Target: **https://blitz.bespoke3d.ai/**. This serves the same browser-only practice as GitHub Pages: four math quests, original guides, authored hints, local stars, and the demo MP4. Gemini chat, microphone and camera stay disabled. No credential or Node.js relay belongs in this public container.

## Prepare a release

Requires Node.js 22+, installed project dependencies, and system `tar`. Run the tests first. Choose the NAS's verified private LAN address and an unused unprivileged host port; the package tool has no bind-address or port default.

```sh
npm test
BLITZ_NAS_BIND_IP=VERIFIED_PRIVATE_NAS_IP \
BLITZ_NAS_PORT=VERIFIED_UNUSED_PORT \
BLITZ_RELEASE=YOUR_LOWERCASE_RELEASE_LABEL \
node scripts/package-nas.mjs
```

Replace all three placeholders. The tool rejects public/wildcard/loopback IPs, unsafe release labels, and privileged ports. It builds a fresh allowlisted static site and writes `.runtime/blitz-RELEASE.tar.gz`. An existing archive is never replaced. Staging directories remain in `.runtime/` for inspection.

The archive contains one `blitz-RELEASE/` directory: `site/`, `compose.yaml`, `Caddyfile`, `proxy-site.Caddyfile`, and `release.json`. The manifest records every public site's file path, byte count, and SHA-256 digest for deployment verification. The archive contains no dependencies, backend, credential helpers, API keys, original lecture, or private learner media. The build runs locally and is architecture-neutral; the NAS uses the established official `caddy:2.11.4-alpine` image without building an image.

## Deploy through the NAS GUI

1. Upload and extract into a dedicated versioned deployment folder, away from other applications. Confirm the extracted `compose.yaml` sits next to `Caddyfile` and `site/`.
2. Check permissions: container UID/GID `1000:1000` must read the files and traverse their directories. GUI extraction ownership varies. Do not solve a permission failure with privileged mode or world-write access.
3. Create a Compose application from that release folder. The relative mounts resolve only inside this release; mount `site/` and `Caddyfile` read-only. Do not add host-root, Docker-socket, credential or shared proxy mounts.
4. Verify the private `IP:PORT` serves the expected HTML, JS modules and video. Direct private HTTP tests can check files, but browser quests require a secure context and must be tested through HTTPS.
5. Add only the generated `proxy-site.Caddyfile` site block to the existing shared Caddy configuration. Preserve all other sites and global settings. Back up its current configuration, validate the complete configuration, then reload it using the NAS's established workflow.
6. Create the `blitz.bespoke3d.ai` DNS record using the same ingress convention as existing sites. The shared proxy handles TLS; the inner static service listens privately on port 8080. The site snippet disables HTTP ACME challenges to match the existing TLS-ALPN path; it does not change other sites.

The container runs unprivileged with a read-only filesystem, dropped capabilities, no-new-privileges, bounded logs/resources, and `/tmp` for disposable HOME/XDG/cache files. It configures no certificate or API connection; TLS stays at the existing shared proxy. Image-declared unused volumes may still appear in the NAS GUI. Do not publish its host port on every interface or forward it from the router.

## Verify and roll back

- Confirm valid HTTPS and the expected Blitz Learning page at the public hostname.
- Check `.js` modules use a JavaScript MIME type, CSS/SVG/PNG load, and the demo uses `video/mp4`. Caddy's static server supplies MIME detection and byte ranges; verify a video Range request returns 206.
- Compare deployed asset bytes and SHA-256 hashes against `release.json`. Confirm the container's loopback HTTP healthcheck becomes healthy; it runs every 30 seconds with a 3-second timeout, three retries, and a 5-second startup grace period.
- In a browser, test a quest answer, a hint, tutor selection, a three-answer streak, mobile layout, and the pond's WebGL or authored fallback. Check for console errors and missing assets.
- Confirm Gemini controls remain disabled and no microphone/camera request appears. `/api/health` and arbitrary missing paths must return 404, not the home page.
- Preserve the prior release until verification passes. To roll back, point the single proxy upstream at the previously verified service and validate/reload the shared proxy. Stop or remove only the failed Blitz service after confirming its exact identity; leave other NAS applications unchanged.

This package prepares files; it does not configure DNS, upload to the NAS, start containers, modify the shared proxy, or establish that deployment succeeded. Record actual deployment and verification evidence separately. Stars remain browser-side practice achievements, not secure grading or proof of mastery.
