export type Grain = 'horizontal' | 'vertical'

/**
 * mmmcraft getDefaultGrainDirection (materialConstants.ts): the default wood
 * grain of a panel from its name. vertical = along the height (L = Y),
 * horizontal = along the width (L = X).
 */
export function defaultGrain(name?: string): Grain {
  if (!name) return 'vertical'
  const has = (s: string) => name.includes(s)
  if (has('백패널')) return 'vertical'
  if (has('바닥') && has('서랍')) return 'horizontal'
  if (has('마이다')) return 'horizontal'
  if (has('서랍') && has('앞판')) return 'horizontal'
  if (has('서랍') && has('뒷판')) return 'horizontal'
  if (has('서랍') && (has('좌측판') || has('우측판'))) return 'horizontal'
  if (has('서랍속장')) return 'vertical'
  if (has('커튼박스')) return 'vertical'
  if (has('상부 EP 앞판') || has('상부 EP 뒷턱')) return 'vertical'
  if (has('키큰장찬넬 전면프레임') || has('키큰장찬넬 좌EP') || has('키큰장찬넬 우EP')) {
    return 'vertical'
  }
  if (has('목찬넬프레임수평')) return 'horizontal'
  if (has('목찬넬프레임수직')) return 'horizontal'
  if (has('좌측') || has('우측') || has('측판')) return 'vertical'
  if (has('칸막이')) return 'vertical'
  if (has('좌우 분할판')) return 'vertical'
  if (has('도어') || has('Door')) return 'vertical'
  if (has('상판') || has('바닥')) return 'horizontal'
  if (has('선반')) return 'horizontal'
  if (has('분할판')) return 'horizontal'
  if (has('보강대')) return 'horizontal'
  return 'horizontal'
}
