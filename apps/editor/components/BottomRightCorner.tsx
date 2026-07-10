'use client'

import { ArrowUpRight, ChevronRight } from 'lucide-react'
import { motion } from 'motion/react'

export function BottomRightCorner() {
  return (
    <motion.div
      animate={{ y: 0, opacity: 1 }}
      className="absolute right-0 bottom-0 flex items-center gap-3 rounded-tl-[1.5rem] bg-[#f0f0f0] p-3 pt-5 pl-8 sm:gap-4 sm:rounded-tl-[2rem] sm:p-4 sm:pt-6 sm:pl-10 md:gap-6 md:rounded-tl-[3.5rem] md:p-6 md:pt-8 md:pl-14"
      initial={{ y: 20, opacity: 1 }}
      transition={{ duration: 0.8, delay: 0.4 }}
    >
      <div className="pointer-events-none absolute -top-[1.5rem] right-0 h-[1.5rem] w-[1.5rem] sm:-top-[2rem] sm:h-[2rem] sm:w-[2rem] md:-top-[3.5rem] md:h-[3.5rem] md:w-[3.5rem]">
        <svg
          fill="none"
          height="100%"
          viewBox="0 0 56 56"
          width="100%"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M56 56V0C56 30.9279 30.9279 56 0 56H56Z" fill="#f0f0f0" />
        </svg>
      </div>
      <div className="pointer-events-none absolute bottom-0 -left-[1.5rem] h-[1.5rem] w-[1.5rem] sm:-left-[2rem] sm:h-[2rem] sm:w-[2rem] md:-left-[3.5rem] md:h-[3.5rem] md:w-[3.5rem]">
        <svg
          fill="none"
          height="100%"
          viewBox="0 0 56 56"
          width="100%"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M56 56H0C30.9279 56 56 30.9279 56 0V56Z" fill="#f0f0f0" />
        </svg>
      </div>

      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(30,50,90,0.1)] bg-[rgba(30,50,90,0.05)] md:h-14 md:w-14">
        <ArrowUpRight className="h-5 w-5 text-[rgba(30,50,90,0.8)] md:h-6 md:w-6" />
      </div>

      <div className="flex flex-col">
        <span className="font-normal text-[16px] text-[rgba(30,50,90,0.95)] md:text-[20px]">
          Documentation
        </span>
        <div className="flex cursor-pointer items-center gap-1 text-[rgba(30,50,90,0.6)] transition-colors hover:text-[rgba(30,50,90,0.8)]">
          <span className="font-normal text-[12px] md:text-[15px]">Library</span>
          <ChevronRight className="h-4 w-4" />
        </div>
      </div>
    </motion.div>
  )
}
