'use client'

import { ArrowUpRight, Grid2X2, Layers3, Lightbulb, Palette } from 'lucide-react'
import { motion } from 'motion/react'
import Image from 'next/image'
import Link from 'next/link'
import { AccountCta } from './account-cta'

const MENU_ITEMS = [
  { href: '/scenes', icon: Layers3, label: 'Scenes' },
  { href: '/scenes', icon: Grid2X2, label: 'Assets' },
  { href: '/scenes', icon: Palette, label: 'Materials' },
  { href: '/scenes', icon: Lightbulb, label: 'Lighting' },
]

export function Navbar() {
  return (
    <nav className="relative z-10 flex w-full items-center justify-between gap-3 px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="flex min-w-0 flex-1">
        <Link className="flex w-fit min-w-0 items-center gap-3.5" href="/">
          <Image
            alt=""
            aria-hidden="true"
            className="h-[13px] w-auto md:h-[15px]"
            height={23}
            priority
            src="/mmmlogo.svg"
            width={71}
          />
          <span className="whitespace-nowrap font-[family-name:var(--font-barlow)] text-[21px] text-[#111] tracking-[0.09em] md:text-[24px]">
            <span className="font-normal">mmm studio</span>
          </span>
        </Link>
      </div>

      <ul className="hidden items-center gap-1 rounded-full border border-white/45 bg-white/45 p-1 text-[rgba(32,39,35,0.72)] shadow-[0_16px_40px_rgba(32,39,35,0.08)] backdrop-blur-xl md:flex">
        {MENU_ITEMS.map((item) => (
          <li key={item.label}>
            <Link
              className="group flex h-9 items-center gap-2 rounded-full px-3.5 font-normal text-[13px] transition-colors hover:bg-white/70 hover:text-[#202723]"
              href={item.href}
            >
              <item.icon className="h-3.5 w-3.5 text-[rgba(32,39,35,0.5)] transition-colors group-hover:text-[#4f6659]" />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex flex-1 items-center justify-end gap-2">
        <AccountCta />
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <Link
            className="group flex h-10 items-center gap-2 rounded-full bg-[rgba(32,39,35,0.88)] pr-4 pl-2 text-white shadow-[0_16px_40px_rgba(32,39,35,0.18)] backdrop-blur-xl transition-colors hover:bg-[#202723] md:pr-5"
            href="/dashboard"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/18">
              <ArrowUpRight className="h-4 w-4 text-white" />
            </span>
            <span className="whitespace-nowrap font-normal text-xs md:text-sm">Open Dashboard</span>
          </Link>
        </motion.div>
      </div>
    </nav>
  )
}
