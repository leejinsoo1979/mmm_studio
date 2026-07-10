'use client'

import { LayoutDashboard, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { observeStudioUser } from '@/lib/auth-client'

export function AccountCta() {
  const [hasUser, setHasUser] = useState(false)

  useEffect(() => {
    return observeStudioUser((user) => setHasUser(Boolean(user)))
  }, [])

  return (
    <Link
      className="flex h-10 items-center gap-2 rounded-full border border-white/45 bg-white/40 px-3 font-normal text-[13px] text-[rgba(32,39,35,0.72)] shadow-[0_16px_40px_rgba(32,39,35,0.08)] backdrop-blur-xl transition-colors hover:bg-white/65 hover:text-[#202723] sm:px-4"
      href={hasUser ? '/dashboard' : '/signup?next=/dashboard'}
    >
      {hasUser ? (
        <LayoutDashboard className="h-3.5 w-3.5" />
      ) : (
        <UserRound className="h-3.5 w-3.5" />
      )}
      {hasUser ? 'Dashboard' : 'Sign up'}
    </Link>
  )
}
