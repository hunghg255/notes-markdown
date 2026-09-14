import { useEffect, useMemo, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Search01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { openNote } from '@/lib/actions'
import { resolveWikiTarget } from '@/lib/notes'
import { cn } from '@/lib/utils'
import { useIndexStore } from '@/stores/indexStore'
import { useTabsStore } from '@/stores/tabsStore'
import { dirname } from '@/stores/vaultStore'

interface Node {
  id: string
  label: string
  group: string
  x: number
  y: number
  vx: number
  vy: number
  degree: number
  r: number
  fixed?: boolean
}
interface Edge {
  a: number
  b: number
}
interface Graph {
  nodes: Node[]
  edges: Edge[]
  adjacency: Set<number>[]
  groups: string[]
}

/** Categorical colours for top-level folders (hue-spaced, readable on light & dark). */
const GROUP_HUES = [45, 210, 140, 300, 10, 260, 180, 80]
const groupColor = (i: number, light: boolean) =>
  `oklch(${light ? 0.62 : 0.74} 0.15 ${GROUP_HUES[i % GROUP_HUES.length]})`

function buildGraph(notes: { path: string; name: string; links: string[] }[]): Graph {
  const groupOf = (p: string) => dirname(p).split('/')[0] || '/'
  const groups = [...new Set(notes.map((n) => groupOf(n.path)))].sort((a, b) =>
    a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b),
  )
  const index = new Map(notes.map((n, i) => [n.path, i]))
  const nodes: Node[] = notes.map((n, i) => {
    const angle = (i / Math.max(1, notes.length)) * Math.PI * 2
    const radius = 60 + Math.sqrt(notes.length) * 30
    return {
      id: n.path,
      label: n.name,
      group: groupOf(n.path),
      x: Math.cos(angle) * radius + (Math.random() - 0.5) * 20,
      y: Math.sin(angle) * radius + (Math.random() - 0.5) * 20,
      vx: 0,
      vy: 0,
      degree: 0,
      r: 4,
    }
  })
  const edges: Edge[] = []
  const seen = new Set<string>()
  const adjacency = nodes.map(() => new Set<number>())
  for (const n of notes) {
    for (const link of n.links) {
      const target = resolveWikiTarget(link, n.path, notes)
      if (!target || target === n.path) continue
      const a = index.get(n.path)!
      const b = index.get(target)!
      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ a, b })
      adjacency[a].add(b)
      adjacency[b].add(a)
    }
  }
  for (const n of nodes) {
    n.degree = adjacency[nodes.indexOf(n)].size
    n.r = 3.5 + Math.min(9, Math.sqrt(n.degree) * 2.2)
  }
  return { nodes, edges, adjacency, groups }
}

/** Keep only the active note and its neighbours within `depth` hops. */
function localSubgraph(graph: Graph, center: string, depth: number): Graph {
  const start = graph.nodes.findIndex((n) => n.id === center)
  if (start === -1) return graph
  const keep = new Set<number>([start])
  let frontier = [start]
  for (let d = 0; d < depth; d++) {
    const next: number[] = []
    for (const i of frontier)
      for (const j of graph.adjacency[i])
        if (!keep.has(j)) {
          keep.add(j)
          next.push(j)
        }
    frontier = next
  }
  const order = [...keep]
  const remap = new Map(order.map((old, i) => [old, i]))
  const nodes = order.map((i) => ({ ...graph.nodes[i] }))
  const edges = graph.edges
    .filter((e) => keep.has(e.a) && keep.has(e.b))
    .map((e) => ({ a: remap.get(e.a)!, b: remap.get(e.b)! }))
  const adjacency = nodes.map(() => new Set<number>())
  for (const e of edges) {
    adjacency[e.a].add(e.b)
    adjacency[e.b].add(e.a)
  }
  return { nodes, edges, adjacency, groups: graph.groups }
}

