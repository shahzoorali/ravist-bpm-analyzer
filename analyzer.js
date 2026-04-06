'use strict';

const { spawn }      = require('child_process');
const MusicTempo     = require('music-tempo');
const EventEmitter   = require('events');

const STREAM_URL       = 'https://stream.ravist.in/';
const SAMPLE_RATE      = 44100;
const CAPTURE_SECS     = 30;
const BYTES_PER_SAMPLE = 4; // f32le = 4 bytes

// Genre range for Ravist Radio — electronic / progressive house
// Upper bound 163 so that double-time artifacts like 164+ get folded down.
const BPM_MIN = 110;
const BPM_MAX = 163;

/**
 * Fold a raw BPM reading into the expected genre range.
 * Fixes the classic octave error where the algorithm locks onto
 * half-time (e.g. 77) or double-time (e.g. 164) instead of the
 * true tempo (123).
 *
 *   77.0 BPM → ×2 → 154   (within 110–160 ✓)
 *  164.4 BPM → ÷2 → 82.2  → out of range → ×2 back → 164 vs mid(135), try ×1 = 164 closer? no,
 *                             pick from ALL multiples scored by distance to mid
 *  123.0 BPM → unchanged  ✓
 *
 * Strategy: generate multiples ÷4 through ×4, prefer those inside range,
 * break ties by proximity to the genre midpoint (135 BPM for electronic).
 */
function normalizeBPM(bpm) {
  const mid = (BPM_MIN + BPM_MAX) / 2; // 135 for 110–160

  // All reasonable multiples
  const multiples = [bpm / 4, bpm / 2, bpm, bpm * 2, bpm * 4]
    .filter(v => v > 0)
    .map(v => Math.round(v * 10) / 10);

  // Score each: in-range candidates get a big bonus, then sort by closeness to mid
  const scored = multiples.map(v => ({
    v,
    score: (v >= BPM_MIN && v <= BPM_MAX ? 1000 : 0) - Math.abs(v - mid),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0].v;
}

class Analyzer extends EventEmitter {
  constructor() {
    super();
    this._ffmpeg  = null;
    this._running = false;
  }

  /**
   * Capture CAPTURE_SECS of audio from the stream,
   * run BPM detection, return { bpm, score, duration }.
   * Rejects on ffmpeg error or no data.
   */
  analyze() {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let  received = 0;

      const ff = spawn('ffmpeg', [
        '-reconnect',          '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max','5',
        '-user_agent',         'Mozilla/5.0',
        '-i',                  STREAM_URL,
        '-t',                  String(CAPTURE_SECS),
        '-ar',                 String(SAMPLE_RATE),
        '-ac',                 '1',
        '-f',                  'f32le',
        'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      this._ffmpeg = ff;

      ff.stdout.on('data', chunk => {
        chunks.push(chunk);
        received += chunk.length;
      });

      ff.stderr.on('data', () => {}); // suppress ffmpeg logs

      ff.on('close', code => {
        this._ffmpeg = null;

        if (received < SAMPLE_RATE * 10 * BYTES_PER_SAMPLE) {
          return reject(new Error(`Not enough audio data (got ${received} bytes, code ${code})`));
        }

        try {
          const buf      = Buffer.concat(chunks);
          const floats   = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
          const mt       = new MusicTempo(floats, { sampleRate: SAMPLE_RATE });
          const rawBpm   = Math.round(mt.tempo * 10) / 10;
          const bpm      = normalizeBPM(rawBpm);
          const score    = mt.bestAgent ? Math.round(mt.bestAgent.score) : null;
          resolve({ bpm, rawBpm, score, samples: floats.length });
        } catch (err) {
          reject(err);
        }
      });

      ff.on('error', reject);
    });
  }

  kill() {
    if (this._ffmpeg) {
      this._ffmpeg.kill('SIGTERM');
      this._ffmpeg = null;
    }
  }
}

module.exports = Analyzer;
