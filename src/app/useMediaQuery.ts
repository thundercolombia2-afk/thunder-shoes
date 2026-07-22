import { useEffect, useState } from 'react'

/** `true` cuando el viewport es menor al breakpoint (móvil). */
export function useIsMobile(breakpoint = 860): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < breakpoint,
  )

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < breakpoint)
    window.addEventListener('resize', onResize)
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [breakpoint])

  return isMobile
}
