import { FALLBACK_PRIZE_IMAGE } from '../utils/assets'

type AssetImageProps = {
  src: string
  alt: string
  className?: string
  glow?: string
}

/** Продуктовый кадр предмета с мягким свечением и фолбэком на битую ссылку CDN. */
export default function AssetImage({
  src,
  alt,
  className = '',
  glow = 'rgba(255, 215, 0, 0.45)',
}: AssetImageProps) {
  return (
    <img
      src={src}
      alt={alt}
      decoding="async"
      loading="lazy"
      draggable={false}
      className={`pointer-events-none select-none object-contain ${className}`}
      style={{
        filter: `drop-shadow(0 18px 22px rgba(0, 0, 0, 0.55)) drop-shadow(0 0 18px ${glow})`,
      }}
      onError={(event) => {
        const img = event.currentTarget
        if (img.dataset.fallback !== '1') {
          img.dataset.fallback = '1'
          img.src = FALLBACK_PRIZE_IMAGE
        }
      }}
    />
  )
}
