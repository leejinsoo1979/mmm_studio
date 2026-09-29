'use client'

import type { LocalPresence, RemotePresence } from '@pascal-app/editor'
import { useEditor } from '@pascal-app/editor'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { Copy, MessageCircle, Send, Users, X } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { getFirebaseAuth, getFirebaseFirestore } from '@/lib/firebase-client'

type RuntimeMessage = {
  id: string
  userId: string
  userName: string
  text: string
}

type ParticipantPose = Partial<Omit<LocalPresence, 'position'>> & {
  position?: [number, number, number]
}

/** Firestore takes about one write a second per document: one pose report a second. */
const POSE_INTERVAL = 1000

export function RuntimeCollaboration({
  sceneId,
  enabled,
  chatEnabled,
  visibility,
}: {
  sceneId: string
  enabled: boolean
  chatEnabled: boolean
  visibility: 'public' | 'invite-only'
}) {
  const [open, setOpen] = useState(false)
  const [participantCount, setParticipantCount] = useState(1)
  const [messages, setMessages] = useState<RuntimeMessage[]>([])
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const inGame = useEditor((state) => state.isFirstPersonMode)
  const auth = useMemo(() => getFirebaseAuth(), [])
  const db = useMemo(() => getFirebaseFirestore(), [])
  const user = auth?.currentUser ?? null

  useEffect(() => {
    if (!enabled || !db || !user) return

    const sessionRef = doc(db, 'runtimeSessions', sceneId)
    const participantRef = doc(db, 'runtimeSessions', sceneId, 'participants', user.uid)
    const displayName = user.displayName || user.email?.split('@')[0] || 'Guest'

    const connect = async () => {
      try {
        try {
          await setDoc(sessionRef, {
            hostId: user.uid,
            visibility,
            invitedUserIds: [],
            sceneId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        } catch {
          // An existing public session is owned by its original host. Guests
          // cannot overwrite it, but can still join its participant collection.
        }
        await setDoc(
          participantRef,
          {
            userId: user.uid,
            userName: displayName,
            photoUrl: user.photoURL ?? null,
            joinedAt: serverTimestamp(),
            lastSeenAt: serverTimestamp(),
          },
          { merge: true },
        )
      } catch {
        setStatus('이 링크에 참여할 권한이 없습니다.')
      }
    }

    void connect()
    const heartbeat = window.setInterval(() => {
      void setDoc(participantRef, { lastSeenAt: serverTimestamp() }, { merge: true })
    }, 30_000)
    // Only a player walking the scene shows up for the others (as their
    // character); someone orbiting the camera has no body to show.
    let lastPose: LocalPresence | null = null
    const poseSync = window.setInterval(() => {
      let pose: LocalPresence | null = null
      window.dispatchEvent(
        new CustomEvent('mmm-player-pose', {
          detail: (presence: LocalPresence) => {
            pose = presence
          },
        }),
      )
      if (!(pose || lastPose)) return
      lastPose = pose
      void setDoc(participantRef, { pose, lastSeenAt: serverTimestamp() }, { merge: true })
    }, POSE_INTERVAL)
    const unsubscribeParticipants = onSnapshot(
      collection(db, 'runtimeSessions', sceneId, 'participants'),
      (snapshot) => {
        setParticipantCount(Math.max(1, snapshot.size))
        window.dispatchEvent(
          new CustomEvent<RemotePresence[]>('mmm-presence-update', {
            detail: snapshot.docs
              .filter((participant) => participant.id !== user.uid)
              .flatMap((participant) => {
                const data = participant.data()
                const pose = data.pose as ParticipantPose | null | undefined
                return pose?.position
                  ? [
                      {
                        id: participant.id,
                        name: String(data.userName ?? 'Guest'),
                        avatar: String(pose.avatar ?? ''),
                        position: pose.position,
                        yaw: Number(pose.yaw ?? 0),
                      },
                    ]
                  : []
              }),
          }),
        )
      },
    )
    // New chat lines (not the history loaded on joining) float over their
    // speaker's character.
    let seenMessages: Set<string> | null = null
    const unsubscribeMessages = chatEnabled
      ? onSnapshot(
          query(
            collection(db, 'runtimeSessions', sceneId, 'messages'),
            orderBy('createdAt', 'asc'),
            limit(100),
          ),
          (snapshot) => {
            const next = snapshot.docs.map((message) => {
              const data = message.data()
              return {
                id: message.id,
                userId: String(data.userId ?? ''),
                userName: String(data.userName ?? 'Guest'),
                text: String(data.text ?? ''),
              }
            })
            if (seenMessages) {
              for (const message of next) {
                if (seenMessages.has(message.id)) continue
                window.dispatchEvent(
                  new CustomEvent('mmm-chat-bubble', {
                    detail: { userId: message.userId, text: message.text },
                  }),
                )
              }
            }
            seenMessages = new Set(next.map((message) => message.id))
            setMessages(next)
          },
        )
      : () => {}

    return () => {
      window.clearInterval(heartbeat)
      window.clearInterval(poseSync)
      unsubscribeParticipants()
      unsubscribeMessages()
      window.dispatchEvent(new CustomEvent('mmm-presence-update', { detail: [] }))
      void deleteDoc(participantRef)
    }
  }, [chatEnabled, db, enabled, sceneId, user, visibility])

  // In the game, Enter opens the chat and puts the cursor in it.
  useEffect(() => {
    if (!(enabled && chatEnabled && inGame)) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.target instanceof HTMLInputElement) return
      if (document.pointerLockElement) document.exitPointerLock()
      setOpen(true)
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chatEnabled, enabled, inGame])

  if (!enabled) return null

  const copyInvite = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setStatus('초대 링크를 복사했습니다.')
    window.setTimeout(() => setStatus(null), 2000)
  }

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || !db || !user) return
    setDraft('')
    // Back to walking once the line is sent.
    if (inGame) inputRef.current?.blur()
    await addDoc(collection(db, 'runtimeSessions', sceneId, 'messages'), {
      userId: user.uid,
      userName: user.displayName || user.email?.split('@')[0] || 'Guest',
      text: text.slice(0, 1000),
      createdAt: serverTimestamp(),
    })
  }

  return (
    <div className="fixed right-5 bottom-5 z-[120] text-white">
      {open && (
        <section className="mb-3 flex h-[420px] w-[340px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#151515]/95 shadow-2xl backdrop-blur-xl">
          <header className="flex items-center justify-between border-white/10 border-b px-4 py-3">
            <div>
              <p className="font-semibold text-sm">Live session</p>
              <p className="mt-0.5 text-white/45 text-xs">{participantCount}명 접속 중</p>
            </div>
            <button
              className="rounded-lg p-2 hover:bg-white/8"
              onClick={() => setOpen(false)}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </header>
          <button
            className="mx-3 mt-3 flex items-center justify-center gap-2 rounded-xl border border-white/10 py-2.5 text-sm hover:bg-white/5"
            onClick={copyInvite}
            type="button"
          >
            <Copy className="h-4 w-4" /> 링크로 초대
          </button>
          {status && <p className="px-4 pt-2 text-amber-200 text-xs">{status}</p>}
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {!user && (
              <p className="rounded-xl bg-white/5 p-3 text-white/55 text-xs leading-5">
                채팅과 동시 접속 기능은 로그인 후 사용할 수 있습니다.
              </p>
            )}
            {messages.map((message) => (
              <div key={message.id}>
                <p className="text-white/45 text-[11px]">{message.userName}</p>
                <p className="mt-1 rounded-xl bg-white/7 px-3 py-2 text-sm">{message.text}</p>
              </div>
            ))}
          </div>
          {chatEnabled && (
            <form className="flex gap-2 border-white/10 border-t p-3" onSubmit={sendMessage}>
              <input
                ref={inputRef}
                className="min-w-0 flex-1 rounded-xl bg-white/7 px-3 text-sm outline-none placeholder:text-white/30"
                disabled={!user}
                maxLength={1000}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') event.currentTarget.blur()
                }}
                placeholder="메시지 입력"
                value={draft}
              />
              <button
                className="grid h-10 w-10 place-items-center rounded-xl bg-white text-black disabled:opacity-30"
                disabled={!user || !draft.trim()}
                type="submit"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          )}
        </section>
      )}
      <div className="flex justify-end gap-2">
        <button
          aria-label="Copy invite link"
          className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-[#171717]/92 shadow-xl backdrop-blur hover:bg-[#242424]"
          onClick={copyInvite}
          type="button"
        >
          <Copy className="h-4 w-4" />
        </button>
        <button
          aria-label="Open live session"
          className="flex h-12 items-center gap-2 rounded-full border border-white/10 bg-[#171717]/92 px-4 shadow-xl backdrop-blur hover:bg-[#242424]"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {chatEnabled ? <MessageCircle className="h-4 w-4" /> : <Users className="h-4 w-4" />}
          <span className="font-medium text-sm">{participantCount}</span>
        </button>
      </div>
    </div>
  )
}
