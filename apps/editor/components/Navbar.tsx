'use client'

import { ArrowUpRight, ChevronRight } from 'lucide-react'
import { motion } from 'motion/react'

const MENU_ITEMS = [
  { label: 'Ecosystem' },
  { hasDropdown: true, label: 'Economics' },
  { label: 'Developers' },
  { hasDropdown: true, label: 'Governance' },
]

export function Navbar() {
  return (
    <nav className="relative z-10 flex w-full items-center justify-between px-6 py-6 md:px-10">
      <div className="hidden flex-1 md:block" />

      <ul className="hidden items-center gap-8 font-normal text-[rgb(45,45,45)] text-sm md:flex">
        {MENU_ITEMS.map((item) => (
          <li
            className="group flex cursor-pointer items-center gap-1 transition-opacity hover:opacity-70"
            key={item.label}
          >
            {item.label}
            {item.hasDropdown && (
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            )}
          </li>
        ))}
      </ul>

      <div className="md:hidden">
        <span className="font-regular text-xl text-[rgba(30,50,90,0.9)] tracking-tighter">
          RIVR
        </span>
      </div>

      <div className="flex flex-1 justify-end">
        <motion.button
          className="group flex items-center gap-2 rounded-full bg-[rgba(30,50,90,0.8)] py-1.5 pr-4 pl-2 text-white transition-colors hover:bg-[rgba(30,50,90,1)] md:gap-3 md:py-2 md:pr-6"
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <div className="flex items-center justify-center rounded-full bg-white/20 p-1 md:p-1.5">
            <ArrowUpRight className="h-4 w-4 text-white md:h-5 md:w-5" />
          </div>
          <span className="font-normal text-xs md:text-sm">Book Demo</span>
        </motion.button>
      </div>
    </nav>
  )
}
