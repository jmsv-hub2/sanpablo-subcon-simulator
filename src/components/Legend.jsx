import { PHASE_COLOR, PHASE_LABEL } from '../constants.js'

const PHASE_ORDER = [0, 1, 2, 3, 4, 5, 6]

export default function Legend({ activeSubs }) {
  return (
    <div className="legend">
      {PHASE_ORDER.map(ph => (
        <span key={ph}>
          <span className="sw" style={{ background: PHASE_COLOR[ph] }} />
          {PHASE_LABEL[ph]}
        </span>
      ))}
      {activeSubs.length > 0 && (
        <>
          <span style={{ marginLeft: 10, color: 'var(--text)' }}>Subcontractors:</span>
          {activeSubs.map(s => (
            <span key={s.name}>
              <span className="sw" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </>
      )}
    </div>
  )
}
