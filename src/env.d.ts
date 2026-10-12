/// <reference types="vite/client" />
declare const __BUILD_TIME__: string;
interface ImportMetaEnv {
  /** A GameRelay public key: online lobbies. */
  readonly VITE_GAMERELAY_KEY?: string;
  /** The GameRelay server (default https://gamerelay.io). */
  readonly VITE_GAMERELAY_URL?: string;
  /** Where the soundtrack's tracks are (a base URL), when they aren't in the page's own `music/`. */
  readonly VITE_MUSIC_URL?: string;
}
