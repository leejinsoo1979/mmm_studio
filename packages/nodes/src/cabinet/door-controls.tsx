'use client'

import { useScene } from '@pascal-app/core'
import { DoorClosed, DoorOpen } from 'lucide-react'
import { anyCabinetHasDoor, setAllCabinetDoors, useCabinetDoors } from './doors'

const segment = (active: boolean) =>
  `rounded-full px-3 py-1 text-xs transition-colors ${active ? 'bg-neutral-800 text-white' : 'text-neutral-600 hover:text-neutral-900'}`

/**
 * mmmcraft viewer controls for cabinet doors: 도어설치 / 도어제거 for every
 * cabinet, then Close / Open once doors are hung. Shown while the scene has
 * cabinets.
 */
export function CabinetDoorControls() {
  const hasCabinets = useScene((s) =>
    Object.values(s.nodes).some((n) => (n.type as string) === 'cabinet'),
  )
  const doorsHung = useScene((s) => anyCabinetHasDoor(s.nodes))
  const open = useCabinetDoors((s) => s.open)
  const setOpen = useCabinetDoors((s) => s.setOpen)
  if (!hasCabinets) return null

  return (
    <div className="pointer-events-auto fixed top-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/95 p-1 text-neutral-700 shadow-[0_4px_16px_rgba(0,0,0,0.2)] backdrop-blur-md">
      <button
        className="flex items-center gap-1.5 rounded-full px-3 py-1 font-medium text-xs transition-colors hover:bg-neutral-100"
        onClick={() => setAllCabinetDoors(!doorsHung)}
        title={doorsHung ? '모든 가구의 도어를 뗍니다' : '모든 가구에 도어를 답니다'}
        type="button"
      >
        {doorsHung ? <DoorClosed className="h-4 w-4" /> : <DoorOpen className="h-4 w-4" />}
        {doorsHung ? '도어제거' : '도어설치'}
      </button>
      {doorsHung && (
        <div className="flex rounded-full bg-neutral-100 p-0.5">
          <button className={segment(!open)} onClick={() => setOpen(false)} type="button">
            닫기
          </button>
          <button className={segment(open)} onClick={() => setOpen(true)} type="button">
            열기
          </button>
        </div>
      )}
    </div>
  )
}
