import { createContext, useContext, useMemo } from 'react'
import { useNavigationEventBridge } from './useNavigationEventBridge.js'

const NavigationContext = createContext(null)

export function NavigationProvider({
  activeTab,
  activeMobileEntry,
  granted,
  authenticated = false,
  implemented,
  navigationBadges = {},
  moreOpen,
  requestNavigation,
  openMore,
  closeMore,
  children,
}) {
  useNavigationEventBridge(requestNavigation)

  const value = useMemo(() => ({
    activeTab,
    activeMobileEntry,
    granted,
    authenticated,
    implemented,
    navigationBadges,
    moreOpen,
    requestNavigation,
    openMore,
    closeMore,
  }), [
    activeTab,
    activeMobileEntry,
    granted,
    authenticated,
    implemented,
    navigationBadges,
    moreOpen,
    requestNavigation,
    openMore,
    closeMore,
  ])

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}

export function useNavigation() {
  const value = useContext(NavigationContext)
  if (!value) throw new Error('useNavigation must be used within NavigationProvider')
  return value
}
