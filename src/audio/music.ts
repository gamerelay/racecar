// The soundtrack: a small synthwave sequencer (Am–F–C–G at 112 bpm), scheduled a quarter second
// ahead on the audio clock so it never drifts with the frame rate. Intensity picks the layers: the
// menu gets pad and bass, a race adds drums and an arpeggio, the final lap doubles the arp up an
// octave. The music bus's filter and level are the renderer's business (ducked in slow-mo).

import { noiseShot, note, toneShot, type Shot } from './synth';

const BPM = 112;
const STEP = 60 / BPM / 4;
/** One bar per chord: its tones in semitones from A4, and the bass root. */
const CHORDS: { tones: number[]; root: number }[] = [
  { tones: [0, 3, 7], root: -24 },
  { tones: [-4, 0, 3], root: -28 },
  { tones: [3, 7, 10], root: -21 },
  { tones: [-2, 2, 5], root: -26 },
];
/** The arp walks up and back down the chord over two octaves. */
const ARP = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5];
const BASS = [0, -1, 12, -1, 0, -1, 0, 12, 0, -1, 12, -1, 0, 12, 0, -1];

export type Intensity = 0 | 1 | 2;

export class Music {
  private next = 0;
  private step = 0;
  intensity: Intensity = 0;
  private readonly shot: Shot;

  constructor(
    private readonly ctx: AudioContext,
    bus: AudioNode,
  ) {
    this.shot = { ctx, bus, gain: 0, pan: 0 };
  }

  /** Schedules everything due in the next quarter second. Call every frame. */
  update(): void {
    const now = this.ctx.currentTime;
    // Back from a hidden tab or a suspend: pick up from now rather than playing the backlog.
    if (this.next < now - 0.1) this.next = now + 0.05;
    while (this.next < now + 0.25) {
      this.play(this.step, this.next);
      this.next += STEP;
      this.step = (this.step + 1) % (16 * CHORDS.length);
    }
  }

  private play(step: number, t: number): void {
    const s = this.shot;
    const chord = CHORDS[Math.floor(step / 16)];
    const i = step % 16;
    const hit = (gain: number, pan = 0) => {
      s.gain = gain;
      s.pan = pan;
      return s;
    };
    // Pad: the chord, held for the bar.
    if (i === 0) for (const [k, tone] of chord.tones.entries()) toneShot(hit(0.045, (k - 1) * 0.4), 'sawtooth', note(tone - 12), note(tone - 12), 0.5, 1.6, t);
    // Bass: eighths on the root, jumping the octave.
    const b = BASS[i];
    if (b >= 0) toneShot(hit(0.16), 'sawtooth', note(chord.root + b), note(chord.root + b), 0.005, 0.14, t);
    if (this.intensity === 0) return;
    // Drums: four on the floor, snare on two and four, off-beat hats.
    if (i % 4 === 0) toneShot(hit(0.5), 'sine', 150, 42, 0.002, 0.22, t);
    if (i === 4 || i === 12) {
      noiseShot(hit(0.18), 'bandpass', 1900, 1200, 0.002, 0.14, 0.8, t);
      toneShot(hit(0.08), 'triangle', 200, 160, 0.002, 0.08, t);
    }
    if (i % 4 === 2 || (this.intensity === 2 && i % 2 === 1)) noiseShot(hit(0.05, 0.3), 'highpass', 8000, 8000, 0.001, 0.035, 1, t);
    // Arp: sixteenths up the chord.
    const n = ARP[i];
    const tone = chord.tones[n % 3] + 12 * Math.floor(n / 3) - 12 + (this.intensity === 2 ? 12 : 0);
    toneShot(hit(0.05, i % 2 ? 0.35 : -0.35), 'triangle', note(tone), note(tone), 0.003, 0.11, t);
  }
}
