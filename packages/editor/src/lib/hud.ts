import type { CSSProperties } from 'react'

/**
 * Text drawn straight over the scene (breadcrumb, key legend, filter row, hint
 * line, cursor hints) takes its tone from the scene theme, not the UI theme:
 * a dark UI over a light scene must still read dark-on-light. The vars are
 * set once on the v2 layout root by `hudVars`.
 */
export const HUD_TEXT = 'text-[color:var(--hud-fg)] [text-shadow:var(--hud-shadow)]'

export const HUD_MUTED = 'text-[color:var(--hud-muted)] [text-shadow:var(--hud-shadow)]'

export const HUD_KEYCAP =
  'inline-flex h-5 min-w-5 items-center justify-center rounded px-1.5 bg-[color:var(--hud-keycap)] font-semibold text-[10px] leading-none text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] [text-shadow:none]'

export type HudAppearance = 'light' | 'dark'

export function hudVars(appearance: HudAppearance): CSSProperties {
  return (
    appearance === 'dark'
      ? {
          '--hud-fg': '#ffffff',
          '--hud-muted': 'rgba(255,255,255,0.75)',
          '--hud-shadow': '0 1px 3px rgba(0,0,0,0.55)',
          '--hud-keycap': 'rgba(158,158,158,0.75)',
        }
      : {
          '--hud-fg': '#262626',
          '--hud-muted': '#5c5c5c',
          '--hud-shadow': '0 0 4px rgba(255,255,255,0.95), 0 0 2px rgba(255,255,255,0.95)',
          '--hud-keycap': 'rgba(80,80,80,0.72)',
        }
  ) as CSSProperties
}
