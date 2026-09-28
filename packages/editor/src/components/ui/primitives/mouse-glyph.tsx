export type MouseButton = 'left' | 'right' | 'wheel'

/**
 * inZOI's mouse capsule with the button in use filled. Drawn in the HUD tone
 * (`--hud-fg`) so it reads on light and dark scenes alike.
 */
export function MouseGlyph({ button, className }: { button: MouseButton; className?: string }) {
  const ink = 'var(--hud-fg, #262626)'
  return (
    <svg
      aria-hidden="true"
      className={className ?? 'h-[18px] w-[13px] shrink-0'}
      fill="none"
      viewBox="0 0 16 22"
    >
      <rect
        fill="rgba(255,255,255,0.35)"
        height="20"
        rx="7"
        stroke={ink}
        strokeWidth="1.5"
        width="14"
        x="1"
        y="1"
      />
      {button === 'left' ? <path d="M8 1.75H7A5.25 5.25 0 0 0 1.75 7v2H8z" fill={ink} /> : null}
      {button === 'right' ? <path d="M8 1.75h1A5.25 5.25 0 0 1 14.25 7v2H8z" fill={ink} /> : null}
      <path d="M8 1v8M1.5 9h13" stroke={ink} strokeWidth="1.2" />
      <rect
        fill={button === 'wheel' ? ink : 'none'}
        height="4.5"
        rx="1.25"
        stroke={ink}
        strokeWidth="1"
        width="2.5"
        x="6.75"
        y="3.5"
      />
    </svg>
  )
}
