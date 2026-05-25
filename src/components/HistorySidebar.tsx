import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getChanges, getRecentChanges } from '../api/weblate'
import type { WeblateChange } from '../api/types'

interface HistorySidebarProps {
  open: boolean
  onClose: () => void
  unitId: number | null
  username: string | null
}

function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000
  if (diff < 60) return 'À l\'instant'
  if (diff < 3600) return `Il y a ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `Il y a ${Math.floor(diff / 3600)} heure${Math.floor(diff / 3600) > 1 ? 's' : ''}`
  return `Il y a ${Math.floor(diff / 86400)} jour${Math.floor(diff / 86400) > 1 ? 's' : ''}`
}

function ChangeEntry({ change, currentUsername }: { change: WeblateChange; currentUsername: string | null }) {
  const actor = change.author ?? change.user
  const isMe = actor?.username === currentUsername
  const name = isMe ? 'Vous avez' : `${actor?.full_name ?? actor?.username ?? '?'} a`
  const initial = (actor?.full_name ?? actor?.username ?? '?')[0].toUpperCase()

  return (
    <div className="history-entry">
      <div className="history-entry-header">
        <div className="history-avatar">{initial}</div>
        <div className="history-entry-meta">
          <div className="history-entry-who">
            <strong>{name}</strong> modifié AEC
          </div>
          <div className="history-entry-time">{timeAgo(change.timestamp)}</div>
        </div>
        <span className="history-entry-clock">○</span>
      </div>
      {change.translation?.language_code && (
        <div className="history-tag">
          {change.translation.language_code.toUpperCase()}
        </div>
      )}
    </div>
  )
}

export function HistorySidebar({ open, onClose, unitId, username }: HistorySidebarProps) {
  const [tab, setTab] = useState<'mine' | 'all'>('mine')

  const unitChanges = useQuery({
    queryKey: ['changes', unitId],
    queryFn: () => (unitId ? getChanges(unitId) : Promise.resolve([])),
    enabled: !!unitId && open,
  })

  const allChanges = useQuery({
    queryKey: ['changes', 'all'],
    queryFn: () => getRecentChanges(),
    enabled: open && tab === 'all',
  })

  const changes: WeblateChange[] = tab === 'mine'
    ? (unitChanges.data ?? []).filter(
        (c) => (c.author?.username ?? c.user?.username) === username
      )
    : (allChanges.data ?? [])

  return (
    <div className={`history-sidebar ${open ? 'open' : ''}`}>
      <div className="history-sidebar-inner">
        <div className="history-topbar">
          <button className="topbar-icon-btn" onClick={onClose} title="Fermer">»</button>
          <span className="history-title">Historique des versions</span>
          <button className="topbar-icon-btn">🔖</button>
          <button className="topbar-icon-btn">···</button>
        </div>

        <div className="history-tabs">
          <button
            className={`history-tab ${tab === 'mine' ? 'active' : ''}`}
            onClick={() => setTab('mine')}
          >
            Mes révisions
          </button>
          <button
            className={`history-tab ${tab === 'all' ? 'active' : ''}`}
            onClick={() => setTab('all')}
          >
            Toutes les révisions
          </button>
        </div>

        <div className="history-list">
          {(unitChanges.isLoading || allChanges.isLoading) && (
            <div className="empty-state" style={{ height: 80, fontSize: 11 }}>Chargement…</div>
          )}
          {changes.length === 0 && !unitChanges.isLoading && !allChanges.isLoading && (
            <div className="empty-state" style={{ height: 80, fontSize: 11 }}>Aucune révision</div>
          )}
          {changes.map((c) => (
            <ChangeEntry key={c.id} change={c} currentUsername={username} />
          ))}
        </div>
      </div>
    </div>
  )
}
