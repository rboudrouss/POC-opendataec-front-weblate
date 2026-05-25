import { useQuery } from '@tanstack/react-query'
import { getUnits } from '../api/weblate'
import { SuggestionPanel } from './SuggestionPanel'
import type { WeblateUnit } from '../api/types'

const LANG_LABELS: Record<string, string> = {
  fr: 'Français', en: 'Anglais', es: 'Espagnol', de: 'Allemand',
  it: 'Italien', nl: 'Néerlandais', pt: 'Portugais', pl: 'Polonais',
  da: 'Danois', sv: 'Suédois', fi: 'Finnois', no: 'Norvégien', eu: 'Basque',
}

interface TranslatorViewProps {
  sourceUnit: WeblateUnit
  label: string
  sourceLang: string
  targetLang: string
  availableLangs: string[]
  onTargetLangChange: (lang: string) => void
  onSourceLangChange: (lang: string) => void
  project: string
  component: string
}

export function TranslatorView({
  sourceUnit,
  sourceLang,
  targetLang,
  availableLangs,
  onTargetLangChange,
  onSourceLangChange,
  project,
  component,
}: TranslatorViewProps) {
  const targetUnitsQ = useQuery({
    queryKey: ['units', project, component, targetLang],
    queryFn: () => getUnits(project, component, targetLang),
    enabled: !!targetLang,
  })

  const targetUnit = targetUnitsQ.data?.find((u) => u.context === sourceUnit.context)

  return (
    <div className="translator-layout">
      {/* Source panel */}
      <div className="translator-panel">
        <div className="translator-panel-header">
          <div className="lang-select">
            Langue Source :&nbsp;
            <select value={sourceLang} onChange={(e) => onSourceLangChange(e.target.value)}>
              {availableLangs.map((l) => (
                <option key={l} value={l}>{LANG_LABELS[l] ?? l}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="translator-source-body">
          {sourceUnit.source.map((para, i) => <p key={i}>{para}</p>)}
        </div>
      </div>

      {/* Target panel — read-only + suggestions */}
      <div className="translator-panel">
        <div className="translator-panel-header">
          <div className="lang-select">
            Traduction :&nbsp;
            <select
              value={targetLang}
              onChange={(e) => onTargetLangChange(e.target.value)}
            >
              {availableLangs
                .filter((l) => l !== sourceLang)
                .map((l) => (
                  <option key={l} value={l}>{LANG_LABELS[l] ?? l}</option>
                ))}
            </select>
          </div>
          {targetUnit && (
            <span className={`badge-validated ${targetUnit.state === 30 ? '' : 'badge-pending'}`}>
              {targetUnit.state === 30 ? 'Validé' : targetUnit.state === 20 ? 'Traduit' : 'En attente'}
            </span>
          )}
        </div>

        {targetUnitsQ.isLoading ? (
          <div className="empty-state" style={{ height: 120, fontSize: 11 }}>Chargement…</div>
        ) : (
          <div className="unit-body">
            {!targetUnit || !targetUnit.target[0] ? (
              <p style={{ color: '#aaa', fontStyle: 'italic' }}>Aucune traduction validée</p>
            ) : (
              targetUnit.target.map((para, i) => <p key={i}>{para}</p>)
            )}
          </div>
        )}

        {targetUnit && (
          <SuggestionPanel
            unitId={targetUnit.id}
            mode="translator"
            defaultDraft={targetUnit.target[0] ?? ''}
          />
        )}
      </div>
    </div>
  )
}
