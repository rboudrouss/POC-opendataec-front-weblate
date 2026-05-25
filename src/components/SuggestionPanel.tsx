import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSuggestions, voteSuggestion, createSuggestion, updateSuggestion } from '../api/weblate'
import { getAuthState } from '../store/auth'
import type { Suggestion } from '../api/types'

interface SuggestionPanelProps {
  unitId: number
  mode: 'editor' | 'translator'
  onAccept?: (target: string) => void
  defaultDraft?: string
}

export function SuggestionPanel({ unitId, mode, onAccept, defaultDraft = '' }: SuggestionPanelProps) {
  const qc = useQueryClient()
  const { username } = getAuthState()
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const suggestionsQ = useQuery({
    queryKey: ['suggestions', unitId],
    queryFn: () => getSuggestions(unitId),
  })

  const voteMutation = useMutation({
    mutationFn: ({ id, value }: { id: number; value: 1 | -1 }) =>
      voteSuggestion(id, value),
    onMutate: async ({ id, value }) => {
      await qc.cancelQueries({ queryKey: ['suggestions', unitId] })
      const prev = qc.getQueryData<Suggestion[]>(['suggestions', unitId])
      qc.setQueryData<Suggestion[]>(['suggestions', unitId], (old = []) =>
        old
          .map((s) => {
            if (s.id !== id) return s
            const toggling = s.user_vote === value
            return {
              ...s,
              num_votes: toggling
                ? s.num_votes - value
                : s.num_votes - (s.user_vote ?? 0) + value,
              user_vote: toggling ? null : value,
            }
          })
          .sort((a, b) => b.num_votes - a.num_votes)
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['suggestions', unitId], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['suggestions', unitId] }),
  })

  const createMutation = useMutation({
    mutationFn: (target: string) => createSuggestion(unitId, target),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suggestions', unitId] })
      setDraft('')
      setShowForm(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, target }: { id: number; target: string }) =>
      updateSuggestion(id, target),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suggestions', unitId] })
      setEditingId(null)
    },
  })

  function startEdit(s: Suggestion) {
    setEditingId(s.id)
    setEditDraft(s.target)
  }

  function openForm() {
    setDraft(defaultDraft)
    setShowForm(true)
  }

  const suggestions = suggestionsQ.data ?? []

  return (
    <div className="suggestion-panel">
      <div className="suggestion-panel-header">
        <span className="suggestion-panel-title">
          Suggestions{suggestions.length > 0 && ` (${suggestions.length})`}
        </span>
        {!showForm && (
          <button className="btn-modifier" onClick={openForm}>
            + Proposer
          </button>
        )}
      </div>

      {showForm && (
        <div className="suggestion-form">
          <textarea
            className="unit-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Votre traduction…"
            rows={4}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className="btn-save"
              disabled={!draft.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate(draft.trim())}
            >
              {createMutation.isPending ? '…' : 'Soumettre'}
            </button>
            <button className="btn-modifier" onClick={() => setShowForm(false)}>Annuler</button>
          </div>
          {createMutation.isError && (
            <div className="error-msg">{String(createMutation.error)}</div>
          )}
        </div>
      )}

      {suggestionsQ.isLoading ? (
        <div className="suggestion-empty">Chargement…</div>
      ) : suggestions.length === 0 ? (
        <div className="suggestion-empty">Aucune suggestion</div>
      ) : (
        <ul className="suggestion-list">
          {suggestions.map((s) => (
            <li key={s.id} className="suggestion-row">
              <button
                className={`suggestion-vote-btn${s.user_vote === 1 ? ' voted' : ''}`}
                disabled={voteMutation.isPending}
                onClick={() => voteMutation.mutate({ id: s.id, value: 1 })}
                title={s.user_vote === 1 ? 'Retirer mon vote' : 'Voter'}
              >
                ▲ {s.num_votes}
              </button>

              <div className="suggestion-body">
                {editingId === s.id ? (
                  <>
                    <textarea
                      className="unit-textarea"
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      rows={3}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <button
                        className="btn-save"
                        disabled={!editDraft.trim() || updateMutation.isPending}
                        onClick={() => updateMutation.mutate({ id: s.id, target: editDraft.trim() })}
                      >
                        {updateMutation.isPending ? '…' : 'Sauvegarder'}
                      </button>
                      <button className="btn-modifier" onClick={() => setEditingId(null)}>Annuler</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="suggestion-target">{s.target}</div>
                    <div className="suggestion-meta">
                      {s.user ?? 'Anonyme'} · {new Date(s.timestamp).toLocaleDateString('fr-FR')}
                      {s.user === username && (
                        <button
                          className="suggestion-edit-btn"
                          onClick={() => startEdit(s)}
                        >
                          Éditer
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {mode === 'editor' && onAccept && editingId !== s.id && (
                <button
                  className="btn-save suggestion-accept-btn"
                  onClick={() => onAccept(s.target)}
                >
                  Accepter
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
