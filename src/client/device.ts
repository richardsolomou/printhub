// Phones get thumbnails, not live multi-million-triangle viewers or mesh work.
export const isPhone = () =>
  typeof navigator !== 'undefined' &&
  (((navigator as { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile ?? false) ||
    /iPhone|iPod|Android.*Mobile/.test(navigator.userAgent))

// iOS greys out files whose types it can't map from `accept` (.stl isn't a
// recognised UTI), so leave the picker unrestricted there; we validate anyway.
export const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
