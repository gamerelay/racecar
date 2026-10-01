// The recorded soundtrack: one track for the title and menus, and one per map in a race. Each is a
// looping, streamed <audio> element played through the music bus (so N, M, the slow-mo duck and the
// level all apply to it). A track that can't load (not hosted where the page is, say) falls back to
// the synth music (music.ts), the same as before there were tracks.

/** The tracks, by name: `title`, and each map's id. */
export const TRACKS = ['title', 'downtown', 'backroads', 'paradise'] as const;
export type TrackName = (typeof TRACKS)[number];

/** The page's track: the title's behind the menus (attract mode), else the map's (or none). */
export function trackFor(mapId: string, attract: boolean): TrackName | null {
  if (attract) return 'title';
  return (TRACKS as readonly string[]).includes(mapId) ? (mapId as TrackName) : null;
}

/** Where a track is: `base` (`VITE_MUSIC_URL`, for a build hosted without the music beside it) or the page's own `music/`. */
export function trackUrl(name: TrackName, base: string): string {
  return `${base.endsWith('/') ? base : base + '/'}${name}.m4a`;
}

export class Soundtrack {
  readonly el: HTMLAudioElement;
  /** It couldn't load (or play): the synth plays instead. */
  failed = false;
  private source?: MediaElementAudioSourceNode;

  constructor(url: string) {
    const el = new Audio();
    // Another origin's track is heard through Web Audio only with CORS; without it, an error (and
    // the synth) rather than silence.
    el.crossOrigin = 'anonymous';
    el.loop = true;
    el.preload = 'auto';
    el.src = url;
    el.addEventListener('error', () => (this.failed = true));
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

  play(): void {
    if (this.failed || !this.source || !this.el.paused) return;
    this.el.play().catch((err: unknown) => {
      // Not allowed yet (no gesture) is tried again next frame; a file it can't play isn't.
      if ((err as { name?: string })?.name === 'NotSupportedError') this.failed = true;
    });
  }

  pause(): void {
    if (!this.el.paused) this.el.pause();
  }
}
