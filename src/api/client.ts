const BASE = '/api'

export function getToken(): string | null {
  return sessionStorage.getItem('weblate_token')
}

export function setToken(token: string): void {
  sessionStorage.setItem('weblate_token', token)
}

export function clearSession(): void {
  sessionStorage.removeItem('weblate_token')
  sessionStorage.removeItem('username')
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const method = (options.method ?? 'GET').toUpperCase()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Token ${token}` } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  }
  // DRF requires CSRF for session auth mutations — token auth is exempt
  const _ = SAFE // silence unused warning

  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status}: ${text}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export async function customFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Token ${token}` } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  }
  const res = await fetch(path, { ...options, headers })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status}: ${text}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export async function fetchAll<T>(path: string): Promise<T[]> {
  const results: T[] = []
  let url: string | null = `${BASE}${path}${path.includes('?') ? '&' : '?'}page_size=200`
  while (url) {
    const token = getToken()
    const res = await fetch(url, {
      headers: token ? { Authorization: `Token ${token}` } : {},
    })
    if (!res.ok) throw new Error(`${res.status}`)
    const data = (await res.json()) as { results: T[]; next: string | null }
    results.push(...data.results)
    url = data.next ? new URL(data.next).pathname + new URL(data.next).search : null
  }
  return results
}
