'use client'

import { useEffect, useState } from 'react'

type RuntimePresence = {
  id: string
  position: [number, number, number]
  color?: string
}

export function RuntimePresenceAvatars() {
  const [participants, setParticipants] = useState<RuntimePresence[]>([])

  useEffect(() => {
    const update = (event: Event) => {
      const next = (event as CustomEvent<RuntimePresence[]>).detail
      setParticipants(Array.isArray(next) ? next : [])
    }
    window.addEventListener('mmm-presence-update', update)
    return () => window.removeEventListener('mmm-presence-update', update)
  }, [])

  return (
    <group name="runtime-presence-avatars">
      {participants.map((participant) => (
        <group key={participant.id} position={participant.position}>
          <mesh castShadow position={[0, -0.45, 0]}>
            <capsuleGeometry args={[0.22, 0.7, 6, 12]} />
            <meshStandardMaterial color={participant.color ?? '#7567ff'} roughness={0.55} />
          </mesh>
          <mesh castShadow position={[0, 0.2, 0]}>
            <sphereGeometry args={[0.2, 16, 12]} />
            <meshStandardMaterial color="#f2c9a5" roughness={0.75} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
