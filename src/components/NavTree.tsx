import { useState } from 'react'
import type { HierarchyNode } from '../api/types'

interface NavTreeProps {
  nodes: HierarchyNode[]
  selectedId: string | null
  onSelect: (node: HierarchyNode) => void
}

interface NodeProps {
  node: HierarchyNode
  selectedId: string | null
  onSelect: (node: HierarchyNode) => void
  depth: number
}

function TreeNode({ node, selectedId, onSelect, depth }: NodeProps) {
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = node.children.length > 0
  const isSelected = selectedId === node.id

  return (
    <div className="tree-node">
      <div
        className={`tree-node-row ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => {
          if (hasChildren) setOpen((o) => !o)
          if (node.level === 'measure') onSelect(node)
        }}
      >
        <span className="tree-toggle">
          {hasChildren ? (open ? '▾' : '▸') : <span style={{ width: 14 }} />}
        </span>
        <span className="tree-node-label">{node.label}</span>
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function NavTree({ nodes, selectedId, onSelect }: NavTreeProps) {
  if (nodes.length === 0) {
    return <div className="empty-state" style={{ height: 100, fontSize: 11 }}>Aucune donnée</div>
  }

  return (
    <div className="nav-tree">
      {nodes.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={0}
        />
      ))}
    </div>
  )
}
