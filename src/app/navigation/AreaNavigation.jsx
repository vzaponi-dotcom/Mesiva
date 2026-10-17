import { AREA_LABELS, NAVIGATION_DESTINATIONS } from './registry.js'
import { resolveDestination } from './resolution.js'
import { useNavigation } from './NavigationContext.jsx'
import { useMediaQuery } from '../../shared/hooks/useMediaQuery.js'
import { getNavigationBadge } from '../shell/navigationBadges.js'

export default function AreaNavigation({ area }) {
  const { activeTab, granted, implemented, navigationBadges, requestNavigation } = useNavigation()
  const isMobile = useMediaQuery('(max-width: 820px)')
  const destinations = NAVIGATION_DESTINATIONS.filter((destination) => (
    destination.area === area
    && destination.id !== 'new-order'
    && (!isMobile || destination.mobileEntry !== null)
    && resolveDestination(destination.id, granted, implemented).status === 'allowed'
  ))
  if (!destinations.length) return null
  return <nav className="area-navigation" aria-label={`Navegação de ${AREA_LABELS[area] || area}`}>
    {destinations.map((destination) => {
      const badge = getNavigationBadge(destination, navigationBadges)
      return <button key={destination.id} type="button" aria-current={activeTab === destination.id ? 'page' : undefined} aria-label={badge?.ariaLabel} className={activeTab === destination.id ? 'area-navigation-item active' : 'area-navigation-item'} onClick={() => requestNavigation(destination.id)}>{destination.label}{badge && <span className="area-navigation-badge" aria-hidden="true">{badge.text}</span>}</button>
    })}
  </nav>
}
