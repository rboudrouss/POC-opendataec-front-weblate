import { setToken, clearSession } from '../api/client'

export async function signIn(username: string, password: string): Promise<void> {
  const res = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  const data = await res.json() as { token?: string; username?: string; error?: string }

  if (!res.ok || !data.token) {
    throw new Error(data.error ?? 'Identifiants incorrects')
  }

  setToken(data.token)
  sessionStorage.setItem('username', data.username ?? username)
}

export function signOut(): void {
  clearSession()
}

export function isAuthenticated(): boolean {
  return !!sessionStorage.getItem('weblate_token')
}

export function getAuthState(): { username: string | null } {
  return { username: sessionStorage.getItem('username') }
}
