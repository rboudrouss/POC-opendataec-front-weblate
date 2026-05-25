export interface WeblateUser {
  username: string
  full_name: string
  email: string
  is_superuser: boolean
  date_joined: string
  url: string
}

export interface WeblateProject {
  name: string
  slug: string
  url: string
}

export interface WeblateComponent {
  name: string
  slug: string
  project: { slug: string; name: string }
  source_language: { code: string; name: string }
  url: string
}

// Unit state: 0=empty, 10=needs-edit, 20=translated, 30=approved
export type UnitState = 0 | 10 | 20 | 30 | 100

export interface WeblateUnit {
  id: number
  url: string
  translation: string
  source: string[]
  target: string[]
  state: UnitState
  context: string
  note: string
  timestamp: string
  num_words: number
}

export interface WeblateChange {
  id: number
  action: number
  action_name: string
  timestamp: string
  author: { username: string; full_name: string } | null
  user: { username: string; full_name: string } | null
  component: { slug: string; project: { slug: string } }
  translation: { language_code: string }
  unit: string | null
}

export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface Suggestion {
  id: number
  target: string
  user: string | null
  timestamp: string
  num_votes: number
  user_vote: 1 | -1 | null
}

// Derived hierarchy node built from unit keys like "1-1-1.value"
export interface HierarchyNode {
  id: string       // e.g. "1", "1-1", "1-1-1"
  label: string    // display label
  level: 'part' | 'chapter' | 'section' | 'measure'
  unit?: WeblateUnit
  children: HierarchyNode[]
}
