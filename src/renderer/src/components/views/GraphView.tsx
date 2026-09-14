import { useEffect, useMemo, useRef, useState } from 'react'
import { openNote } from '@/lib/actions'
import { resolveWikiTarget } from '@/lib/notes'
import { useIndexStore } from '@/stores/indexStore'
import { useTabsStore } from '@/stores/tabsStore'
import { useVaultStore } from '@/stores/vaultStore'
import { ViewShell } from './ViewShell'

interface Node {
  id: string
  label: string
  x: number
  y: number
  vx: number
  vy: number
  degree: number
}
interface Edge {
  a: number
  b: number
}

/** Build nodes/edges from the note index; edges are resolved wiki / md links. */
function buildGraph(notes: { path: string; name: string; links: string[] }[]) {
  const index = new Map(notes.map((n, i) => [n.path, i]))
  const nodes: Node[] = notes.map((n, i) => ({
    id: n.path,
    label: n.name,
    x: Math.cos((i / notes.length) * Math.PI * 2) * 200 + (Math.random() - 0.5) * 40,
    y: Math.sin((i / notes.length) * Math.PI * 2) * 200 + (Math.random() - 0.5) * 40,
    vx: 0,
    vy: 0,
    degree: 0,
  }))
  const edges: Edge[] = []
  const seen = new Set<string>()
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
      nodes[a].degree++
      nodes[b].degree++
    }
  }
  return { nodes, edges }
}

export function GraphView() {
  const notes = useIndexStore((s) => s.notes)
  const activeId = useTabsStore((s) => s.activeId)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const graph = useMemo(() => buildGraph(notes), [notes])
  const [hover, setHover] = useState<string | null>(null)
  const view = useRef({ x: 0, y: 0, k: 1 })
  const drag = useRef<{ node: Node | null; panning: boolean; lastX: number; lastY: number }>({
    node: null,
    panning: false,
    lastX: 0,
    lastY: 0,
  })
  const hoverRef = useRef<string | null>(null)
  hoverRef.current = hover

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const { nodes, edges } = graph
    let raf = 0
    let alpha = 1
    const css = getComputedStyle(document.documentElement)
    const colors = {
      node: css.getPropertyValue('--muted-foreground').trim() || '#888',
      accent: css.getPropertyValue('--primary').trim() || '#f26a1b',
      edge: 'rgba(128,128,128,0.35)',
      text: css.getPropertyValue('--foreground').trim() || '#eee',
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const step = () => {
      // simple force simulation: repulsion + spring edges + gravity toward centre
      if (alpha > 0.005) {
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i]
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j]
            let dx = b.x - a.x
            let dy = b.y - a.y
            let d2 = dx * dx + dy * dy || 0.01
            if (d2 < 1) {
              dx = Math.random() - 0.5
              dy = Math.random() - 0.5
              d2 = 1
            }
            const f = (1800 / d2) * alpha
            const inv = 1 / Math.sqrt(d2)
            a.vx -= dx * inv * f
            a.vy -= dy * inv * f
            b.vx += dx * inv * f
            b.vy += dy * inv * f
          }
          a.vx -= a.x * 0.01 * alpha
          a.vy -= a.y * 0.01 * alpha
        }
        for (const e of edges) {
          const a = nodes[e.a]
          const b = nodes[e.b]
          const dx = b.x - a.x
          const dy = b.y - a.y
          const d = Math.sqrt(dx * dx + dy * dy) || 1
          const f = ((d - 90) / d) * 0.05 * alpha
          a.vx += dx * f
          a.vy += dy * f
          b.vx -= dx * f
          b.vy -= dy * f
        }
        for (const n of nodes) {
          if (n === drag.current.node) continue
          n.x += n.vx
          n.y += n.vy
          n.vx *= 0.6
          n.vy *= 0.6
        }
        alpha *= 0.985
      }

      const rect = canvas.getBoundingClientRect()
      ctx.clearRect(0, 0, rect.width, rect.height)
      ctx.save()
      ctx.translate(rect.width / 2 + view.current.x, rect.height / 2 + view.current.y)
      ctx.scale(view.current.k, view.current.k)

      ctx.strokeStyle = colors.edge
      ctx.lineWidth = 1
      for (const e of edges) {
        ctx.beginPath()
        ctx.moveTo(nodes[e.a].x, nodes[e.a].y)
        ctx.lineTo(nodes[e.b].x, nodes[e.b].y)
        ctx.stroke()
      }
      const hovered = hoverRef.current
      for (const n of nodes) {
        const r = 4 + Math.min(10, n.degree * 1.5)
        const highlight = n.id === activeId || n.id === hovered
        ctx.beginPath()
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
        ctx.fillStyle = highlight ? colors.accent : colors.node
        ctx.fill()
        if (highlight || view.current.k > 0.8 || n.degree > 0) {
          ctx.fillStyle = colors.text
          ctx.globalAlpha = highlight ? 1 : 0.75
          ctx.font = `${highlight ? 600 : 400} 12px system-ui, sans-serif`
          ctx.textAlign = 'center'
          ctx.fillText(n.label, n.x, n.y + r + 13)
          ctx.globalAlpha = 1
        }
      }
      ctx.restore()
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)

    const toGraph = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      return {
        x: (e.clientX - rect.left - rect.width / 2 - view.current.x) / view.current.k,
        y: (e.clientY - rect.top - rect.height / 2 - view.current.y) / view.current.k,
      }
    }
    const nodeAt = (p: { x: number; y: number }) => {
      let best: Node | null = null
      let bestD = 14 / view.current.k
      for (const n of nodes) {
        const d = Math.hypot(n.x - p.x, n.y - p.y)
        if (d < bestD) {
          best = n
          bestD = d
        }
      }
      return best
    }
    const onDown = (e: MouseEvent) => {
      const n = nodeAt(toGraph(e))
      drag.current = { node: n, panning: !n, lastX: e.clientX, lastY: e.clientY }
      alpha = Math.max(alpha, 0.3)
    }
    const onMove = (e: MouseEvent) => {
      const d = drag.current
      if (d.node) {
        const p = toGraph(e)
        d.node.x = p.x
        d.node.y = p.y
        alpha = Math.max(alpha, 0.3)
      } else if (d.panning) {
        view.current.x += e.clientX - d.lastX
        view.current.y += e.clientY - d.lastY
        d.lastX = e.clientX
        d.lastY = e.clientY
      } else {
        const n = nodeAt(toGraph(e))
        setHover(n?.id ?? null)
        canvas.style.cursor = n ? 'pointer' : 'grab'
      }
    }
    const onUp = (e: MouseEvent) => {
      const d = drag.current
      const moved = Math.hypot(e.clientX - d.lastX, e.clientY - d.lastY) > 3
      if (d.node && !moved) openNote(d.node.id)
      drag.current = { node: null, panning: false, lastX: 0, lastY: 0 }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const k = Math.min(3, Math.max(0.3, view.current.k * (e.deltaY < 0 ? 1.1 : 0.9)))
      view.current.k = k
    }
    canvas.addEventListener('mousedown', onDown)
    canvas.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('mousedown', onDown)
      canvas.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [graph, activeId])

  const notesCount = useVaultStore((s) => s.notes.length)

  return (
    <ViewShell
      title="Graph"
      description={`${notesCount} notes, ${graph.edges.length} links · drag to move, scroll to zoom, click to open`}
      wide
    >
      <canvas ref={canvasRef} className="border-border h-[60vh] w-full rounded-xl border" />
    </ViewShell>
  )
}
