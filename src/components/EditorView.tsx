import { useState } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { patchUnit, getUnits } from '../api/weblate'
import { SuggestionPanel } from './SuggestionPanel'
import type { WeblateUnit } from '../api/types'

const LANG_LABELS: Record<string, string> = {
  fr: 'Français', en: 'Anglais', es: 'Espagnol', de: 'Allemand',
  it: 'Italien', nl: 'Néerlandais', pt: 'Portugais', pl: 'Polonais',
  da: 'Danois', sv: 'Suédois', fi: 'Finnois', no: 'Norvégien', eu: 'Basque',
}

const STATE_LABELS: Record<number, string> = {
  0: 'Vide', 10: 'À réviser', 20: 'Traduit', 30: 'Validé',
}

const STATE_CLASS: Record<number, string> = {
  0: 'badge-empty', 10: 'badge-pending', 20: 'badge-pending', 30: 'badge-validated',
}

interface EditorViewProps {
  unit: WeblateUnit
  label: string
  breadcrumb: string
  sourceLang: string
  editorLang: string
  availableLangs: string[]
  onEditorLangChange: (lang: string) => void
  project: string
  component: string
}

export function EditorView({
  unit,
  label,
  breadcrumb,
  sourceLang,
  editorLang,
  availableLangs,
  onEditorLangChange,
  project,
  component,
}: EditorViewProps) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const isSourceLang = editorLang === sourceLang

  // When a non-source lang is selected, fetch that lang's units to find by context
  const targetUnitsQ = useQuery({
    queryKey: ['units', project, component, editorLang],
    queryFn: () => getUnits(project, component, editorLang),
    enabled: !isSourceLang,
  })

  const activeUnit: WeblateUnit | undefined = isSourceLang
    ? unit
    : targetUnitsQ.data?.find((u) => u.context === unit.context)

  const saveUnit = useMutation({
    mutationFn: (payload: Parameters<typeof patchUnit>[1]) =>
      patchUnit(activeUnit!.id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['units', project, component, editorLang] })
      setEditing(false)
    },
  })

  const isValidated = activeUnit?.state === 30

  function startEditing() {
    setDraft(activeUnit?.target.join('\n\n') ?? '')
    setEditing(true)
  }

  return (
    <div className="main-content">
      <div className="unit-header">
        <div>
          <div className="unit-title">{label}</div>
          <div className="unit-title-sub">{breadcrumb}</div>
        </div>
        <div className="unit-status">
          <div className="lang-select" style={{ marginRight: 12 }}>
            Langue :&nbsp;
            <select
              value={editorLang}
              onChange={(e) => { onEditorLangChange(e.target.value); setEditing(false) }}
            >
              {availableLangs.map((l) => (
                <option key={l} value={l}>{LANG_LABELS[l] ?? l}</option>
              ))}
            </select>
          </div>
          {activeUnit && (
            <>
              <span className={`badge-validated ${STATE_CLASS[activeUnit.state] ?? ''}`}>
                {STATE_LABELS[activeUnit.state] ?? 'Inconnu'}
              </span>
              {!editing && (
                <button className="btn-modifier" onClick={startEditing}>
                  Modifier
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {!isSourceLang && targetUnitsQ.isLoading ? (
        <div className="empty-state" style={{ height: 120, fontSize: 11 }}>Chargement…</div>
      ) : !activeUnit ? (
        <div className="empty-state" style={{ height: 120, fontSize: 11 }}>
          Aucune unité pour cette langue
        </div>
      ) : editing ? (
        <>
          <textarea
            className="unit-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={10}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              className="btn-save"
              disabled={saveUnit.isPending}
              onClick={() => saveUnit.mutate({ target: [draft], state: 20 })}
            >
              {saveUnit.isPending ? '…' : 'Enregistrer'}
            </button>
            {!isValidated && (
              <button
                className="btn-save"
                style={{ background: '#166534' }}
                disabled={saveUnit.isPending}
                onClick={() => saveUnit.mutate({ target: [draft], state: 30 })}
              >
                Valider
              </button>
            )}
            {isValidated && (
              <button
                className="btn-modifier"
                disabled={saveUnit.isPending}
                onClick={() => saveUnit.mutate({ state: 20 })}
              >
                Dé-valider
              </button>
            )}
            <button className="btn-modifier" onClick={() => setEditing(false)}>Annuler</button>
          </div>
          {saveUnit.isError && (
            <div className="error-msg">{String(saveUnit.error)}</div>
          )}
        </>
      ) : (
        <div className="unit-body">
          {!activeUnit.target[0] ? (
            <p style={{ color: '#aaa', fontStyle: 'italic' }}>Aucune traduction</p>
          ) : (
            activeUnit.target.map((para, i) => <p key={i}>{para}</p>)
          )}
        </div>
      )}

      {activeUnit && !isSourceLang && (
        <SuggestionPanel
          unitId={activeUnit.id}
          mode="editor"
          onAccept={(target) => saveUnit.mutate({ target: [target], state: 30 })}
        />
      )}
    </div>
  )
}
