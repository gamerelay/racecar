/// <reference types="vite/client" />
declare const __BUILD_TIME__: string;
interface ImportMetaEnv {
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
}
