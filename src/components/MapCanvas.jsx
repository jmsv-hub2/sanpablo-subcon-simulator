import { useRef, useEffect, useCallback } from 'react'
import { TABLES, ZONES, TABLES_BY_ZONE } from '../data.js'
import { PHASE_COLOR, PHASE_BORDER, RW, RH, ROX, ROY, NEUTRAL_FILL, NEUTRAL_BORDER } from '../constants.js'

const xs = TABLES.map(t => t.x), ys = TABLES.map(t => t.y)
const BOUNDS = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }

const ZONE_CENTROID = Object.fromEntries(
  ZONES.map(z => {
    const ts = TABLES_BY_ZONE[z]
    return [z, { x: ts.reduce((a, t) => a + t.x, 0) / ts.length, y: ts.reduce((a, t) => a + t.y, 0) / ts.length }]
  })
)

export default function MapCanvas({ derived, subsConfig, layerPhase, setLayerPhase, layerSub, setLayerSub }) {
  const canvasRef = useRef(null)
  const viewRef   = useRef({ scale: 1, offX: 0, offY: 0 })
  const panRef    = useRef({ active: false, startX: 0, startY: 0, offX0: 0, offY0: 0 })

  function subColor(name) {
    const s = subsConfig.find(s => s.name === name)
    return s ? s.color : '#666'
  }

  const resetView = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return false
    const wrap = canvas.parentElement
    const w = wrap.clientWidth, h = wrap.clientHeight
    if (w === 0 || h === 0) return false
    canvas.width = w
    canvas.height = h
    const pad = 30
    const scale = Math.min((w - 2 * pad) / (BOUNDS.maxX - BOUNDS.minX), (h - 2 * pad) / (BOUNDS.maxY - BOUNDS.minY))
    viewRef.current = { scale, offX: pad - BOUNDS.minX * scale, offY: pad - BOUNDS.minY * scale }
    return true
  }, [])

  const draw = useCallback((d, showPhase, showSub) => {
    const canvas = canvasRef.current
    if (!canvas || !d) return
    const ctx = canvas.getContext('2d')
    const view = viewRef.current

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.translate(view.offX, view.offY)
    ctx.scale(view.scale, view.scale)

    function roundRectPath(x, y, w, h, r) {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }

    TABLES.forEach(t => {
      const tx = t.x + ROX, ty = t.y + ROY
      const ph = d.phase[t.id]
      const fill = showPhase ? (PHASE_COLOR[ph] ?? NEUTRAL_FILL) : NEUTRAL_FILL
      const own = d.owner[t.id]
      const subStroke = showSub && own ? subColor(own) : (showPhase ? (PHASE_BORDER[ph] ?? NEUTRAL_BORDER) : NEUTRAL_BORDER)
      roundRectPath(tx, ty, RW, RH, 0.5)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.strokeStyle = subStroke
      ctx.lineWidth = showSub && own ? 0.8 : 0.15
      ctx.stroke()
    })

    // Zone labels
    ZONES.forEach(z => {
      const c = ZONE_CENTROID[z]
      ctx.font = `${12 / view.scale}px Segoe UI`
      ctx.fillStyle = 'rgba(255,255,255,.5)'
      ctx.fillText('MVPS ' + z, c.x - 10 / view.scale, c.y - 8 / view.scale)
    })

    ctx.restore()
  }, [subsConfig])

  useEffect(() => {
    if (viewRef.current.scale === 1 && viewRef.current.offX === 0) resetView()
    draw(derived, layerPhase, layerSub)
  }, [derived, layerPhase, layerSub, draw, resetView])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      if (resetView()) draw(derived, layerPhase, layerSub)
    })
    ro.observe(canvas.parentElement)
    return () => ro.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetView, draw, derived, layerPhase, layerSub])

  const onMouseDown = useCallback(e => {
    panRef.current = { active: true, startX: e.clientX, startY: e.clientY, offX0: viewRef.current.offX, offY0: viewRef.current.offY }
  }, [])

  useEffect(() => {
    const onMove = e => {
      if (!panRef.current.active) return
      const p = panRef.current
      viewRef.current.offX = p.offX0 + (e.clientX - p.startX)
      viewRef.current.offY = p.offY0 + (e.clientY - p.startY)
      draw(derived, layerPhase, layerSub)
    }
    const onUp = () => { panRef.current.active = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [draw, derived, layerPhase, layerSub])

  const onWheel = useCallback(e => {
    e.preventDefault()
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const view = viewRef.current
    const wx = (mx - view.offX) / view.scale, wy = (my - view.offY) / view.scale
    view.scale *= factor
    view.offX = mx - wx * view.scale
    view.offY = my - wy * view.scale
    draw(derived, layerPhase, layerSub)
  }, [draw, derived, layerPhase, layerSub])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [onWheel])

  return (
    <div className="map-wrap">
      <canvas ref={canvasRef} onMouseDown={onMouseDown} />

      <div className="layer-ctrl">
        <label><input type="checkbox" checked={layerPhase} onChange={e => setLayerPhase(e.target.checked)} /> Phase colors</label>
        <label><input type="checkbox" checked={layerSub}   onChange={e => setLayerSub(e.target.checked)}   /> Subcontractor colors</label>
      </div>

      <div className="zoom-ctrl">
        <button onClick={() => { resetView(); draw(derived, layerPhase, layerSub) }} title="Reset view">⤾</button>
      </div>
    </div>
  )
}
