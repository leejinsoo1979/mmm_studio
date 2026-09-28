import { ToolCursorHints } from './tool-cursor-hints'

export function RoofHelper() {
  return (
    <ToolCursorHints
      hints={[
        { keys: ['Left click'], label: '모서리 지정' },
        { keys: ['Esc'], label: '취소' },
      ]}
    />
  )
}
