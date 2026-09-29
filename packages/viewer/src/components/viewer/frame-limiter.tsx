import { useThree } from '@react-three/fiber'
import { useLayoutEffect } from 'react'
import useViewer from '../../store/use-viewer'

type FrameLimiterProps = {
  fps?: number
}

const FrameLimiter: React.FC<FrameLimiterProps> = ({ fps = 50 }) => {
  const { advance, set, frameloop: initFrameloop, clock } = useThree()
  const renderer = useThree((state) => state.gl)
  // Fully covered canvas (e.g. studio gallery) → stop advancing frames
  const renderPaused = useViewer((s) => s.renderPaused)

  useLayoutEffect(() => {
    if (renderPaused) return
    // Display frames land a little early or late: a strict `elapsed > interval`
    // drops every other one whenever the cap matches the refresh rate (60 on a
    // 60 Hz screen), and motion stutters. Draw any frame at least ¾ of an
    // interval on, stepping the clock by the real time that passed.
    const minGap = (1000 / fps) * 0.75
    let last: number | null = null
    let time = clock.elapsedTime
    let raf: number | null = null
    function tick(t: DOMHighResTimeStamp) {
      raf = requestAnimationFrame(tick)
      if (last !== null && t - last < minGap) return
      if (last !== null) time += (t - last) / 1000
      last = t
      advance(time)
    }
    // Set frameloop to never, it will shut down the default render loop
    set({ frameloop: 'never' })
    // Kick off custom render loop
    raf = requestAnimationFrame(tick)
    // Restore initial setting
    return () => {
      if (raf) {
        cancelAnimationFrame(raf)
      }
      set({ frameloop: initFrameloop })
    }
  }, [fps, advance, set, initFrameloop, renderPaused, clock])

  return null
}

export default FrameLimiter