export function GraphView() {
  const notes = useIndexStore((s) => s.notes)
  // the note the "Local" mode centres on: the last note visited, else the last note tab
  const isNoteId = (id: string) => !id.startsWith('view:') && id !== 'settings'
  const activeNote = useTabsStore(
    (s) =>
      s.history.filter(isNoteId).at(-1) ??
      s.tabs
        .map((t) => t.id)
        .filter(isNoteId)
        .at(-1) ??
      null,
  )
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [query, setQuery] = useState('')
  const [local, setLocal] = useState(false)
  const [showLabels, setShowLabels] = useState(true)
  const [hover, setHover] = useState<string | null>(null)
  const fitRef = useRef<() => void>(() => {})

  const fullGraph = useMemo(() => buildGraph(notes), [notes])
  const graph = useMemo(
    () => (local && activeNote ? localSubgraph(fullGraph, activeNote, 2) : fullGraph),
    [fullGraph, local, activeNote],
  )

  const view = useRef({ x: 0, y: 0, k: 1 })
  const drag = useRef<{ node: Node | null; panning: boolean; lastX: number; lastY: number; moved: boolean }>({
    node: null,
    panning: false,
    lastX: 0,
    lastY: 0,
    moved: false,
  })
  const hoverRef = useRef<string | null>(null)
  hoverRef.current = hover
  const queryRef = useRef('')
  queryRef.current = query.trim().toLowerCase()
  const labelsRef = useRef(true)
  labelsRef.current = showLabels

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const { nodes, edges, adjacency, groups } = graph
    const n = nodes.length
    let raf = 0
    let alpha = 1
    let settled = false
    const light = !document.documentElement.classList.contains('dark')
    const css = getComputedStyle(document.documentElement)
    const colors = {
      accent: css.getPropertyValue('--primary').trim() || '#f26a1b',
      text: css.getPropertyValue('--foreground').trim() || '#eee',
      bg: css.getPropertyValue('--background').trim() || '#1a1a1a',
      muted: css.getPropertyValue('--muted-foreground').trim() || '#888',
      edge: light ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.14)',
      edgeHi: light ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)',
    }
    const groupIdx = new Map(groups.map((g, i) => [g, i]))

    // layout constants scale with graph size so big vaults spread out instead of piling up
    const linkLength = 70 + Math.sqrt(n) * 12
    const repulsion = 2500 + n * 40
    const gravity = 0.02

    const size = () => canvas.getBoundingClientRect()
    const resize = () => {
      const rect = size()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const fit = () => {
      if (n === 0) return
      const rect = size()
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const nd of nodes) {
        minX = Math.min(minX, nd.x)
        maxX = Math.max(maxX, nd.x)
        minY = Math.min(minY, nd.y)
        maxY = Math.max(maxY, nd.y)
      }
      // leave ~70px of screen space around the outermost labels
      const k = Math.min(
        2.5,
        Math.max(
          0.2,
          Math.min((rect.width - 140) / Math.max(1, maxX - minX), (rect.height - 140) / Math.max(1, maxY - minY)),
        ),
      )
      view.current = { k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k }
    }

    const simulate = () => {
      for (let i = 0; i < n; i++) {
        const a = nodes[i]
        for (let j = i + 1; j < n; j++) {
          const b = nodes[j]
          let dx = b.x - a.x
          let dy = b.y - a.y
          let d2 = dx * dx + dy * dy
          if (d2 < 1) {
            dx = Math.random() - 0.5
            dy = Math.random() - 0.5
            d2 = 1
          }
          const d = Math.sqrt(d2)
          // repulsion
          let f = (repulsion / d2) * alpha
          // collision: never let two nodes (plus label room) overlap
          const minDist = 36 + (a.label.length + b.label.length) * 1.4
          if (d < minDist) f += ((minDist - d) / d) * 0.6
          const fx = (dx / d) * f
          const fy = (dy / d) * f
          a.vx -= fx
          a.vy -= fy
          b.vx += fx
          b.vy += fy
        }
        a.vx -= a.x * gravity * alpha
        a.vy -= a.y * gravity * alpha
      }
      for (const e of edges) {
        const a = nodes[e.a]
        const b = nodes[e.b]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        // hubs get slightly longer links so their neighbours fan out
        const target = linkLength + Math.min(60, (a.degree + b.degree) * 3)
        const f = ((d - target) / d) * 0.06 * alpha
        a.vx += dx * f
        a.vy += dy * f
        b.vx -= dx * f
        b.vy -= dy * f
      }
      for (const nd of nodes) {
        if (nd.fixed) {
          nd.vx = nd.vy = 0
          continue
        }
        nd.x += nd.vx
        nd.y += nd.vy
        nd.vx *= 0.55
        nd.vy *= 0.55
      }
      alpha *= 0.975
    }

    const drawLabel = (nd: Node, emphasis: boolean, dim: boolean) => {
      const k = view.current.k
      const fontPx = 12 / k
      ctx.font = `${emphasis ? 600 : 500} ${fontPx}px system-ui, sans-serif`
      const w = ctx.measureText(nd.label).width
      const x = nd.x
      const y = nd.y + nd.r / k + fontPx * 1.05
      // halo so text stays readable on top of edges
      ctx.globalAlpha = dim ? 0.25 : 0.9
      ctx.fillStyle = colors.bg
      const pad = 3
      const h = fontPx + pad * 2
      const rx = x - w / 2 - pad
      const ry = y - fontPx * 0.8 - pad + 1
      ctx.beginPath()
      ctx.roundRect(rx, ry, w + pad * 2, h, 4)
      ctx.fill()
      ctx.globalAlpha = dim ? 0.35 : 1
      ctx.fillStyle = emphasis ? colors.accent : colors.text
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(nd.label, x, y)
      ctx.globalAlpha = 1
    }

    const draw = () => {
      const rect = size()
      const { k, x: vx, y: vy } = view.current
      ctx.clearRect(0, 0, rect.width, rect.height)
      ctx.save()
      ctx.translate(rect.width / 2 + vx, rect.height / 2 + vy)
      ctx.scale(k, k)

      const hovered = hoverRef.current
      const q = queryRef.current
      const hoverIdx = hovered ? nodes.findIndex((nd) => nd.id === hovered) : -1
      const focusSet = hoverIdx >= 0 ? new Set([hoverIdx, ...adjacency[hoverIdx]]) : null
      const matches = (nd: Node) => !q || nd.label.toLowerCase().includes(q)
      const isDim = (i: number) => (focusSet ? !focusSet.has(i) : q ? !matches(nodes[i]) : false)

      // edges
      ctx.lineWidth = 1 / k
      for (const e of edges) {
        const hi = hoverIdx >= 0 && (e.a === hoverIdx || e.b === hoverIdx)
        ctx.strokeStyle = hi ? colors.edgeHi : colors.edge
        ctx.lineWidth = (hi ? 1.8 : 1) / k
        ctx.globalAlpha = focusSet && !hi ? 0.25 : 1
        ctx.beginPath()
        ctx.moveTo(nodes[e.a].x, nodes[e.a].y)
        ctx.lineTo(nodes[e.b].x, nodes[e.b].y)
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      // nodes
      for (let i = 0; i < n; i++) {
        const nd = nodes[i]
        const dim = isDim(i)
        const isActive = nd.id === activeNote
        const isHover = i === hoverIdx
        ctx.globalAlpha = dim ? 0.25 : 1
        const rr = nd.r / k
        ctx.beginPath()
        ctx.arc(nd.x, nd.y, rr, 0, Math.PI * 2)
        ctx.fillStyle = nd.degree === 0 ? colors.muted : groupColor(groupIdx.get(nd.group) ?? 0, light)
        ctx.fill()
        if (isActive || isHover) {
          ctx.lineWidth = 2.5 / k
          ctx.strokeStyle = colors.accent
          ctx.stroke()
        }
      }
      ctx.globalAlpha = 1

      // labels: always for hubs / hovered / active / search hits; others only when zoomed in
      const labelThreshold = k >= 1.1 ? 0 : k >= 0.7 ? 2 : 4
      for (let i = 0; i < n; i++) {
        const nd = nodes[i]
        const emphasis = i === hoverIdx || nd.id === activeNote || (!!q && matches(nd))
        const inFocus = focusSet?.has(i)
        if (!labelsRef.current && !emphasis && !inFocus) continue
        if (!emphasis && !inFocus && nd.degree < labelThreshold && n > 12) continue
        drawLabel(nd, emphasis, isDim(i))
      }
      ctx.restore()
    }

    fitRef.current = fit
    let frames = 0
    const step = () => {
      if (alpha > 0.004) {
        // several sub-steps per frame so the layout settles quickly
        for (let s = 0; s < 3; s++) simulate()
        // keep the whole graph in view while it is still moving, then stop touching the camera
        if (!settled && frames++ % 6 === 0) fit()
        if (alpha <= 0.004 && !settled) {
          settled = true
          fit()
        }
      }
      draw()
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)

    const toGraph = (e: MouseEvent) => {
      const rect = size()
      return {
        x: (e.clientX - rect.left - rect.width / 2 - view.current.x) / view.current.k,
        y: (e.clientY - rect.top - rect.height / 2 - view.current.y) / view.current.k,
      }
    }
    const nodeAt = (p: { x: number; y: number }) => {
      let best: Node | null = null
      let bestD = 16 / view.current.k
      for (const nd of nodes) {
        const d = Math.hypot(nd.x - p.x, nd.y - p.y) - nd.r / view.current.k
        if (d < bestD) {
          best = nd
          bestD = d
        }
      }
      return best
    }
    const onDown = (e: MouseEvent) => {
      const nd = nodeAt(toGraph(e))
      drag.current = { node: nd, panning: !nd, lastX: e.clientX, lastY: e.clientY, moved: false }
      if (nd) nd.fixed = true
    }
    const onMove = (e: MouseEvent) => {
      const d = drag.current
      if (d.node) {
        const p = toGraph(e)
        d.node.x = p.x
        d.node.y = p.y
        d.moved = true
        alpha = Math.max(alpha, 0.15)
      } else if (d.panning) {
        view.current.x += e.clientX - d.lastX
        view.current.y += e.clientY - d.lastY
        d.lastX = e.clientX
        d.lastY = e.clientY
        d.moved = true
      } else {
        const nd = nodeAt(toGraph(e))
        setHover(nd?.id ?? null)
        canvas.style.cursor = nd ? 'pointer' : 'grab'
      }
    }
    const onUp = () => {
      const d = drag.current
      if (d.node) {
        d.node.fixed = false
        if (!d.moved) openNote(d.node.id)
      }
      drag.current = { node: null, panning: false, lastX: 0, lastY: 0, moved: false }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = size()
      const factor = e.deltaY < 0 ? 1.12 : 0.9
      const k = Math.min(4, Math.max(0.2, view.current.k * factor))
      // zoom around the cursor
      const mx = e.clientX - rect.left - rect.width / 2
      const my = e.clientY - rect.top - rect.height / 2
      view.current.x = mx - ((mx - view.current.x) * k) / view.current.k
      view.current.y = my - ((my - view.current.y) * k) / view.current.k
      view.current.k = k
    }
    const onLeave = () => setHover(null)
    canvas.addEventListener('mousedown', onDown)
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseleave', onLeave)
    window.addEventListener('mouseup', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('mousedown', onDown)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('mouseup', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [graph, activeNote])

  const zoom = (factor: number) => {
    const k = Math.min(4, Math.max(0.2, view.current.k * factor))
    view.current.x *= k / view.current.k
    view.current.y *= k / view.current.k
    view.current.k = k
  }

  const light = !document.documentElement.classList.contains('dark')
  const orphans = graph.nodes.filter((n) => n.degree === 0).length

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex shrink-0 flex-wrap items-center gap-3 border-b px-6 py-3">
        <div>
          <h1 className="text-lg font-bold">Graph</h1>
          <p className="text-muted-foreground text-xs">
            {graph.nodes.length} notes · {graph.edges.length} links
            {orphans > 0 && ` · ${orphans} unlinked`}
          </p>
        </div>
        <label className="bg-accent/40 focus-within:ring-primary/60 ml-auto flex h-9 w-56 items-center gap-2 rounded-lg px-3 ring-1 ring-transparent">
          <HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={1.8} className="text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Highlight notes…"
            className="text-foreground placeholder:text-muted-foreground/70 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <label className="text-foreground/80 flex items-center gap-2 text-sm">
          <Switch size="sm" checked={showLabels} onCheckedChange={setShowLabels} /> Labels
        </label>
        <label
          className={cn('text-foreground/80 flex items-center gap-2 text-sm', !activeNote && 'opacity-50')}
          title={activeNote ? `Only ${activeNote} and notes within 2 links` : 'Open a note first'}
        >
          <Switch size="sm" checked={local} disabled={!activeNote} onCheckedChange={setLocal} /> Local
        </label>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => zoom(1.25)}>
            +
          </Button>
          <Button variant="outline" size="sm" onClick={() => zoom(0.8)}>
            −
          </Button>
          <Button variant="outline" size="sm" onClick={() => fitRef.current()}>
            Fit
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="block h-full w-full" />
        {graph.groups.length > 1 && (
          <div className="bg-background/80 border-border text-muted-foreground absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs backdrop-blur">
            {graph.groups.map((g, i) => (
              <span key={g} className="flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-full" style={{ background: groupColor(i, light) }} />
                {g === '/' ? 'root' : g}
              </span>
            ))}
            {orphans > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="bg-muted-foreground inline-block size-2.5 rounded-full" /> unlinked
              </span>
            )}
          </div>
        )}
        {hover && (
          <div className="bg-popover text-popover-foreground border-border pointer-events-none absolute top-3 left-3 rounded-md border px-2.5 py-1.5 text-xs shadow">
            {hover.replace(/\.md$/i, '')}
          </div>
        )}
      </div>
    </div>
  )
}
