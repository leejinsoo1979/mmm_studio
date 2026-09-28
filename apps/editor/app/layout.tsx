import { Agentation } from 'agentation'
import { Barlow } from 'next/font/google'
import localFont from 'next/font/local'
import { ClientBootstrap } from './client-bootstrap'
import './globals.css'

// Pretendard (SIL OFL 1.1, see fonts/Pretendard-LICENSE.txt): one geometric
// sans for Hangul and Latin, like inZOI's UI.
const pretendard = localFont({
  src: './fonts/PretendardVariable.woff2',
  variable: '--font-pretendard',
  weight: '45 920',
  display: 'swap',
})
const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  preload: false,
})
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  preload: false,
})

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-barlow',
  display: 'swap',
  preload: false,
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      className={`${pretendard.variable} ${geistSans.variable} ${geistMono.variable} ${barlow.variable}`}
      lang="ko"
    >
      <head />
      <body className="font-sans">
        <ClientBootstrap>{children}</ClientBootstrap>
        {/* Opt-in (NEXT_PUBLIC_AGENTATION=1): its button covers the bottom-right helper card. */}
        {process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_AGENTATION === '1' && (
          <Agentation />
        )}
      </body>
    </html>
  )
}
