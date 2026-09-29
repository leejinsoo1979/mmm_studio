'use client'

import {
  avatarLabel,
  avatarThumbnailUrl,
  CharacterGallery,
  findAvatar,
  useEditor,
  useWalkthroughView,
} from '@pascal-app/editor'
import { Gamepad2, Orbit, Play } from 'lucide-react'
import { useState } from 'react'
import { flushSync } from 'react-dom'

const CONTROLS: [string, string][] = [
  ['W A S D', '이동'],
  ['Shift', '달리기'],
  ['Space', '점프'],
  ['C', '앉기'],
  ['V', '1인칭 / 3인칭'],
  ['E', '문 열기'],
  ['Enter', '채팅'],
  ['ESC', '나가기'],
]

function startGame() {
  useWalkthroughView.getState().setView('third')
  flushSync(() => useEditor.getState().setFirstPersonMode(true))
}

/**
 * The play link's game lobby: pick a character and walk into the scene in
 * third person; leaving the walk (ESC) comes back here. "자유 시점" drops
 * the lobby for the orbit camera, with a button to start the game from there.
 */
export function PlayGameLobby({ title }: { title: string }) {
  const inGame = useEditor((state) => state.isFirstPersonMode)
  const character = findAvatar(useWalkthroughView((state) => state.character))
  const [freeLook, setFreeLook] = useState(false)

  if (inGame) return null

  if (freeLook) {
    return (
      <div className="dark pointer-events-none fixed inset-x-0 bottom-6 z-[110] flex justify-center">
        <button
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-white px-5 py-3 font-semibold text-black text-sm shadow-2xl transition hover:bg-white/90"
          onClick={() => {
            setFreeLook(false)
            startGame()
          }}
          type="button"
        >
          <Play className="h-4 w-4 fill-current" /> 게임 시작
        </button>
      </div>
    )
  }

  return (
    <div className="dark fixed inset-0 z-[110] grid place-items-center bg-black/55 p-4 text-foreground backdrop-blur-sm">
      <section className="grid w-full max-w-[880px] gap-6 rounded-3xl border border-white/10 bg-[#141414]/95 p-6 shadow-2xl md:grid-cols-[1fr_440px]">
        <div className="flex min-w-0 flex-col">
          <p className="flex items-center gap-2 text-[11px] text-white/45 uppercase tracking-[0.2em]">
            <Gamepad2 className="h-4 w-4" /> 게임 모드
          </p>
          <h1 className="mt-2 truncate font-semibold text-2xl text-white">{title}</h1>
          <p className="mt-2 text-sm text-white/55 leading-6">
            캐릭터를 골라 공간 안을 직접 걸어 보세요. 같은 링크로 들어온 사람들도 각자의 캐릭터로
            함께 보입니다.
          </p>

          <div className="mt-5 flex items-center gap-3 rounded-2xl bg-white/5 p-3">
            <img
              alt=""
              className="h-20 w-12 object-contain"
              src={avatarThumbnailUrl(character.id)}
            />
            <div>
              <p className="text-[11px] text-white/45">내 캐릭터</p>
              <p className="font-semibold text-lg text-white">{avatarLabel(character.id)}</p>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            {CONTROLS.map(([key, label]) => (
              <div className="flex items-center justify-between gap-2" key={key}>
                <dt className="text-white/55">{label}</dt>
                <dd>
                  <kbd className="rounded-md border border-white/15 bg-white/8 px-1.5 py-0.5 font-mono text-[10px] text-white/80">
                    {key}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-auto flex flex-col gap-2 pt-6">
            <button
              className="flex items-center justify-center gap-2 rounded-2xl bg-white py-3.5 font-semibold text-base text-black transition hover:bg-white/90"
              onClick={startGame}
              type="button"
            >
              <Play className="h-4 w-4 fill-current" /> 게임 시작
            </button>
            <button
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 py-2.5 text-sm text-white/70 transition hover:bg-white/5"
              onClick={() => setFreeLook(true)}
              type="button"
            >
              <Orbit className="h-4 w-4" /> 자유 시점으로 둘러보기
            </button>
          </div>
        </div>

        <CharacterGallery className="min-w-0 rounded-2xl bg-white/[0.03] p-3" columns={5} />
      </section>
    </div>
  )
}
