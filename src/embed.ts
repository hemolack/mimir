/**
 * Embed mode: a pared-down top bar for when Mimir is shown inside another
 * page. On automatically inside an iframe; `?embed=1` forces it on and
 * `?embed=0` forces it off (e.g. to get the full UI in a frame).
 */
export function isEmbedded(search = location.search): boolean {
  const param = new URLSearchParams(search).get('embed')
  if (param === '1' || param === 'true') return true
  if (param === '0' || param === 'false') return false
  return isFramed()
}

function isFramed(): boolean {
  try {
    return window.self !== window.top
  } catch {
    // Some browsers throw when a cross-origin parent is inspected; that means we're framed.
    return true
  }
}
