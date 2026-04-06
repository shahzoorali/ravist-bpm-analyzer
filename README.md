# Ravist Radio — BPM Service

Real-time BPM detection for your live radio stream.
Taps `stream.ravist.in`, analyses with `music-tempo` via ffmpeg PCM pipe, exposes a JSON API.

---

## Requirements

- Node.js 18+
- ffmpeg installed (`apt install ffmpeg`)
- PM2 for process management (`npm install -g pm2`)

---

## Install

```bash
git clone <your-repo>
cd ravist-bpm-service
npm install
```

---

## Run (development)

```bash
node server.js
```

---

## Run (production with PM2)

```bash
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # auto-start on reboot
```

---

## API Endpoints

### `GET /api/bpm`
Returns current BPM and track info. Poll this every 10–15 seconds from your radio player.

```json
{
  "success": true,
  "bpm": 128,
  "bpmExact": 128.4,
  "confidence": "high",
  "artist": "Above & Beyond",
  "track": "React [Extended Mix]",
  "genre": "Electronic",
  "analyzing": false,
  "lastAnalyzed": "2026-04-07T10:23:00.000Z",
  "passes": [
    { "bpm": 128.0, "score": 327 },
    { "bpm": 128.0, "score": 332 },
    { "bpm": 128.1, "score": 265 }
  ]
}
```

> `bpm` is `null` on first start until the initial analysis completes (~90s).

### `GET /api/bpm/status`
Health check.

```json
{
  "success": true,
  "healthy": true,
  "analyzing": false,
  "uptime": 3600,
  "streamUrl": "https://stream.ravist.in/"
}
```

### `POST /api/bpm/analyze`
Manually trigger a fresh 3-pass analysis. Useful for testing.

```bash
curl -X POST https://your-vps/api/bpm/analyze
```

---

## How It Works

```
stream.ravist.in (MP3)
  └── ffmpeg (decode → 44100Hz mono f32le PCM, 30s)
        └── music-tempo (onset detection → BPM)
              └── 3 passes averaged → confidence scored
                    └── Express API → /api/bpm
                          └── Radio player overlay polls every 10s
```

**Trigger logic:**
- On start → analyse immediately
- On track change (detected via metadata API poll every 15s) → wait 8s for new track to establish, then analyse
- Every 3 minutes → re-analyse regardless (catches mid-track BPM shifts on some sets)

---

## Adding BPM to Your Radio Player Overlay

In your `ravist_radio_live_overlay.html`, add this alongside the existing `fetchMeta()` call:

```javascript
const BPM_API = 'https://your-vps-or-domain:3100/api/bpm';

async function fetchBPM() {
  try {
    const res  = await fetch(BPM_API);
    const json = await res.json();
    if (json.success && json.bpm) {
      document.getElementById('stat-bpm').textContent = json.bpm;
      // Optional: colour the BPM red if confidence is low
      const el = document.getElementById('stat-bpm');
      el.style.color = json.confidence === 'high' ? 'var(--cyan)' :
                       json.confidence === 'medium' ? 'var(--purple)' : '#ff2d78';
    }
  } catch(e) {}
}

fetchBPM();
setInterval(fetchBPM, 10_000); // poll every 10s
```

---

## Nginx Reverse Proxy (optional, recommended)

To expose it cleanly as `api.ravist.in/api/bpm` alongside your existing API:

```nginx
location /api/bpm {
  proxy_pass         http://127.0.0.1:3100;
  proxy_http_version 1.1;
  proxy_set_header   Host $host;
  proxy_set_header   X-Real-IP $remote_addr;
}
```

---

## Tuning

| Setting | File | Default | Notes |
|---|---|---|---|
| Capture window | `analyzer.js` | 30s | Increase to 45s for more accuracy on slow-building tracks |
| Analysis passes | `scheduler.js` | 3 | Increase to 5 for higher confidence, adds ~2.5 min per analysis |
| Re-analyse interval | `scheduler.js` | 3 min | Lower to 2 min for faster updates |
| Meta poll interval | `scheduler.js` | 15s | Lower to 10s to catch track changes faster |
