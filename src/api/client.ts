/** Client HTTP vers l'API FastAPI (proxy Vite `/api` en local, URL directe en LAN). */

const TOKEN_KEY = 'microfinance-token-v1'
const API_PORT = import.meta.env.VITE_API_PORT ?? '8000'

/** URL complète d'un chemin `/api/...` (proxy localhost, direct en IP LAN). */
export function apiUrl(path: string): string {
  const p = path.startsWith('/api') ? path : `/api${path}`
  const override = import.meta.env.VITE_API_URL?.replace(/\/$/, '')
  if (override) return `${override}${p}`
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:${API_PORT}${p}`
    }
  }
  return p
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token)
  else sessionStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body?.detail === 'string') return body.detail
    if (Array.isArray(body?.detail)) {
      return body.detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join(', ')
    }
    if (typeof body?.erreur === 'string') return body.erreur
  } catch {
    /* ignore */
  }
  return res.statusText || 'Erreur réseau'
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(apiUrl(path), {
    ...options,
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
  })

  if (!res.ok) {
    throw new ApiError(await parseError(res), res.status)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
