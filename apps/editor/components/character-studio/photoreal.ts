'use client'

import { setSkinShading } from '@pascal-app/viewer'
import { useEffect } from 'react'

/**
 * 실사: the characters' skin shaded as skin wherever they are drawn (the
 * viewer's skin-material.ts), and the studio lit for it. A choice this
 * browser keeps; off until it is made.
 */

const KEY = 'mmm-character-photoreal'

export function storedPhotoreal(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** Keeps the choice and draws every character by it at once. */
export function choosePhotoreal(on: boolean) {
  setSkinShading(on ? 1 : 0)
  try {
    window.localStorage.setItem(KEY, on ? '1' : '0')
  } catch {}
}

/** Draws the characters as the kept choice has it, from when the scene opens. */
export function useStoredPhotoreal() {
  useEffect(() => setSkinShading(storedPhotoreal() ? 1 : 0), [])
}
