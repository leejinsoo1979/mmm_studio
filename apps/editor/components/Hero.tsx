'use client'

import { motion } from 'motion/react'
import { BottomLeftCard } from '@/components/BottomLeftCard'
import { BottomRightCorner } from '@/components/BottomRightCorner'
import { HeroBadge } from '@/components/HeroBadge'
import { Navbar } from '@/components/Navbar'

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260428_193507_4286c423-2fd9-4efd-92bd-91a939453fc1.mp4'

export function Hero() {
  return (
    <div
      className="flex h-screen w-full items-center justify-center bg-[#f0f0f0] p-3 md:p-5"
      style={{ fontFamily: 'var(--font-helvetica)' }}
    >
      <section className="group relative flex h-full w-full max-w-[1536px] flex-col items-center overflow-hidden rounded-[1.5rem] bg-white/10 shadow-none md:rounded-[3rem]">
        <video
          autoPlay
          className="absolute inset-0 z-0 h-full w-full object-cover object-[65%] lg:object-center"
          loop
          muted
          playsInline
        >
          <source src={VIDEO_URL} type="video/mp4" />
        </video>

        <div className="relative z-10 flex h-full w-full flex-col items-center">
          <Navbar />

          <div className="flex w-full max-w-4xl flex-col items-center px-6 pt-8 text-center">
            <HeroBadge />
            <motion.h1
              animate={{ opacity: 1, scale: 1 }}
              className="mb-2 font-normal text-4xl text-[#5E6470] leading-[1.05] tracking-tight sm:text-5xl md:text-6xl lg:text-[80px]"
              initial={{ opacity: 1, scale: 0.98 }}
              transition={{ duration: 0.8, delay: 0.2 }}
            >
              Fluid Asset Streams
            </motion.h1>
            <motion.p
              animate={{ opacity: 1 }}
              className="max-w-xl font-normal text-[#5E6470] text-sm leading-relaxed opacity-80 sm:text-base md:text-lg"
              initial={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.4 }}
            >
              Access Smart Vaults, stake RIVR, NFTs, transform rigid holdings into liquid cash
              instantly.
            </motion.p>
          </div>

          <BottomLeftCard />
          <BottomRightCorner />
        </div>
      </section>
    </div>
  )
}
