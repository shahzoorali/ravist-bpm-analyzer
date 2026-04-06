'use strict';

const express   = require('express');
const cors      = require('cors');
const Scheduler = require('./scheduler');

const PORT      = process.env.PORT || 3100;

const app       = express();
const scheduler = new Scheduler();

// ── MIDDLEWARE ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── ROUTES ──────────────────────────────────────────────────

/**
 * GET /api/bpm
 * Main endpoint — returns current BPM + track info.
 *
 * The player should use this logic:
 *   1. Poll every 10s
 *   2. When isFinal=false  → show bpm (pass 1), style it as "pending"
 *   3. When isFinal=true   → show bpm (final), full confidence styling
 *
 * Response shape:
 * {
 *   success:      true,
 *   bpm:          124,         // best available right now — show this always
 *   bpmExact:     124.1,       // float with 1dp
 *   pass1Bpm:     124,         // pass 1 result (~38s), null until available
 *   finalBpm:     124.1,       // final result (~68s), null until complete
 *   isFinal:      true,        // false = still analysing, true = all passes done
 *   confidence:   "high",      // high | medium | low | pending
 *   artist:       "System F",
 *   track:        "Out Of The Blue",
 *   genre:        "Electronic",
 *   analyzing:    false,
 *   lastAnalyzed: "2026-04-07T10:23:00.000Z",
 *   passes:       [{ bpm, rawBpm, score }, ...]
 * }
 */
app.get('/api/bpm', (req, res) => {
  const s = scheduler.state;
  res.json({
    success:      true,
    bpm:          s.bpmRounded,
    bpmExact:     s.bpm,
    pass1Bpm:     s.pass1Bpm    ? Math.round(s.pass1Bpm)    : null,
    pass1BpmExact: s.pass1Bpm   ? s.pass1Bpm                : null,
    finalBpm:     s.finalBpm    ? Math.round(s.finalBpm)    : null,
    finalBpmExact: s.finalBpm   ? s.finalBpm                : null,
    isFinal:      s.isFinal,
    confidence:   s.confidence,
    artist:       s.artist,
    track:        s.track,
    genre:        s.genre,
    analyzing:    s.analyzing,
    lastAnalyzed: s.lastAnalyzed,
    passes:       s.passes,
  });
});

/**
 * GET /api/bpm/status
 * Health check — is the analyzer running and healthy?
 */
app.get('/api/bpm/status', (req, res) => {
  res.json({
    success:    true,
    healthy:    true,
    analyzing:  scheduler.state.analyzing,
    uptime:     Math.round(process.uptime()),
    streamUrl:  'https://stream.ravist.in/',
    metaUrl:    'https://api.ravist.in/api/radio/metadata',
  });
});

/**
 * POST /api/bpm/analyze
 * Manually trigger a fresh analysis (useful for testing or admin panel).
 */
app.post('/api/bpm/analyze', (req, res) => {
  if (scheduler.state.analyzing) {
    return res.json({ success: false, message: 'Analysis already in progress.' });
  }
  scheduler._runAnalysis();
  res.json({ success: true, message: 'Analysis triggered. Poll /api/bpm for results.' });
});

// ── 404 ─────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found.' });
});

// ── START ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n┌─────────────────────────────────────────┐`);
  console.log(`│  Ravist Radio — BPM Service             │`);
  console.log(`│  Listening on port ${PORT}               │`);
  console.log(`│                                         │`);
  console.log(`│  GET  /api/bpm          → current BPM   │`);
  console.log(`│  GET  /api/bpm/status   → health check  │`);
  console.log(`│  POST /api/bpm/analyze  → manual trigger│`);
  console.log(`└─────────────────────────────────────────┘\n`);
  scheduler.start();
});

// ── GRACEFUL SHUTDOWN ────────────────────────────────────────
process.on('SIGTERM', () => { scheduler.stop(); process.exit(0); });
process.on('SIGINT',  () => { scheduler.stop(); process.exit(0); });
