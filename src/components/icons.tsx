// Inline SVG icon set - no external dependencies.
// Icons use stroke="currentColor" so CSS controls their color.

interface IconProps {
  size?: number
  className?: string
}

function svgProps(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  }
}

/** Quadcopter drone (top view with gimbal camera) */
export function DroneIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="4.6" cy="4.6" r="2.9" />
      <circle cx="19.4" cy="4.6" r="2.9" />
      <circle cx="4.6" cy="19.4" r="2.9" />
      <circle cx="19.4" cy="19.4" r="2.9" />
      <path d="M6.8 6.8 L10 10 M17.2 6.8 L14 10 M6.8 17.2 L10 14 M17.2 17.2 L14 14" />
      <rect x="8.8" y="8.8" width="6.4" height="5.2" rx="1.6" />
      <path d="M12 14v1.8" />
      <circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Dual-lens 360 camera (Insta360 X-style body) with orbit ring */
export function Insta360Icon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="4.5" y="7.5" width="15" height="9" rx="3.2" />
      <circle cx="9.2" cy="12" r="2.5" />
      <circle cx="14.8" cy="12" r="2.5" />
      <circle cx="9.2" cy="12" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="12" r="0.8" fill="currentColor" stroke="none" />
      <path d="M17.6 9.6h0.01" strokeWidth="2.4" />
      <path d="M2 20.5c3-1.4 6.5-2.1 10-2.1s7 .7 10 2.1" strokeDasharray="0.5 2.4" />
    </svg>
  )
}

/** Generic video / filmstrip */
export function VideoIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.2" />
      <path d="M7 5.5v13 M17 5.5v13" />
      <path d="M2.5 9.2h4.5 M2.5 14.8h4.5 M17 9.2h4.5 M17 14.8h4.5" />
      <path d="M10.4 9.6l4 2.4-4 2.4z" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Photo (mountain + sun in frame) */
export function PhotoIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.2" />
      <circle cx="8.6" cy="9.6" r="1.7" />
      <path d="M3.6 16.8l4.6-4.2 3.4 3 3.6-3.4 5.2 4.6" />
    </svg>
  )
}

/** Music note */
export function AudioIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M9.5 17.4V6.2l9-1.8v11" />
      <ellipse cx="7.2" cy="17.5" rx="2.4" ry="1.9" />
      <ellipse cx="16.2" cy="15.5" rx="2.4" ry="1.9" />
    </svg>
  )
}

/** Waveform / stabilization glyph used for track headers */
export function WaveIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M3 12h2.4l1.8-5 2.4 10 2.4-13 2.4 10 1.8-4H21" />
    </svg>
  )
}
