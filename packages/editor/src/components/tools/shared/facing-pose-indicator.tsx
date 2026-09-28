import { useEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import useFacingPose, { type FacingPose } from '../../../store/use-facing-pose'
import { usePlacementFeedback } from '../../../store/use-placement-feedback'
import { FacingIndicator } from './facing-indicator'

type FacingShape = Pick<FacingPose, 'depth' | 'width' | 'center' | 'reversed'>

// The single editor-side renderer for the placement/move facing triangle.
// Mounted once inside ToolManager's building-local group; every tool publishes
// its ghost pose to `useFacingPose` and this draws the triangle. The pose
// (position/yaw) is applied imperatively to a ref so the per-frame cursor
// updates don't re-render React — only a change in footprint shape (depth /
// width / centre), which is constant per tool session, triggers a re-render.
// Hidden while the held item overlaps something (inZOI drops it then).
export function FacingPoseIndicator() {
  const groupRef = useRef<Group>(null)
  const [shape, setShape] = useState<FacingShape | null>(null)

  useEffect(() => {
    const apply = () => {
      const pose = useFacingPose.getState().pose
      const blocked = usePlacementFeedback.getState().blocked
      const group = groupRef.current
      if (group) {
        if (pose) {
          group.visible = !blocked
          group.position.set(...pose.position)
          group.rotation.y = pose.rotationY
        } else {
          group.visible = false
        }
      }
      setShape((prev) => {
        if (!pose) return null
        const center = pose.center ?? [0, 0]
        if (
          prev &&
          prev.depth === pose.depth &&
          prev.width === pose.width &&
          prev.reversed === pose.reversed &&
          (prev.center ?? [0, 0])[0] === center[0] &&
          (prev.center ?? [0, 0])[1] === center[1]
        ) {
          return prev
        }
        return { depth: pose.depth, width: pose.width, center, reversed: pose.reversed }
      })
    }
    apply()
    const unsubscribePose = useFacingPose.subscribe(apply)
    // The feedback store also carries the per-frame screen anchor; only a
    // blocked flip matters here.
    const unsubscribeBlocked = usePlacementFeedback.subscribe((state, prev) => {
      if (state.blocked !== prev.blocked) apply()
    })
    return () => {
      unsubscribePose()
      unsubscribeBlocked()
    }
  }, [])

  return (
    <group ref={groupRef} visible={false}>
      {shape ? (
        <FacingIndicator
          center={shape.center}
          depth={shape.depth}
          reversed={shape.reversed}
          width={shape.width}
        />
      ) : null}
    </group>
  )
}
