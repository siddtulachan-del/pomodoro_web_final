# Pomodoro Timer

A fast, private Pomodoro timer built with vanilla HTML, CSS, and JavaScript. Timer settings, task labels, and stats stay in browser storage. After the first visit, the static app shell is available offline.

Use **Settings → Data** to export a JSON backup or import one later. Importing a backup replaces the timer data in the current browser.

## Files

- `index.html`, `app.js`, `styles.css` — the app and its timer, settings, and stats views.
- `25-5/`, `50-10/`, `52-17/`, `90-20/` — preset landing pages that reuse the app.
- `sw.js`, `manifest.webmanifest`, `icons/` — offline support, SVG favicons, and PNG install icons.
- `fonts/figtree-latin.woff2` — self-hosted Figtree Latin font.
- `fonts/OFL.txt` — Figtree's SIL Open Font License.
- `robots.txt`, `sitemap.xml`, `404.html`, `_headers` — search and static-host configuration.

## Deploy

There is no build step or package install.

### Cloudflare Pages

Create a Pages project connected to this repository, select **Direct Upload** or the Git integration, set the project root to this folder, and leave the build command empty. Use `.` as the output directory. Upload or deploy the complete folder, including dotfiles such as `_headers`.

### Netlify

Create a new site from this repository or drag the complete folder into Netlify Drop. Set the publish directory to `.` and leave the build command empty. Netlify reads `_headers` from the published folder.

Serve the site over HTTPS (or localhost during development) for notifications, the service worker, and install support.

## Before launch

- Replace every `YOURDOMAIN.com` with the production domain in canonical URLs, Open Graph metadata, structured data, `robots.txt`, and `sitemap.xml`.
- Replace `YOURDOMAIN.com` in the commented Plausible snippet's `data-domain` before enabling it.
