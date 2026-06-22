/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL del API del Workshop (Cloudflare Worker). Sin definir → Workshop offline. */
  readonly VITE_WORKSHOP_API?: string;
}
