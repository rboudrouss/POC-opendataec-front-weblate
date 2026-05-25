import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { signIn } from '../store/auth'
import { createUser } from '../api/weblate'

type Tab = 'login' | 'register'

export function LoginPage() {
  const [tab, setTab] = useState<Tab>('login')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const fd = new FormData(e.currentTarget)
    try {
      await signIn(fd.get('username') as string, fd.get('password') as string)
      navigate({ to: '/editor' })
    } catch (err) {
      setError('Identifiants incorrects')
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const fd = new FormData(e.currentTarget)
    const email = fd.get('email') as string
    const first = fd.get('first') as string
    const last = fd.get('last') as string
    const password = fd.get('password') as string
    try {
      await createUser({ username: email, email, full_name: `${first} ${last}`, password })
      setError('')
      setTab('login')
    } catch {
      setError('Impossible de créer le compte. Contactez votre administrateur.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <h1 className="auth-title">Espace de Travail</h1>

      <div className="auth-tabs">
        <button className={`auth-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => setTab('login')}>
          Connexion
        </button>
        <button className={`auth-tab ${tab === 'register' ? 'active' : ''}`} onClick={() => setTab('register')}>
          Créer un compte
        </button>
      </div>

      {tab === 'login' ? (
        <form className="auth-form" onSubmit={handleLogin}>
          <p className="auth-label">Bienvenue</p>
          <input name="username" type="text" placeholder="E-Mail / Nom d'utilisateur" required autoComplete="username" />
          <input name="password" type="password" placeholder="Mot de passe" required autoComplete="current-password" />
          <a href="#" className="auth-forgot">Mot de passe oublié ?</a>
          <label className="auth-remember">
            <input type="checkbox" name="remember" />
            Se souvenir de moi
          </label>
          {error && <div className="error-msg">{error}</div>}
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? '…' : 'Connexion'}
          </button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={handleRegister}>
          <p className="auth-description">
            Créez votre compte pour accéder à l'environnement d'édition et de traduction de textes juridiques.
          </p>
          <p className="auth-description">
            L'accès à cette plateforme est réservé aux collaborateurs autorisés.
          </p>
          <input name="email" type="email" placeholder="E-Mail" required />
          <input name="first" type="text" placeholder="Prénom" required />
          <input name="last" type="text" placeholder="Nom" required />
          <input name="password" type="password" placeholder="Mot de passe" required />
          <input name="org" type="text" placeholder="Organisation – Institution" />
          <p className="auth-legal">
            En créant votre compte, vous acceptez que la plateforme traite vos données personnelles
            conformément au RGPD.
          </p>
          {error && <div className="error-msg">{error}</div>}
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? '…' : 'Valider'}
          </button>
        </form>
      )}
    </div>
  )
}
