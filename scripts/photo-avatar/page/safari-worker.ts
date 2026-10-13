// The photo avatar worker as Safari runs it: its OffscreenCanvas can't write WebP and hands back
// PNG when asked for it (the worker then falls back as it would there). The bench builds with this
// to check the file a Safari or iPhone user gets. The patch runs before any message arrives.
import '../../../packages/editor/src/components/editor/first-person/photo-avatar/avatar-worker'

const write = OffscreenCanvas.prototype.convertToBlob
OffscreenCanvas.prototype.convertToBlob = function (options?: ImageEncodeOptions) {
  if (options?.type === 'image/webp') return write.call(this, { type: 'image/png' })
  return write.call(this, options)
}
