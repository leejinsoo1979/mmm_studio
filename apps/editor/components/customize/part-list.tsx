'use client'

/** Width of the part list plus its gap to the card. */
export const PART_LIST_SPACE = 186

/**
 * inZOI's parts of the object being customized: its name, then one pill per
 * paintable part, top-aligned with the card beside it at the bottom left.
 */
export function PartList({
  name,
  parts,
  activeKey,
  onPick,
}: {
  name: string
  parts: { key: string; label: string }[]
  activeKey: string | undefined
  onPick: (key: string) => void
}) {
  return (
    <div
      className="pointer-events-auto fixed bottom-[68px] z-50 h-[146px] w-[176px]"
      onPointerDown={(e) => e.stopPropagation()}
      style={{ left: 'calc(var(--viewer-left-inset, 0px) + 12px)' }}
    >
      <p className="absolute bottom-full mb-2 w-full truncate font-semibold text-[15px] text-neutral-900 [text-shadow:0_0_4px_rgba(255,255,255,0.95),0_0_2px_rgba(255,255,255,0.95)]">
        {name}
      </p>
      {/* Four parts fit the card's height; more (furniture slots) scroll. */}
      <div className="no-scrollbar flex h-full flex-col gap-1.5 overflow-y-auto">
        {parts.map((part) => (
          <button
            aria-pressed={part.key === activeKey}
            className={`h-[31px] shrink-0 truncate rounded-[10px] px-4 text-left text-[12px] transition-colors ${
              part.key === activeKey
                ? 'bg-white font-medium text-[#333] shadow-sm'
                : 'border border-white/70 bg-neutral-700/45 text-white backdrop-blur-sm hover:bg-neutral-700/60'
            }`}
            key={part.key}
            onClick={() => onPick(part.key)}
            type="button"
          >
            {part.label}
          </button>
        ))}
      </div>
    </div>
  )
}
