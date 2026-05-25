import { apiFetch, fetchAll, customFetch } from './client'
import type {
  WeblateUser,
  WeblateUnit,
  WeblateChange,
  Suggestion,
  Paginated,
  UnitState,
  HierarchyNode,
} from './types'

export async function getUsers(): Promise<WeblateUser[]> {
  return fetchAll<WeblateUser>('/users/')
}

export async function createUser(payload: {
  username: string
  email: string
  full_name: string
  password: string
  is_superuser?: boolean
}): Promise<WeblateUser> {
  return apiFetch<WeblateUser>('/users/', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function deleteUser(username: string): Promise<void> {
  return apiFetch(`/users/${username}/`, { method: 'DELETE' })
}

export async function getUnits(project: string, component: string, lang: string): Promise<WeblateUnit[]> {
  return fetchAll<WeblateUnit>(`/translations/${project}/${component}/${lang}/units/`)
}

export async function patchUnit(
  id: number,
  payload: { target?: string[]; state?: UnitState }
): Promise<WeblateUnit> {
  return apiFetch<WeblateUnit>(`/units/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function getChanges(unitId: number): Promise<WeblateChange[]> {
  const data = await apiFetch<Paginated<WeblateChange>>(
    `/changes/?unit=${unitId}&page_size=50`
  )
  return data.results
}

export async function getRecentChanges(project = 'aec'): Promise<WeblateChange[]> {
  const data = await apiFetch<Paginated<WeblateChange>>(
    `/changes/?project=${project}&page_size=50`
  )
  return data.results
}

// ── Suggestions ───────────────────────────────────────────────────

export async function getSuggestions(unitId: number): Promise<Suggestion[]> {
  return customFetch<Suggestion[]>(`/suggestions/${unitId}`)
}

export async function voteSuggestion(
  suggestionId: number,
  value: 1 | -1
): Promise<{ id: number; num_votes: number; user_vote: 1 | -1 | null }> {
  return customFetch(`/suggestions/${suggestionId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ value }),
  })
}

export async function createSuggestion(unitId: number, target: string): Promise<Suggestion> {
  return customFetch<Suggestion>(`/suggestions/${unitId}`, {
    method: 'POST',
    body: JSON.stringify({ target }),
  })
}

export async function updateSuggestion(suggestionId: number, target: string): Promise<Suggestion> {
  return customFetch<Suggestion>(`/suggestions/${suggestionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ target }),
  })
}

// ── Hierarchy builder ─────────────────────────────────────────────
// Key formats:
//   parts:    "1.intro.0.text"        → part 1
//   chapters: "1.title"               → chapter 1
//   sections: "1-1.intro.0.text"      → section 1-1
//   measures: "1-1-1.value"           → measure 1-1-1
//
// UI hierarchy: Partie N (chapters) → Section N-M (derived from measures) → Mesure N-M-P

export function buildHierarchy(measureUnits: WeblateUnit[], chapterUnits: WeblateUnit[]): HierarchyNode[] {
  // Index chapters by their key prefix (e.g., "1" → "Power to the people")
  const chapterTitles = new Map<string, string>()
  for (const u of chapterUnits) {
    const m = u.context.match(/^(\d+)\.title$/)
    if (m) chapterTitles.set(m[1], u.source[0] ?? u.context)
  }

  // Build tree from measure keys like "1-1-1.value"
  const parts = new Map<string, Map<string, WeblateUnit[]>>()

  for (const unit of measureUnits) {
    const m = unit.context.match(/^(\d+)-(\d+)-(\d+)\./)
    if (!m) continue
    const [, p, s] = m
    const sectionKey = `${p}-${s}`
    if (!parts.has(p)) parts.set(p, new Map())
    const sections = parts.get(p)!
    if (!sections.has(sectionKey)) sections.set(sectionKey, [])
    sections.get(sectionKey)!.push(unit)
  }

  const tree: HierarchyNode[] = []

  for (const [partKey, sections] of [...parts.entries()].sort((a, b) => +a[0] - +b[0])) {
    const partNode: HierarchyNode = {
      id: partKey,
      label: chapterTitles.get(partKey) ?? `Partie ${partKey}`,
      level: 'part',
      children: [],
    }

    for (const [sectionKey, units] of [...sections.entries()].sort((a, b) => {
      const [, as] = a[0].split('-').map(Number)
      const [, bs] = b[0].split('-').map(Number)
      return as - bs
    })) {
      const [, sNum] = sectionKey.split('-')
      const sectionNode: HierarchyNode = {
        id: sectionKey,
        label: `Section ${partKey}.${sNum}`,
        level: 'section',
        children: units
          .sort((a, b) => {
            const aNum = parseInt(a.context.split('-')[2])
            const bNum = parseInt(b.context.split('-')[2])
            return aNum - bNum
          })
          .map((u): HierarchyNode => {
            const mNum = u.context.split('-')[2]?.split('.')[0] ?? '?'
            return {
              id: String(u.id),
              label: `Mesure ${partKey}.${sNum}.${mNum}`,
              level: 'measure',
              unit: u,
              children: [],
            }
          }),
      }
      partNode.children.push(sectionNode)
    }

    tree.push(partNode)
  }

  return tree
}
