'use strict';

const axios        = require('axios');
const Analyzer     = require('./analyzer');
const EventEmitter = require('events');

const META_URL         = 'https://api.ravist.in/api/radio/metadata';
const META_POLL_MS     = 15_000;     // check for track changes every 15s
const ANALYSIS_PASSES  = 2;          // 2 passes × 30s = ~68s total (down from 98s)
const REANALYZE_MS     = 3 * 60_000; // re-analyse every 3 min even if track hasn't changed

class Scheduler extends EventEmitter {
  constructor() {
    super();

    // Current state — served by the API
    this.state = {
      bpm:          null,
      bpmRounded:   null,
      confidence:   null,   // 'high' | 'medium' | 'low'
      artist:       null,
      track:        null,
      genre:        null,
      lastAnalyzed: null,
      analyzing:    false,
      passes:       [],     // raw pass results for transparency
    };

    this._metaTimer     = null;
    this._reanalyzeTimer = null;
    this._currentTrack  = null;
    this._analyzer      = new Analyzer();
    this._busy          = false;
  }

  // ── PUBLIC ────────────────────────────────────────────────

  start() {
    console.log('[Scheduler] Starting…');
    this._pollMeta();
    this._metaTimer = setInterval(() => this._pollMeta(), META_POLL_MS);
  }

  stop() {
    clearInterval(this._metaTimer);
    clearTimeout(this._reanalyzeTimer);
    this._analyzer.kill();
    console.log('[Scheduler] Stopped.');
  }

  // ── INTERNAL ──────────────────────────────────────────────

  async _pollMeta() {
    try {
      const { data } = await axios.get(META_URL, { timeout: 5000 });
      if (!data.success) return;

      const { artist, track, genre } = data.data;
      const trackId = `${artist}|${track}`;

      // Update metadata in state immediately (even before BPM is ready)
      this.state.artist = artist;
      this.state.track  = track;
      this.state.genre  = genre;

      if (trackId !== this._currentTrack) {
        console.log(`[Scheduler] Track changed → ${artist} - ${track}`);
        this._currentTrack = trackId;
        // Slight delay so the new track's beat is established in the stream
        setTimeout(() => this._runAnalysis(), 8000);
      }
    } catch (err) {
      console.warn('[Scheduler] Meta fetch failed:', err.message);
    }
  }

  async _runAnalysis() {
    if (this._busy) {
      console.log('[Scheduler] Analysis already running, skipping.');
      return;
    }

    this._busy          = true;
    this.state.analyzing = true;
    this.emit('analyzing');

    const passes = [];
    console.log(`[Scheduler] Starting ${ANALYSIS_PASSES}-pass analysis…`);

    for (let i = 1; i <= ANALYSIS_PASSES; i++) {
      try {
        const result = await this._analyzer.analyze();
        passes.push(result);
        console.log(`[Scheduler]   Pass ${i}: ${result.bpm} BPM (raw: ${result.rawBpm}, score: ${result.score})`);

        // ── Emit after pass 1 so the API has something immediately ──
        if (i === 1) {
          this.state.bpm          = result.bpm;
          this.state.bpmRounded   = Math.round(result.bpm);
          this.state.confidence   = 'pending'; // signal more passes coming
          this.state.lastAnalyzed = new Date().toISOString();
          this.state.passes       = [{ bpm: result.bpm, rawBpm: result.rawBpm, score: result.score }];
          this.emit('bpm', this.state);
          console.log(`[Scheduler]   → Early emit: ${result.bpm} BPM (pending final)`);
        }
      } catch (err) {
        console.warn(`[Scheduler]   Pass ${i} failed:`, err.message);
      }
    }

    if (passes.length > 0) {
      // ── Pick the highest-score pass ────────────────────────────────────────
      // music-tempo's score reflects how cleanly the algorithm locked onto a
      // beat grid. In every real test, the highest-score pass matched the true
      // BPM — averaging or median logic gets confused by octave errors, but
      // the score cuts through them directly.
      const best    = passes.reduce((a, b) => (b.score > a.score ? b : a));
      const bpm     = best.bpm;
      const rounded = Math.round(bpm);

      // Confidence derived from the winning score threshold (tuned from test data)
      const confidence = best.score >= 250 ? 'high'
                       : best.score >= 150 ? 'medium'
                       : 'low';

      this.state.bpm          = bpm;
      this.state.bpmRounded   = rounded;
      this.state.confidence   = confidence;
      this.state.lastAnalyzed = new Date().toISOString();
      this.state.passes       = passes.map(p => ({ bpm: p.bpm, rawBpm: p.rawBpm, score: p.score }));

      console.log(`[Scheduler] ✓ Final BPM: ${bpm} (${confidence} confidence, winning score: ${best.score})`);
      this.emit('bpm', this.state);
    } else {
      console.warn('[Scheduler] All passes failed.');
    }

    this.state.analyzing = false;
    this._busy           = false;

    // Schedule re-analysis in 3 minutes regardless of track change
    clearTimeout(this._reanalyzeTimer);
    this._reanalyzeTimer = setTimeout(() => this._runAnalysis(), REANALYZE_MS);
  }
}

module.exports = Scheduler;
