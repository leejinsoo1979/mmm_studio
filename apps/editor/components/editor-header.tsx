import Image from 'next/image'
import Link from 'next/link'
import { ExportCenter } from './export-center'

interface EditorHeaderProps {
  sceneName: string
  sceneId: string
}

export function EditorHeader({ sceneId, sceneName }: EditorHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between bg-sidebar px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Link aria-label="Home" className="flex shrink-0 items-center" href="/">
          <Image alt="Pascal" height={20} src="/pascal-logo-shape.svg" width={20} />
        </Link>
        <div className="h-4 w-px shrink-0 bg-border/60" />
        <span className="truncate font-medium text-foreground/90 text-sm">{sceneName}</span>
      </div>
      <div className="flex items-center gap-2">
        <ExportCenter sceneId={sceneId} sceneName={sceneName} />
        <Link
          className="rounded-md border border-border bg-background/60 px-3 py-1.5 font-medium text-xs hover:bg-accent/40"
          href="/scenes"
        >
          All scenes
        </Link>
      </div>
    </header>
  )
}
