/// <reference types="vite/client" />

/** Variables d'environnement lues par le front (`src/api/client.ts`), toutes facultatives. */
interface ImportMetaEnv {
  /** URL complète de l'API (ex. http://192.168.1.10:8000) : remplace le proxy `/api`. */
  readonly VITE_API_URL?: string
  /** Port de l'API FastAPI quand le front est ouvert par IP en LAN (défaut 8000). */
  readonly VITE_API_PORT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
