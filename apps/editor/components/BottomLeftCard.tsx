'use client'

import { ArrowUpRight } from 'lucide-react'
import { motion } from 'motion/react'

export function BottomLeftCard() {
  return (
    <motion.div
      animate={{ x: 0, opacity: 1 }}
      className="absolute right-4 bottom-28 left-auto flex w-fit min-w-[140px] flex-col gap-2 rounded-[1.2rem] bg-white/30 p-3 backdrop-blur-xl md:right-auto md:bottom-6 md:left-6 md:min-w-[150px] md:rounded-[1.5rem] md:p-4 lg:bottom-10 lg:left-10 lg:min-w-[180px] lg:gap-3 lg:rounded-[2.2rem] lg:p-5"
      initial={{ x: -20, opacity: 1 }}
      transition={{ duration: 0.8, delay: 0.2 }}
    >
      <div className="flex flex-col">
        <span className="font-normal text-2xl text-[rgba(30,50,90,0.9)] tracking-tight md:text-3xl">
          5.2K
        </span>
        <span className="font-normal text-[10px] text-[rgba(30,50,90,0.6)] uppercase tracking-wider md:text-[12px]">
          Active Yielders
        </span>
      </div>

      <motion.button
        className="group flex items-center gap-2 self-start rounded-full bg-white py-1.5 pr-5 pl-1.5 transition-colors hover:bg-white/90"
        type="button"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <div className="flex items-center justify-center rounded-full bg-[rgba(30,50,90,0.1)] p-1">
          <ArrowUpRight className="h-4 w-4 text-[rgba(30,50,90,0.9)]" />
        </div>
        <span className="font-normal text-[14px] text-[rgba(30,50,90,0.9)]">Join Discord</span>
      </motion.button>
    </motion.div>
  )
}
