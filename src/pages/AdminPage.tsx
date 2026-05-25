import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { getUsers, createUser, deleteUser } from '../api/weblate'

export function AdminPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState('')

  const usersQ = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
  })

  const addUser = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowForm(false)
      setFormError('')
    },
    onError: (e) => setFormError(String(e)),
  })

  const removeUser = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  async function handleAddUser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError('')
    const fd = new FormData(e.currentTarget)
    addUser.mutate({
      username: fd.get('email') as string,
      email: fd.get('email') as string,
      full_name: `${fd.get('first')} ${fd.get('last')}`,
      password: fd.get('password') as string,
      is_superuser: fd.get('admin') === 'on',
    })
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="topbar-brand">Espace de Travail</div>
        <div style={{ flex: 1 }} />
        <button className="topbar-icon-btn" onClick={() => navigate({ to: '/editor' })}>
          ← Éditeur
        </button>
      </div>

      <div className="editor-layout">
        <div className="admin-page">
          <div className="admin-header">
            <span className="admin-title">Gestion des utilisateurs</span>
            <button className="btn-add" onClick={() => setShowForm((s) => !s)}>
              + Ajouter
            </button>
          </div>

          {showForm && (
            <form onSubmit={handleAddUser} style={{ marginBottom: 24, display: 'flex', flexWrap: 'wrap', gap: 12, padding: 20, background: '#f9f9f9', border: '1px solid #eee' }}>
              <input className="admin-input" name="email" type="email" placeholder="E-Mail" required style={inputStyle} />
              <input className="admin-input" name="first" type="text" placeholder="Prénom" required style={inputStyle} />
              <input className="admin-input" name="last" type="text" placeholder="Nom" required style={inputStyle} />
              <input className="admin-input" name="password" type="password" placeholder="Mot de passe" required style={inputStyle} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input type="checkbox" name="admin" />
                Administrateur
              </label>
              {formError && <div className="error-msg" style={{ width: '100%' }}>{formError}</div>}
              <button type="submit" className="btn-save" disabled={addUser.isPending}>
                {addUser.isPending ? '…' : 'Créer'}
              </button>
              <button type="button" className="btn-modifier" onClick={() => setShowForm(false)}>
                Annuler
              </button>
            </form>
          )}

          {usersQ.isLoading && <div className="empty-state">Chargement…</div>}
          {usersQ.isError && <div className="error-msg">Erreur: {String(usersQ.error)}</div>}

          {usersQ.data && (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Email</th>
                  <th>Rôle</th>
                  <th>Depuis</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {usersQ.data.map((user) => (
                  <tr key={user.username}>
                    <td>{user.full_name || user.username}</td>
                    <td>{user.email}</td>
                    <td>
                      <span className="admin-role-badge">
                        {user.is_superuser ? 'Admin' : 'Éditeur'}
                      </span>
                    </td>
                    <td>{new Date(user.date_joined).toLocaleDateString('fr-FR')}</td>
                    <td>
                      <button
                        className="btn-danger"
                        onClick={() => {
                          if (confirm(`Supprimer ${user.username} ?`)) {
                            removeUser.mutate(user.username)
                          }
                        }}
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '8px 0',
  border: 'none',
  borderBottom: '1px solid #ddd',
  outline: 'none',
  fontSize: 13,
  background: 'transparent',
  minWidth: 160,
}
