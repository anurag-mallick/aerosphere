import type { ClipKeyframe, TimelineClip } from '../types/editor'
import type { ClipColorAdjust } from '../types/editor'
import { pickLutFile } from '../core/ffmpeg'
import { uid } from '../utils/format'
import { interpolateChannel } from '../utils/keyframes'
import { DroneIcon, Insta360Icon, PhotoIcon } from './icons'

const SPEED_STEPS = [0.25, 0.5, 1, 2, 4]

export interface PerspectivePreset {
  name: string
  tilt?: number
  fov: number
}

/** Insta360 Studio-style perspective presets (360° clips) */
export const PERSPECTIVE_PRESETS: PerspectivePreset[] = [
  { name: 'Natural', fov: 75 },
  { name: 'Wide', fov: 100 },
  { name: 'Ultra Wide', fov: 125 },
  { name: 'Narrow', fov: 40 },
  { name: 'Fisheye', fov: 140 },
  { name: 'Tiny Planet', tilt: 90, fov: 115 },
  { name: 'Crystal Ball', tilt: -90, fov: 115 },
]

interface InspectorProps {
  clip: TimelineClip | null
  /** playhead position relative to the clip start, or null if outside */
  clipPlayhead: number | null
  onUpdateClip: (patch: Partial<TimelineClip>) => void
  onChangeSpeed: (speed: number) => void
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="inspector-row">
      <span className="inspector-label">{label}</span>
      <div className="inspector-control">{children}</div>
    </div>
  )
}

