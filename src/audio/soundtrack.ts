// The recorded soundtrack: the title's track behind the menus, and in a race a playlist of the
// map's own track and the two that go anywhere, so the same song never plays twice in a row (from
// one race to the next either). A streamed <audio> element played through the music bus (so N, M,
// the slow-mo duck and the level all apply to it). A track that can't load (not hosted where the
// page is, say) falls back to the synth music (music.ts), the same as before there were tracks.

/** The tracks, by name: `title`, each map's id, and the two any race may play. */
export const TRACKS = ['title', 'downtown', 'backroads', 'paradise', 'finish-line', 'final-sprint'] as const;
export type TrackName = (typeof TRACKS)[number];
/** Tracks for any map's race. */
export const ANY_MAP: readonly TrackName[] = ['finish-line', 'final-sprint'];

/** The page's playlist: the title's alone behind the menus (attract mode), else the map's own and the two for any map. */
export function playlistFor(mapId: string, attract: boolean): TrackName[] {
  if (attract) return ['title'];
  const own = (TRACKS as readonly string[]).includes(mapId) && !ANY_MAP.includes(mapId as TrackName) && mapId !== 'title' ? [mapId as TrackName] : [];
  return [...own, ...ANY_MAP];
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
    el.addEventListener('error', () => (this.failed = true));
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
    } catch {
      this.failed = true;
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
        if (name === 'NotSupportedError' || (gesture && name === 'NotAllowedError' && ++this.refused >= REFUSALS)) this.failed = true;
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
