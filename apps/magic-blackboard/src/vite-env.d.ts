/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_DEV_CONSOLE?: '0' | '1';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
