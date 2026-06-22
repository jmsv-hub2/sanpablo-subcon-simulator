import { PHASE_COLOR, PHASE_LABEL } from '../constants.js'

const PHASE_ORDER = [0, 1, 2, 3, 4, 5, 6]

export default function Legend() {
  return (
    <div className="legend">
      {PHASE_ORDER.map(ph => (
        <span key={ph}>
          <span className="sw" style={{ background: PHASE_COLOR[ph] }} />
          {PHASE_LABEL[ph]}
        </span>
      ))}
    </div>
  )
}
