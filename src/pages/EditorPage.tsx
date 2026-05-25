import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getUnits, buildHierarchy } from '../api/weblate'
import { signOut, getAuthState } from '../store/auth'
import { NavTree } from '../components/NavTree'
import { HistorySidebar } from '../components/HistorySidebar'
import { EditorView } from '../components/EditorView'
import { TranslatorView } from '../components/TranslatorView'
import type { HierarchyNode } from '../api/types'

const PROJECT = 'aec'
const COMPONENT = 'measures'
const CHAPTER_COMPONENT = 'chapters'
const SOURCE_LANG = 'fr'
const ALL_LANGS = ['fr', 'en', 'es', 'it', 'nl', 'pt', 'pl', 'da', 'sv', 'fi', 'no', 'eu']

type Role = 'editor' | 'translator'

export function EditorPage() {
  const navigate = useNavigate()
  const { username } = getAuthState()
  const [role, setRole] = useState<Role>('editor')
  const [selectedNode, setSelectedNode] = useState<HierarchyNode | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sourceLang, setSourceLang] = useState(SOURCE_LANG)
  const [targetLang, setTargetLang] = useState('en')
  const [editorLang, setEditorLang] = useState(SOURCE_LANG)

  const sourceUnits = useQuery({
    queryKey: ['units', PROJECT, COMPONENT, sourceLang],
    queryFn: () => getUnits(PROJECT, COMPONENT, sourceLang),
  })

  const chapterUnits = useQuery({
    queryKey: ['units', PROJECT, CHAPTER_COMPONENT, SOURCE_LANG],
    queryFn: () => getUnits(PROJECT, CHAPTER_COMPONENT, SOURCE_LANG),
  })

  const tree =
    sourceUnits.data && chapterUnits.data
      ? buildHierarchy(sourceUnits.data, chapterUnits.data)
      : []

  // Breadcrumb from selected node label
  const breadcrumb = selectedNode
    ? `AEC / ${selectedNode.label}`
    : 'AEC'

  const selectedUnit = selectedNode?.unit

  function handleLogout() {
    signOut()
    navigate({ to: '/login' })
  }

  return (
    <div className="app-shell">
      {/* Top bar */}
      <div className="topbar">
        <div className="topbar-brand">
          <span>Espace de Travail</span>
          <span>▾</span>
        </div>
        <button className="topbar-search" title="Rechercher">⌕</button>

        <div className="topbar-breadcrumb">
          {breadcrumb.split('/').map((seg, i, arr) => (
            <span key={i}>
              {i > 0 && <span style={{ margin: '0 4px', color: '#ccc' }}>/</span>}
              <span style={{ color: i === arr.length - 1 ? '#333' : '#aaa' }}>
                {seg.trim()}
              </span>
            </span>
          ))}
        </div>

        <div className="topbar-right">
          {selectedUnit && (
            <span style={{ fontSize: 11, color: '#bbb' }}>
              Modifié {new Date(selectedUnit.timestamp).toLocaleDateString('fr-FR')}
            </span>
          )}
          <button
            className="topbar-icon-btn"
            title="Historique"
            onClick={() => setHistoryOpen((o) => !o)}
          >
            🔖
          </button>
          <button className="topbar-icon-btn" title="Admin" onClick={() => navigate({ to: '/admin' })}>
            ⚙
          </button>
          <button className="topbar-icon-btn" title="Déconnexion" onClick={handleLogout}>
            ⏻
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="editor-layout">
        {/* Left sidebar */}
        <div className="nav-sidebar">
          {/* Role tabs */}
          <div className="role-tabs">
            <button
              className={`role-tab ${role === 'editor' ? 'active' : ''}`}
              onClick={() => setRole('editor')}
            >
              <svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
              Éditeur
            </button>
            <button
              className={`role-tab ${role === 'translator' ? 'active' : ''}`}
              onClick={() => setRole('translator')}
            >
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7 2a1 1 0 011 1v1h3a1 1 0 110 2H9.578a18.87 18.87 0 01-1.724 4.78c.29.354.596.696.914 1.026a1 1 0 11-1.44 1.389c-.188-.196-.373-.396-.554-.6a19.098 19.098 0 01-3.107 3.567 1 1 0 01-1.334-1.49 17.087 17.087 0 003.13-3.733 18.992 18.992 0 01-1.487-3.754 1 1 0 111.94-.484c.184.703.42 1.37.705 1.992A17.113 17.113 0 008 8.474V3a1 1 0 01-1-1zm5 4a1 1 0 01.894.553l2.991 5.982a.869.869 0 01.02.037l.99 1.98a1 1 0 11-1.79.895L15.383 14h-4.764l-.724 1.447a1 1 0 11-1.788-.894l.99-1.98.019-.038 2.99-5.982A1 1 0 0112 6zm-1.382 6h2.764L12 9.236 10.618 12z" clipRule="evenodd" /></svg>
              Traducteur
            </button>
          </div>

          <div className="nav-label">Pages</div>

          {sourceUnits.isLoading || chapterUnits.isLoading ? (
            <div className="empty-state" style={{ height: 80, fontSize: 11 }}>Chargement…</div>
          ) : sourceUnits.isError ? (
            <div className="empty-state" style={{ height: 80, fontSize: 11, color: '#dc2626' }}>
              Erreur API
            </div>
          ) : (
            <NavTree
              nodes={tree}
              selectedId={selectedNode?.id ?? null}
              onSelect={setSelectedNode}
            />
          )}

          <div className="nav-guide">
            <span>📖</span>
            <span>Guide d'utilisation</span>
          </div>
        </div>

        {/* Main content */}
        {!selectedUnit ? (
          <div className="main-content">
            <div className="empty-state" style={{ height: 300 }}>
              Sélectionnez une mesure dans le menu
            </div>
          </div>
        ) : role === 'editor' ? (
          <EditorView
            unit={selectedUnit}
            label={selectedNode!.label}
            breadcrumb={breadcrumb}
            sourceLang={sourceLang}
            editorLang={editorLang}
            availableLangs={ALL_LANGS}
            onEditorLangChange={setEditorLang}
            project={PROJECT}
            component={COMPONENT}
          />
        ) : (
          <TranslatorView
            sourceUnit={selectedUnit}
            label={selectedNode!.label}
            sourceLang={sourceLang}
            targetLang={targetLang}
            availableLangs={ALL_LANGS}
            onSourceLangChange={setSourceLang}
            onTargetLangChange={setTargetLang}
            project={PROJECT}
            component={COMPONENT}
          />
        )}

        {/* History sidebar */}
        <HistorySidebar
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          unitId={selectedUnit?.id ?? null}
          username={username}
        />
      </div>
    </div>
  )
}
