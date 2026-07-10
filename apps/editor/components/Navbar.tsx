'use client'

import { ArrowUpRight, Box, Grid2X2, Layers3, Lightbulb, Palette } from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'

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
        <Link
          className="flex w-fit min-w-0 items-center gap-2.5 text-[rgba(28,38,33,0.92)]"
          href="/"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-[rgba(32,39,35,0.88)] text-white shadow-[0_12px_30px_rgba(32,39,35,0.18)] backdrop-blur-xl md:h-10 md:w-10">
            <Box className="h-[18px] w-[18px] md:h-5 md:w-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-normal text-[17px] leading-none tracking-[-0.02em]">
              <span className="sm:hidden">MMM</span>
              <span className="hidden sm:inline">MMM Studio</span>
            </span>
            <span className="mt-1 hidden truncate text-[9px] text-[rgba(32,39,35,0.55)] uppercase tracking-[0.18em] sm:block">
              Spatial workspace
            </span>
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
        <Link
          className="hidden h-10 items-center rounded-full border border-white/45 bg-white/40 px-4 font-normal text-[13px] text-[rgba(32,39,35,0.72)] shadow-[0_16px_40px_rgba(32,39,35,0.08)] backdrop-blur-xl transition-colors hover:bg-white/65 hover:text-[#202723] sm:flex"
          href="/scenes"
        >
          Workspace
        </Link>
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <Link
            className="group flex h-10 items-center gap-2 rounded-full bg-[rgba(32,39,35,0.88)] pr-4 pl-2 text-white shadow-[0_16px_40px_rgba(32,39,35,0.18)] backdrop-blur-xl transition-colors hover:bg-[#202723] md:pr-5"
            href="/scenes"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/18">
              <ArrowUpRight className="h-4 w-4 text-white" />
            </span>
            <span className="whitespace-nowrap font-normal text-xs md:text-sm">Open Studio</span>
          </Link>
        </motion.div>
      </div>
    </nav>
  )
}