export function Inspector(props: InspectorProps) {
  const { clip, clipPlayhead } = props

  if (!clip || clip.kind === 'audio') {
    return (
      <aside className="inspector">
        <p className="empty-hint">
          Select a clip on the timeline to edit speed, colors and keyframed reframing.
        </p>
      </aside>
    )
  }

  const is360 = !!clip.is360
  const kfs = clip.keyframes ?? []
  const sortedKfs = [...kfs].sort((a, b) => a.time - b.time)

  const canPlaceKf = clip.kind === 'video' && clipPlayhead !== null && clipPlayhead >= 0 && clipPlayhead <= clip.duration

  const addKeyframe = () => {
    if (!canPlaceKf || clipPlayhead === null) return
    const t = Math.round(Math.min(Math.max(clipPlayhead, 0), clip.duration) * 100) / 100
    // start from interpolated values so new keyframes don't jump
    const nf: ClipKeyframe = {
      id: uid('kf'),
      time: t,
      pan: Math.round(interpolateChannel(kfs, t, 'pan', 0)),
      tilt: Math.round(interpolateChannel(kfs, t, 'tilt', 0)),
      roll: Math.round(interpolateChannel(kfs, t, 'roll', 0)),
      fov: Math.round(interpolateChannel(kfs, t, 'fov', is360 ? 90 : 1) * 10) / 10,
      easing: 'ease',
    }
    props.onUpdateClip({ keyframes: [...kfs.filter((k) => Math.abs(k.time - t) > 0.05), nf] })
  }

  const updateKf = (id: string, patch: Partial<ClipKeyframe>) => {
    props.onUpdateClip({
      keyframes: kfs.map((k) => (k.id === id ? { ...k, ...patch } : k)),
    })
  }

  const removeKf = (id: string) => {
    props.onUpdateClip({ keyframes: kfs.filter((k) => k.id !== id) })
  }

  const ca: ClipColorAdjust = clip.colorAdjust ?? { brightness: 0, contrast: 0, saturation: 0 }

  return (
    <aside className="inspector">
      <header className="inspector-header">
        {clip.kind === 'photo' ? (
          <PhotoIcon size={16} />
        ) : clip.is360 ? (
          <Insta360Icon size={16} />
        ) : (
          <DroneIcon size={16} />
        )}
        <span className="clip-name" title={clip.name}>
          {clip.name}
        </span>
        {is360 && <span className="badge-insv">360°</span>}
      </header>

      {clip.kind === 'video' && (
        <Row label="Speed">
          <div className="speed-picker">
            {SPEED_STEPS.map((s) => (
              <button
                key={s}
                className={`btn-tiny ${Math.abs((clip.speed ?? 1) - s) < 1e-6 ? 'active' : ''}`}
                onClick={() => props.onChangeSpeed(s)}
              >
                {s}×
              </button>
            ))}
          </div>
        </Row>
      )}

      <Row label="Colors">
        <div className="color-sliders">
          {(
            [
              ['Brightness', 'brightness'],
              ['Contrast', 'contrast'],
              ['Saturation', 'saturation'],
              ['Temperature', 'temperature'],
              ['Tint', 'tint'],
            ] as const
          ).map(([label, key]) => (
            <label key={key} className="mini-slider">
              <span>{label}</span>
              <input
                type="range"
                min={-100}
                max={100}
                value={Math.round((ca[key] ?? 0) * 100)}
                onChange={(e) =>
                  props.onUpdateClip({
                    colorAdjust: { ...ca, [key]: Number(e.target.value) / 100 },
                  })
                }
              />
            </label>
          ))}
        </div>
      </Row>

      {clip.kind === 'video' && (
        <>
          <Row label="Log / LUT (DJI D-Log M)">
            <div className="log-controls">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={!!clip.logNormalize}
                  onChange={(e) => props.onUpdateClip({ logNormalize: e.target.checked })}
                />
                <span className="small">normalize to Rec.709 (approx.)</span>
              </label>
              <div className="lut-row">
                <button
                  className="btn-tiny"
                  onClick={async () => {
                    const p = await pickLutFile()
                    if (p) props.onUpdateClip({ lutPath: p })
                  }}
                >
                  {clip.lutPath ? 'Change .cube' : 'Load .cube LUT'}
                </button>
                {clip.lutPath && (
                  <button
                    className="btn-tiny btn-danger"
                    title={clip.lutPath}
                    onClick={() => props.onUpdateClip({ lutPath: undefined })}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </Row>

          {clip.srtPath && (
            <Row label="Telemetry SRT">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={!!clip.burnSubtitles}
                  onChange={(e) => props.onUpdateClip({ burnSubtitles: e.target.checked })}
                />
                <span className="small" title={clip.srtPath}>
                  burn flight data overlay ({clip.srtPath.split(/[\\/]/).pop()})
                </span>
              </label>
            </Row>
          )}

          <Row label="Fades">
            <div className="color-sliders">
              {(
                [
                  ['Fade in', 'fadeIn'],
                  ['Fade out', 'fadeOut'],
                ] as const
              ).map(([label, key]) => (
                <label key={key} className="mini-slider">
                  <span>{label}</span>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.25}
                    value={clip[key] ?? 0}
                    onChange={(e) => props.onUpdateClip({ [key]: Number(e.target.value) })}
                  />
                </label>
              ))}
            </div>
          </Row>

          <Row label={`Volume ${Math.round((clip.volume ?? 1) * 100)}%`}>
            <div className="volume-row">
              <input
                type="range"
                min={0}
                max={200}
                value={clip.muted ? 0 : Math.round((clip.volume ?? 1) * 100)}
                onChange={(e) => props.onUpdateClip({ volume: Number(e.target.value) / 100 })}
                style={{ width: '100%', accentColor: '#e94560' }}
              />
              <label className="check-label" title="Silence this clip's audio in preview and export">
                <input
                  type="checkbox"
                  checked={!!clip.muted}
                  onChange={(e) => props.onUpdateClip({ muted: e.target.checked })}
                />
                <span className="small">Mute</span>
              </label>
            </div>
          </Row>
        </>
      )}

      {clip.kind === 'video' && is360 && (
        <Row label="Lens FOV">
          <div className="lensfov-row">
            <input
              type="range"
              min={120}
              max={300}
              step={5}
              value={clip.lensFov ?? 220}
              onChange={(e) => props.onUpdateClip({ lensFov: Number(e.target.value) })}
              style={{ flex: 1, accentColor: '#e94560' }}
            />
            <span className="small">{clip.lensFov ?? 220}°</span>
            <button className="btn-tiny" onClick={() => props.onUpdateClip({ lensFov: 220 })}>
              Reset
            </button>
          </div>
        </Row>
      )}

      {clip.kind === 'video' && !is360 && (
        <Row label="Stabilize">
          <label className="check-label">
            <input
              type="checkbox"
              checked={!!clip.stabilize}
              onChange={(e) => props.onUpdateClip({ stabilize: e.target.checked })}
            />
            <span className="small">two-pass stabilization on export</span>
          </label>
        </Row>
      )}

      <section className="kf-section">
        <header className="kf-header">
          <h3>Keyframes</h3>
          <button className="btn-tiny" onClick={addKeyframe} disabled={!canPlaceKf}>
            + At playhead
          </button>
        </header>
        {!canPlaceKf && (
          <p className="empty-hint">Move the playhead over this clip to place keyframes.</p>
        )}
        {sortedKfs.length === 0 ? (
          <p className="empty-hint">
            {is360
              ? 'Add keyframes to pan/zoom the 360° view.'
              : 'Add keyframes to pan/zoom the virtual camera.'}
          </p>
        ) : (
          <ul className="kf-list">
            {sortedKfs.map((k) => (
              <li key={k.id} className="kf-item">
                <span className="kf-time">{k.time.toFixed(2)}s</span>
                <span className="kf-values">
                  {is360
                    ? `${k.pan}° ${k.tilt > 0 ? '+' : ''}${k.tilt}° · ${k.fov}°`
                    : `×${k.fov.toFixed(1)} ${k.pan > 0 ? '→' : k.pan < 0 ? '←' : '·'} ${k.tilt > 0 ? '↓' : k.tilt < 0 ? '↑' : ''}`}
                </span>
                <select
                  className="kf-easing"
                  value={k.easing}
                  onChange={(e) =>
                    updateKf(k.id, { easing: e.target.value as ClipKeyframe['easing'] })
                  }
                >
                  <option value="ease">Ease</option>
                  <option value="linear">Linear</option>
                </select>
                <button className="btn-tiny btn-danger" onClick={() => removeKf(k.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        {sortedKfs.length > 0 && (
          <div className="kf-editors">
            <p className="inspector-note">
              Edit values per keyframe:
            </p>
            {sortedKfs.map((k) => (
              <details key={k.id} className="kf-editor">
                <summary>
                  @ {k.time.toFixed(2)}s —{' '}
                  {is360
                    ? `yaw ${k.pan}° · pitch ${k.tilt}° · roll ${k.roll}° · fov ${k.fov}°`
                    : `zoom ×${Number(k.fov).toFixed(1)} · pan ${k.pan} · tilt ${k.tilt}`}
                  {is360 && (
                    <button
                      className="btn-tiny"
                      title="Reset this view"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        updateKf(k.id, { pan: 0, tilt: 0, roll: 0, fov: 90 })
                      }}
                    >
                      ⟲
                    </button>
                  )}
                </summary>
                {(
                  [
                    ['Pan', 'pan', is360 ? [-180, 180] : [-100, 100], 1],
                    ['Tilt', 'tilt', is360 ? [-180, 180] : [-100, 100], 1],
                    ['Roll', 'roll', [-45, 45], 1],
                    [is360 ? 'FOV °' : 'Zoom', 'fov', is360 ? [20, 140] : [1, 4], is360 ? 1 : 0.1],
                  ] as const
                ).map(([label, key, [min, max], step]) => (
                  <label key={key} className="mini-slider">
                    <span>
                      {label} <b>{typeof k[key] === 'number' ? k[key] : ''}</b>
                    </span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={k[key]}
                      onChange={(e) => updateKf(k.id, { [key]: Number(e.target.value) })}
                    />
                  </label>
                ))}
                {is360 && (
                  <div className="presets">
                    {PERSPECTIVE_PRESETS.map((p) => (
                      <button key={p.name} className="btn-tiny" onClick={() => {
                        updateKf(k.id, { tilt: p.tilt ?? k.tilt, fov: p.fov })
                      }}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </details>
            ))}
          </div>
        )}
      </section>
    </aside>
  )
}
