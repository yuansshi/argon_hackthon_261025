# NAS public practice deployment

Live: [Blitz Learning](https://blitz.bespoke3d.ai/). This serves the same browser-only practice as GitHub Pages: four math quests, original guides, authored hints, local stars, and the demo MP4. Gemini chat, microphone and camera stay disabled. No credential or Node.js relay belongs in this public container.

## Verified deployment receipt

Verified **2026-10-25 PDT**, using release `20261025-a7cef04`, source `a7cef04`, and immutable image `blitz-practice:20261025-a7cef04`:

- Container healthy; all **119 offline tests pass**.
- Public HTTPS has valid TLS and returns 200. All **19/19 public files** match the release manifest's byte counts and SHA-256 hashes.
- JavaScript modules have the correct MIME type. The MP4 is `video/mp4`; a byte-range request returns **206** with matching content.
- API routes and an unknown path return **404**. Security headers disable microphone/camera and outbound application connections; the public deployment has no Gemini backend.
- Existing Bespoke, Bubble, Chores and Skywing public homepages all still return **200**. The empty-body Chores setup request remains denied with **403**.

These checks describe the deployed release on that date, not a claim of continuous monitoring or production readiness. No learner camera or microphone was used for deployment verification.

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

The archive contains one `blitz-RELEASE/` directory: `site/`, `compose.yaml`, `Caddyfile`, `proxy-site.Caddyfile`, `Dockerfile`, `.dockerignore`, and `release.json`. The manifest records each public file's path, byte count, and SHA-256 digest for deployment verification. The archive contains no dependencies, backend, credential helpers, API keys, original lecture, or private learner media. Static assets build locally and are architecture-neutral.

The NAS builds an immutable local `blitz-practice:RELEASE` image from the established official `caddy:2.11.4-alpine` image. It copies Caddy to a fresh executable inode without file-capability xattrs, and bakes the public site and inner Caddy configuration into the image. Build-time permissions are 755 for site directories and 644 for site/configuration files; these changes affect the image only, not NAS ACLs. No packages or application dependencies are installed. If `getcap` is available, the build asserts that the copied binary has no file capabilities. The entrypoint runs that binary as UID/GID 1000 on unprivileged port 8080. `.dockerignore` allows only the Dockerfile, inner configuration and public site into the build context.

## Deploy through the NAS GUI

1. Upload and extract into a dedicated versioned deployment folder, away from other applications. Confirm the extracted `compose.yaml`, `Dockerfile`, `.dockerignore`, `Caddyfile` and `site/` share that folder.
2. Leave NAS folder permissions and ACLs unchanged. The NAS image builder reads the public context; the Dockerfile normalizes permissions inside the image. The runtime container does not bind-mount the extracted folder.
3. Create a Compose application from that release folder and build its release-specific local image. The build context is only this public release. Do not add site/configuration bind mounts, host-root, Docker-socket, credential or shared proxy mounts.
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

The package command only prepares files; it does not configure DNS, upload to the NAS, start containers or modify the shared proxy. The receipt above records the separately completed deployment and verification. Stars remain browser-side practice achievements, not secure grading or proof of mastery.

## Runtime compatibility lessons

The first NAS attempt using the official binary directly failed before configuration parsing with `exec /usr/bin/caddy: operation not permitted`. That binary's privileged-port file capability conflicts with the deliberately empty capability bounding set. The release-specific copied binary avoids that capability request; its startup succeeded on the NAS without weakening runtime hardening.

The next check returned HTTP 403: NAS archive extraction made the bind-mounted site directory root-owned with mode 700, so UID 1000 could not read it. The immutable image includes public assets and configuration with explicit build-time permissions, removing both bind mounts without changing NAS permissions or ACLs. Runtime `cap_drop: ALL`, `no-new-privileges`, the non-root user, read-only root and no-exec temporary mount remain enabled. The replacement image was built, passed its healthcheck, and was verified through public HTTPS as recorded above. Do not solve either failure with extra capabilities or privileged mode; offline tests alone cannot establish deployment success.
