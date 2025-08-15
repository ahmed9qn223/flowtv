# Deploy Flow TV to GitHub Pages (Free)

**What works on pure GitHub Pages**
- Static files: `index.html`, `style.css`, `script.ghpages.js`, `channels.json`
- HLS playback via Hls.js (client-side)
- Categories, grid UI, player controls, "resume last channel"

**What doesn't (because GH Pages has no PHP/server)**
- `get_channel.php`, `get_channel_list.php`, `get_viewers.php`, `heartbeat.php`
- AES encryption of stream URLs done on the server
- Live viewer counter

## Quick Start
1. Create a public repo named **flow-tv** (or any name).
2. Copy these files into the repo root:
   - `index.html` (you can rename this `index.ghpages.html` to `index.html`)
   - `style.css`
   - `script.ghpages.js`
   - `channels.json`
3. Commit & push.
4. In **Settings → Pages**, select **Deploy from branch**, branch `main`, folder `/root`. Save.
5. Wait until the site builds, then open: `https://<username>.github.io/<repo>/`

> Tip: Editing `channels.json` updates the channel list instantly (no build step).

## Important Notes
- Because it is fully static, any streams that **require special headers** (Referer / User-Agent) or block cross-origin requests **may not play** directly. To fix this later, add a free proxy on **Cloudflare Workers** and point your URLs to it.
- If you want **viewer counters** or **URL hiding**, you need a tiny free serverless backend. See below.

## (Optional) Upgrade Path (still free)
- **Cloudflare Workers** (free) for:
  - `/api/get_channel` → returns a proxied stream URL or short-lived token
  - `/api/heartbeat` + `/api/get_viewers` → presence tracking (KV/Durable Objects)
- **Vercel / Netlify Functions** or **Firebase** can also be used.

When you add a backend later, update `script.ghpages.js` to call those endpoints.
