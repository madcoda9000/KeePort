import * as React from "react"

const MOBILE_BREAKPOINT = 768

/** Tracks whether the viewport is below the sidebar breakpoint. */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  /** Tracks the viewport against the mobile breakpoint using a media query listener. */
  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    /** Updates the mobile flag from the current viewport width. */
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return /** Removes the media query listener when the hook unmounts. */ () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
