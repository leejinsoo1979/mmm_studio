/** Longest side (px) a presentation page is rendered at: sharp on a TV, light to hold. */
const PAGE_SIZE = 1600
/** A deck longer than this is cut: a walkthrough talk, not a manual. */
export const MAX_PAGES = 80

const canvasUrl = (canvas: HTMLCanvasElement) =>
  new Promise<string>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('page render failed')),
      'image/jpeg',
      0.88,
    ),
  )

/** A PDF's pages as images (object URLs), rendered with pdf.js on the page's own thread. */
async function pdfPages(file: File): Promise<string[]> {
  // Loading the worker module here gives pdf.js its handler in this thread.
  await import('pdfjs-dist/build/pdf.worker.min.mjs')
  const pdfjs = await import('pdfjs-dist')
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
    .promise
  const pages: string[] = []
  for (let n = 1; n <= Math.min(document.numPages, MAX_PAGES); n++) {
    const page = await document.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: PAGE_SIZE / Math.max(base.width, base.height) })
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
    pages.push(await canvasUrl(canvas))
  }
  await document.destroy()
  return pages
}

/** Presentation pages from a PDF, or from images (one page each, in name order). */
export async function presentationPages(files: File[]): Promise<string[]> {
  const pdf = files.find((file) => file.type === 'application/pdf' || file.name.endsWith('.pdf'))
  if (pdf) return pdfPages(pdf)
  return files
    .filter((file) => file.type.startsWith('image/'))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .slice(0, MAX_PAGES)
    .map((file) => URL.createObjectURL(file))
}
