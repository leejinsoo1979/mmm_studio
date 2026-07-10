'use client'

import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Vector3 } from 'three'

export type CameraPresetSnapshot = {
  position: [number, number, number]
  target: [number, number, number]
  fov?: number
}

type CameraControlsLike = {
  target?: Vector3
  getTarget?: (target: Vector3) => Vector3
  setLookAt?: (
    px: number,
    py: number,
    pz: number,
    tx: number,
    ty: number,
    tz: number,
    smooth?: boolean,
  ) => Promise<void> | void
}

export function CameraPresetBridge() {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as CameraControlsLike | null

  useEffect(() => {
    const capture = (event: Event) => {
      const callback = (event as CustomEvent<(snapshot: CameraPresetSnapshot) => void>).detail
      if (typeof callback !== 'function') return
      const target = new Vector3()
      if (controls?.getTarget) controls.getTarget(target)
      else if (controls?.target) target.copy(controls.target)
      else camera.getWorldDirection(target).multiplyScalar(5).add(camera.position)
      callback({
        position: camera.position.toArray() as [number, number, number],
        target: target.toArray() as [number, number, number],
        fov: 'fov' in camera && typeof camera.fov === 'number' ? camera.fov : undefined,
      })
    }
    const apply = (event: Event) => {
      const snapshot = (event as CustomEvent<CameraPresetSnapshot>).detail
      if (!snapshot) return
      const [px, py, pz] = snapshot.position
      const [tx, ty, tz] = snapshot.target
      if (controls?.setLookAt) void controls.setLookAt(px, py, pz, tx, ty, tz, true)
      else {
        camera.position.set(px, py, pz)
        camera.lookAt(tx, ty, tz)
      }
      if (snapshot.fov && 'fov' in camera) {
        camera.fov = snapshot.fov
        camera.updateProjectionMatrix()
      }
    }
    window.addEventListener('mmm-camera-capture', capture)
    window.addEventListener('mmm-camera-apply', apply)
    return () => {
      window.removeEventListener('mmm-camera-capture', capture)
      window.removeEventListener('mmm-camera-apply', apply)
    }
  }, [camera, controls])

  return null
}
