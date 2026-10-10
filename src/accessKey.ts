/**
 * The server's shared access key (when it requires one), remembered in this
 * browser. A link can carry it as `?key=...`: it's saved and removed from the
 * address bar so it doesn't end up in screenshots, bookmarks or copied links.
 */

const ACCESS_KEY = 'whiteboard.accessKey.v1'

export function loadAccessKey(): string {
  try {
    return localStorage.getItem(ACCESS_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveAccessKey(key: string) {
  try {
    localStorage.setItem(ACCESS_KEY, key)
  } catch {
    // ignore (storage blocked): the key still works for this page
  }
}

/** Take `?key=` from the page URL (saving it), else the remembered key. */
export function takeAccessKey(): string {
  const url = new URL(location.href)
  const fromUrl = url.searchParams.get('key')
  if (fromUrl === null) return loadAccessKey()
  url.searchParams.delete('key')
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  const key = fromUrl.trim()
  if (key) saveAccessKey(key)
  return key || loadAccessKey()
}
