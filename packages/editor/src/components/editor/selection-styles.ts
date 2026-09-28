import type { HoverStyles, SelectionOutlineStyle } from '@pascal-app/viewer'

/**
 * inZOI's selection edge: a thin, crisp cyan line with only a faint halo,
 * painted over the scene so it reads on white furniture and the light canvas
 * alike. Occluded parts show as a faint cyan, never yellow.
 */
export const EDITOR_SELECTION_STYLE: SelectionOutlineStyle = {
  visibleColor: 0x2e_c4_ff,
  hiddenColor: 0x7f_d6_ff,
  strength: 3,
  pulse: false,
  thickness: 1.25,
  glow: 0.35,
  blend: 'over',
  hiddenOpacity: 0.35,
}

/** Hover: a thin, steady pale-cyan edge, lighter than the selection. */
export const EDITOR_HOVER_STYLES: HoverStyles = {
  default: {
    visibleColor: 0x9f_e0_ff,
    hiddenColor: 0x9f_e0_ff,
    strength: 3,
    pulse: false,
    thickness: 1,
    blend: 'over',
    hiddenOpacity: 0.25,
  },
  delete: {
    visibleColor: 0xef_44_44,
    hiddenColor: 0x99_1b_1b,
    strength: 6,
    pulse: false,
    thickness: 1.5,
    blend: 'over',
  },
  'paint-ready': {
    visibleColor: 0x7f_d6_ff,
    hiddenColor: 0xd8_ee_f8,
    strength: 4,
    pulse: false,
    thickness: 1.5,
    glow: 0.4,
    blend: 'over',
    hiddenOpacity: 0.3,
  },
  'paint-disabled': {
    visibleColor: 0x94_a3_b8,
    hiddenColor: 0x47_55_69,
    strength: 4,
    pulse: false,
    blend: 'over',
  },
}
