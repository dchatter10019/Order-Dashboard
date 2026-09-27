export const TAB_TO_PATH = {
  orders: '/orders',
  products: '/products',
  retailers: '/retailers',
  'gopuff-checker': '/gopuff',
  'manual-order': '/manual-order',
  'ai-assistant': '/ai-assistant'
}

export const PATH_TO_TAB = Object.fromEntries(
  Object.entries(TAB_TO_PATH).map(([tabId, path]) => [path, tabId])
)

/** Resolve dashboard tab from URL (supports legacy /dashboard). */
export function tabIdFromPathname(pathname) {
  const path = String(pathname || '').split('?')[0]
  if (path === '/dashboard' || path === '/settings') return 'orders'
  return PATH_TO_TAB[path] || null
}

export function pathFromTabId(tabId) {
  return TAB_TO_PATH[tabId] || TAB_TO_PATH.orders
}

export function isDashboardTabPath(pathname) {
  return tabIdFromPathname(pathname) != null
}
