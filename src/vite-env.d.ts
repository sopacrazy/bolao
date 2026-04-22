/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APIFOOTBALL_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
