// The recorded soundtrack: the title's tracks behind the menus, and in a race a playlist of the
// map's own tracks and the eight that go anywhere, so the same song never plays twice in a row (from
// one race to the next either). A streamed <audio> element played through the music bus (so N, M,
// the slow-mo duck and the level all apply to it). A track that can't load (not hosted where the
// page is, say) falls back to the synth music (music.ts), the same as before there were tracks.

/** The tracks, by name: the title's, each map's own, and the seven any race may play. */
export const TRACKS = ['title', 'pursuit-orchestra', 'downtown', 'tokyo-dubstep', 'backroads', 'backroads-acoustic', 'paradise', 'hawaiian-vibes', 'coastal', 'avalanche', 'winter-pursuit', 'finish-line', 'final-sprint', 'relentless-pursuit', 'half-time-surge', 'propulsion', 'escape', 'forward', 'crashout'] as const;
export type TrackName = (typeof TRACKS)[number];
/** Behind the menus (the attract page): the title's own, and the orchestral one (the owner's, 2026-10-02). */
export const TITLE_TRACKS: readonly TrackName[] = ['title', 'pursuit-orchestra'];
/** Tracks for any map's race (`relentless-pursuit` and `half-time-surge`, the owner's, 2026-10-02; `propulsion`, `escape` and `forward`, 2026-10-03; `crashout`, 2026-10-05). */
export const ANY_MAP: readonly TrackName[] = ['finish-line', 'final-sprint', 'relentless-pursuit', 'half-time-surge', 'propulsion', 'escape', 'forward', 'crashout'];
/**
 * Each map's own tracks: the city has the Tokyo dubstep too, the island the Hawaiian one (2026-10-01)
 * and the coastal one (2026-10-03), the valley an acoustic one (2026-10-02), the mountain its two
 * (2026-10-03). Paradise Open is the island too, so it has the island's. Coastal has the coastal
 * one (2026-10-04; `forward` plays on every map).
 */
export const MAP_TRACKS: Readonly<Record<string, readonly TrackName[]>> = {
  downtown: ['downtown', 'tokyo-dubstep'],
  backroads: ['backroads', 'backroads-acoustic'],
  paradise: ['paradise', 'hawaiian-vibes', 'coastal'],
  'paradise-open': ['paradise', 'hawaiian-vibes', 'coastal'],
  avalanche: ['avalanche', 'winter-pursuit'],
  coastal: ['coastal'],
};

/** The page's playlist: the title's behind the menus (attract mode), else the map's own and the eight for any map. */
export function playlistFor(mapId: string, attract: boolean): TrackName[] {
  if (attract) return [...TITLE_TRACKS];
  return [...(Object.hasOwn(MAP_TRACKS, mapId) ? MAP_TRACKS[mapId] : []), ...ANY_MAP];
}

/** A track from the playlist other than `last` (unless it's the only one). */
export function pickTrack(list: readonly TrackName[], last: string | null, rand: () => number = Math.random): TrackName {
  const fresh = list.length > 1 ? list.filter((t) => t !== last) : list;
  return fresh[Math.floor(rand() * fresh.length) % fresh.length];
}

/** Where a track is: `base` (`VITE_MUSIC_URL`, for a build hosted without the music beside it) or the page's own `music/`. */
export function trackUrl(name: TrackName, base: string): string {
  return `${base.endsWith('/') ? base : base + '/'}${name}.m4a`;
}

/** This many plays from gestures refused in a row, and it's the synth's. */
const REFUSALS = 3;

export class Soundtrack {
  readonly el: HTMLAudioElement;
  /** It couldn't load (or play): the synth plays instead. */
  failed = false;
  /** What's playing (or about to). */
  current: TrackName;
  private source?: MediaElementAudioSourceNode;
  /** Plays from gestures refused since the last one that started. */
  private refused = 0;

  constructor(
    private readonly list: readonly TrackName[],
    private readonly base: string,
    /** The race track the last page played (so this one starts on another), and where to say which this is. */
    private readonly memory: { last: string | null; remember: (t: TrackName) => void } = { last: null, remember: () => {} },
    rand: () => number = Math.random,
  ) {
    const el = new Audio();
    // Another origin's track is heard through Web Audio only with CORS; without it, an error (and
    // the synth) rather than silence.
    el.crossOrigin = 'anonymous';
    // One track loops; a playlist goes on to another when each ends.
    el.loop = list.length === 1;
    el.preload = 'auto';
    this.current = pickTrack(list, memory.last, rand);
    el.src = trackUrl(this.current, base);
    el.addEventListener('error', () => {
      this.failed = true;
      console.warn(`[racecar] the soundtrack's ${this.current} track can't play (${el.error?.message || `media error ${el.error?.code}`}); the synth plays instead`);
    });
    el.addEventListener('ended', () => {
      this.current = pickTrack(this.list, this.current, rand);
      el.src = trackUrl(this.current, this.base);
      this.tried = -Infinity;
      this.play();
    });
    el.addEventListener('playing', () => this.memory.remember(this.current));
    this.el = el;
  }

  /** Into the music bus, once the context exists (the first gesture). */
  connect(ctx: AudioContext, bus: AudioNode): void {
    if (this.source) return;
    try {
      this.source = ctx.createMediaElementSource(this.el);
      this.source.connect(bus);
    } catch (err) {
      this.failed = true;
      console.warn('[racecar] the soundtrack could not join the audio graph; the synth plays instead', err);
    }
  }

  /**
   * Plays it. `gesture`: from a key or click, the only time some browsers (iOS Safari among them)
   * start media; refused there a few times over, the synth takes over. From a frame it's tried at
   * most once a second, and a refusal there is just "not yet". A file it can't play: the synth, at once.
   */
  play(gesture = false): void {
    if (this.failed || !this.source || !this.el.paused || this.pending) return;
    const now = performance.now();
    if (!gesture && now - this.tried < 1000) return;
    this.tried = now;
    this.pending = true;
    this.el.play().then(
      () => {
        this.pending = false;
        this.refused = 0;
      },
      (err: unknown) => {
        this.pending = false;
        const name = (err as { name?: string })?.name;
        if (name === 'NotSupportedError' || (gesture && name === 'NotAllowedError' && ++this.refused >= REFUSALS)) {
          this.failed = true;
          console.warn(`[racecar] the browser won't play the soundtrack (${name}); the synth plays instead`, err);
        } else if (gesture) console.warn(`[racecar] the soundtrack's play was refused (${name})`, err);
      },
    );
  }
  /** A play on its way (one at a time), and when the last was tried. */
  private pending = false;
  private tried = -Infinity;

  pause(): void {
    if (!this.el.paused) this.el.pause();
  }
}
