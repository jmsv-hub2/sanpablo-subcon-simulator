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

export default function MapCanvas({ derived, layerLabels, setLayerLabels, layerTableLabels, setLayerTableLabels, zoneSatisfiedDay, dayIdx }) {
  const canvasRef   = useRef(null)
  const viewRef     = useRef({ scale: 1, offX: 0, offY: 0 })
  const panRef      = useRef({ active: false, startX: 0, startY: 0, offX0: 0, offY0: 0 })
  const fitDoneRef  = useRef(false)

  const resetView = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return false
    const wrap = canvas.parentElement
    const w = wrap.clientWidth, h = wrap.clientHeight
    if (w === 0 || h === 0) return false
    canvas.width = w
    canvas.height = h
    const pad = 30
    const parkW = BOUNDS.maxX - BOUNDS.minX
    const parkH = BOUNDS.maxY - BOUNDS.minY
    const scale = Math.min((w - 2 * pad) / parkW, (h - 2 * pad) / parkH)
    const offX = (w - parkW * scale) / 2 - BOUNDS.minX * scale
    const offY = (h - parkH * scale) / 2 - BOUNDS.minY * scale
    viewRef.current = { scale, offX, offY }
    return true
  }, [])

  const draw = useCallback((d, showLabels, showTableLabels) => {
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
      const fill   = PHASE_COLOR[ph]  ?? NEUTRAL_FILL
      const stroke = PHASE_BORDER[ph] ?? NEUTRAL_BORDER
      roundRectPath(tx, ty, RW, RH, 0.5)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.strokeStyle = stroke
      ctx.lineWidth = 0.15
      ctx.stroke()
    })

    // Per-table ID labels
    if (showTableLabels) {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `${Math.min(2.2, 2.2)}px Segoe UI`
      ctx.fillStyle = 'rgba(255,255,255,0.65)'
      TABLES.forEach(t => {
        ctx.fillText(t.id, t.x + ROX + RW / 2, t.y + ROY + RH / 2)
      })
    }

    // Zone centroid labels
    if (showLabels) {
      ZONES.forEach(z => {
        const c = ZONE_CENTROID[z]
        const satisfied = zoneSatisfiedDay && dayIdx !== undefined && zoneSatisfiedDay[z] !== undefined && zoneSatisfiedDay[z] <= dayIdx
        ctx.font = `bold ${12 / view.scale}px Segoe UI`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = satisfied ? 'rgba(74,222,128,.9)' : 'rgba(255,255,255,.5)'
        ctx.fillText('MVPS ' + z, c.x - 10 / view.scale, c.y - 8 / view.scale)
      })
    }

    ctx.restore()
  }, [zoneSatisfiedDay, dayIdx])

  // Initial auto-fit: call resetView the first time the canvas has real dimensions
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      const wrap = canvas.parentElement
      const w = wrap.clientWidth, h = wrap.clientHeight
      if (w > 0 && h > 0) {
        if (!fitDoneRef.current) {
          fitDoneRef.current = true
          resetView()
        } else if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w
          canvas.height = h
        }
        draw(derived, layerLabels, layerTableLabels)
      }
    })
    ro.observe(canvas.parentElement)
    return () => ro.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw, derived, layerLabels, layerTableLabels])

  useEffect(() => {
    draw(derived, layerLabels, layerTableLabels)
  }, [derived, layerLabels, layerTableLabels, draw])

  const onMouseDown = useCallback(e => {
    panRef.current = { active: true, startX: e.clientX, startY: e.clientY, offX0: viewRef.current.offX, offY0: viewRef.current.offY }
  }, [])

  useEffect(() => {
    const onMove = e => {
      if (!panRef.current.active) return
      const p = panRef.current
      viewRef.current.offX = p.offX0 + (e.clientX - p.startX)
      viewRef.current.offY = p.offY0 + (e.clientY - p.startY)
      draw(derived, layerLabels, layerTableLabels)
    }
    const onUp = () => { panRef.current.active = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [draw, derived, layerLabels, layerTableLabels])

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
    draw(derived, layerLabels, layerTableLabels)
  }, [draw, derived, layerLabels, layerTableLabels])

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
        <button className={`layer-btn${layerLabels ? ' on' : ''}`} onClick={() => setLayerLabels(p => !p)}>
          <span className="lb-pip" /> MVPS labels
        </button>
        <button className={`layer-btn${layerTableLabels ? ' on' : ''}`} onClick={() => setLayerTableLabels(p => !p)}>
          <span className="lb-pip" /> Table IDs
        </button>
      </div>
      <button className="fit-btn" onClick={() => { resetView(); draw(derived, layerLabels, layerTableLabels) }} title="Fit map to screen">{'⊡'}</button>
    </div>
  )
}
