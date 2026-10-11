const NAME_CHARS_PER_VISUAL_LINE = 22
const NOTE_CHARS_PER_VISUAL_LINE = 28
const NOTE_LINE_WEIGHT = 0.75

const VIEWPORT_LINE_CAPACITY = Object.freeze({
  spacious: Object.freeze({ normal: 9, tall: 22 }),
  standard: Object.freeze({ normal: 7, tall: 17 }),
  constrained: Object.freeze({ normal: 6, tall: 14 }),
})

const BOARD_LINE_CAPACITY = Object.freeze({
  focus: Object.freeze({
    spacious: Object.freeze({ normal: 9, tall: 22, full: 36 }),
    standard: Object.freeze({ normal: 7, tall: 17, full: 30 }),
    constrained: Object.freeze({ normal: 6, tall: 14, full: 26 }),
  }),
  roomy: Object.freeze({
    spacious: Object.freeze({ normal: 7, tall: 18, full: 26 }),
    standard: Object.freeze({ normal: 6, tall: 15, full: 22 }),
    constrained: Object.freeze({ normal: 5, tall: 12, full: 18 }),
  }),
  balanced: Object.freeze({
    spacious: Object.freeze({ normal: 7, tall: 18 }),
    standard: Object.freeze({ normal: 6, tall: 15 }),
    constrained: Object.freeze({ normal: 5, tall: 12 }),
  }),
  compact: Object.freeze({
    spacious: Object.freeze({ normal: 5, tall: 11, full: 19 }),
    standard: Object.freeze({ normal: 4, tall: 9, full: 16 }),
    constrained: Object.freeze({ normal: 3, tall: 7, full: 12 }),
  }),
})

const KITCHEN_BOARD_PROFILES = Object.freeze({
  focus: Object.freeze({ id: 'focus', columns: 3, rows: 2, gridRows: 6, maxSlots: 18 }),
  roomy: Object.freeze({ id: 'roomy', columns: 3, rows: 3, gridRows: 18, maxSlots: 54 }),
  balanced: Object.freeze({ id: 'balanced', columns: 4, rows: 2, gridRows: 8, maxSlots: 32 }),
  compact: Object.freeze({ id: 'compact', columns: 4, rows: 3, gridRows: 24, maxSlots: 96 }),
})

const cleanSpaces = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')

export const formatKitchenDisplayItemName = (item) => {
  const name = cleanSpaces(item?.name || 'Item')
  const size = cleanSpaces(item?.size)
  if (!size) return name
  const normalizedName = name.toLocaleLowerCase('pt-BR')
  const normalizedSize = size.toLocaleLowerCase('pt-BR')
  return normalizedName === normalizedSize || normalizedName.endsWith(` ${normalizedSize}`) ? name : `${name} ${size}`
}

export const normalizeKitchenItemNote = (item) => cleanSpaces(item?.note)

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const resolveEstimatedCardWidth = (viewportWidth, profile) => {
  const width = Number(viewportWidth)
  if (!Number.isFinite(width) || width <= 0) return undefined
  return width / Math.max(1, Number(profile?.columns) || 1)
}

const resolveLineLimits = ({ viewportWidth, profile, columnCount = 1 }) => {
  const cardWidth = resolveEstimatedCardWidth(viewportWidth, profile)
  if (!cardWidth) {
    return {
      nameChars: NAME_CHARS_PER_VISUAL_LINE,
      noteChars: NOTE_CHARS_PER_VISUAL_LINE,
    }
  }

  const horizontalChrome = profile?.id === 'compact'
    ? 44
    : profile?.id === 'balanced'
      ? 50
      : profile?.id === 'roomy'
        ? 54
        : 58
  const usableWidth = Math.max(90, cardWidth - horizontalChrome)
  const itemColumnWidth = columnCount === 2
    ? Math.max(64, (usableWidth - 12) / 2)
    : usableWidth

  // The original 22/28-character estimates are intentionally conservative
  // around a ~180px production-text column. Only shrink them when a TV
  // viewport makes an item column narrower than that; never make them more
  // optimistic on larger screens.
  const widthScale = Math.min(1, itemColumnWidth / 180)
  return {
    nameChars: clamp(Math.floor(NAME_CHARS_PER_VISUAL_LINE * widthScale), 7, NAME_CHARS_PER_VISUAL_LINE),
    noteChars: clamp(Math.floor(NOTE_CHARS_PER_VISUAL_LINE * widthScale), 9, NOTE_CHARS_PER_VISUAL_LINE),
  }
}

const countVisualLines = (item, { nameChars = NAME_CHARS_PER_VISUAL_LINE, noteChars = NOTE_CHARS_PER_VISUAL_LINE } = {}) => {
  const nameLines = Math.max(1, Math.ceil(formatKitchenDisplayItemName(item).length / nameChars))
  const note = normalizeKitchenItemNote(item)
  const noteLines = note ? Math.max(1, Math.ceil(note.length / noteChars)) : 0
  return nameLines + noteLines * NOTE_LINE_WEIGHT
}

const normalizeBoardProfile = (value) => {
  const id = typeof value === 'string' ? value : value?.id
  const base = KITCHEN_BOARD_PROFILES[id] || KITCHEN_BOARD_PROFILES.focus
  if (!value || typeof value === 'string') return base
  return {
    ...base,
    ...value,
    id: base.id,
    columns: Math.max(1, Math.trunc(Number(value.columns)) || base.columns),
    gridRows: Math.max(1, Math.trunc(Number(value.gridRows)) || base.gridRows),
  }
}

const withBoardColumns = (profile, columns) => {
  const safeColumns = Math.max(1, Math.trunc(Number(columns)) || profile.columns)
  return {
    ...profile,
    columns: safeColumns,
    maxSlots: safeColumns * profile.gridRows,
  }
}

export function resolveKitchenBoardCandidates({ viewportWidth, viewportHeight, queueSize } = {}) {
  const width = Math.trunc(Number(viewportWidth))
  const height = Math.trunc(Number(viewportHeight))
  const hasViewport = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
  if (!hasViewport) return [{ ...KITCHEN_BOARD_PROFILES.focus }]

  const candidates = [{ ...KITCHEN_BOARD_PROFILES.focus }]
  const legacyTvViewport = width >= 900 && height >= 500

  // Older TV browsers commonly expose a 960x540 CSS viewport even on a
  // physically larger 16:9 panel. The responsive CSS already scales the
  // Kitchen TV for that viewport, so withholding 4-column profiles here
  // traps those devices in the six-card focus layout.
  if (legacyTvViewport || width >= 1100 && height >= 680) candidates.push({ ...KITCHEN_BOARD_PROFILES.roomy })
  if (legacyTvViewport || width >= 1100 && height >= 620) candidates.push({ ...KITCHEN_BOARD_PROFILES.balanced })
  if (legacyTvViewport || width >= 1440 && height >= 820) candidates.push({ ...KITCHEN_BOARD_PROFILES.compact })

  const count = Math.max(0, Math.trunc(Number(queueSize)) || 0)
  if (count === 0) return candidates

  if (count >= 1 && count <= 3) {
    const adaptiveFocus = {
      ...withBoardColumns(KITCHEN_BOARD_PROFILES.focus, count),
      fullHeight: true,
    }
    return [
      adaptiveFocus,
      ...candidates.filter(({ id, columns }) => id !== adaptiveFocus.id || columns !== adaptiveFocus.columns),
    ]
  }

  const twoColumnFocus = withBoardColumns(KITCHEN_BOARD_PROFILES.focus, 2)
  const threeColumnFullHeightFocus = {
    ...withBoardColumns(KITCHEN_BOARD_PROFILES.focus, 3),
    fullHeight: true,
  }

  return [
    twoColumnFocus,
    threeColumnFullHeightFocus,
    ...candidates.filter(({ id, columns }) => (
      id !== twoColumnFocus.id
      || columns !== twoColumnFocus.columns && columns !== threeColumnFullHeightFocus.columns
    )),
  ]
}

export function resolveKitchenBoardProfile({ viewportWidth, viewportHeight, queueSize = 0 } = {}) {
  const candidates = resolveKitchenBoardCandidates({ viewportWidth, viewportHeight })
  const count = Math.max(0, Math.trunc(Number(queueSize)) || 0)
  if (count <= 6) return candidates[0]

  const roomy = candidates.find(({ id }) => id === 'roomy')
  if (count <= 9 && roomy) return roomy

  const compact = candidates.find(({ id }) => id === 'compact')
  if (count >= 10 && compact) return compact

  return candidates.at(-1) || { ...KITCHEN_BOARD_PROFILES.focus }
}

export function resolveKitchenViewportProfile(viewportHeight) {
  const height = Math.trunc(Number(viewportHeight))
  if (!Number.isFinite(height) || height <= 0) return 'standard'
  if (height >= 900) return 'spacious'
  if (height <= 640) return 'constrained'
  return 'standard'
}

const countTwoColumnVisualLines = (lineHeights) => {
  let total = 0
  for (let index = 0; index < lineHeights.length; index += 2) {
    total += Math.max(lineHeights[index] || 0, lineHeights[index + 1] || 0)
  }
  return total
}

const resolveFitStrategy = ({
  visualLines,
  twoColumnVisualLines,
  itemCount,
  viewportProfile,
  boardProfile,
  canUseTwoColumns = true,
}) => {
  const profile = normalizeBoardProfile(boardProfile)
  const profileCapacity = BOARD_LINE_CAPACITY[profile.id] || VIEWPORT_LINE_CAPACITY
  const capacity = profileCapacity[viewportProfile] || profileCapacity.standard || VIEWPORT_LINE_CAPACITY.standard

  const preferTwoColumns = canUseTwoColumns && profile.id === 'compact' && itemCount >= 4

  if (preferTwoColumns && twoColumnVisualLines <= capacity.normal) {
    return { layoutDemand: 'normal', rowSpan: 1, columnCount: 2, fitStrategy: 'normal-two-columns', capacity, profile }
  }
  if (visualLines <= capacity.normal) {
    return { layoutDemand: 'normal', rowSpan: 1, columnCount: 1, fitStrategy: 'normal-one-column', capacity, profile }
  }
  if (canUseTwoColumns && twoColumnVisualLines <= capacity.normal) {
    return { layoutDemand: 'normal', rowSpan: 1, columnCount: 2, fitStrategy: 'normal-two-columns', capacity, profile }
  }
  if (profile.rows >= 2 && preferTwoColumns && twoColumnVisualLines <= capacity.tall) {
    return { layoutDemand: 'tall', rowSpan: 2, columnCount: 2, fitStrategy: 'tall-two-columns', capacity, profile }
  }
  if (profile.rows >= 2 && visualLines <= capacity.tall) {
    return { layoutDemand: 'tall', rowSpan: 2, columnCount: 1, fitStrategy: 'tall-one-column', capacity, profile }
  }
  if (profile.rows >= 2 && canUseTwoColumns && twoColumnVisualLines <= capacity.tall) {
    return { layoutDemand: 'tall', rowSpan: 2, columnCount: 2, fitStrategy: 'tall-two-columns', capacity, profile }
  }
  if (profile.rows >= 3 || profile.fullHeight === true) {
    const fullCapacity = capacity.full ?? capacity.tall * 1.65
    if (preferTwoColumns && twoColumnVisualLines <= fullCapacity) {
      return {
        layoutDemand: 'full',
        rowSpan: 3,
        columnCount: 2,
        fitStrategy: 'full-two-columns',
        capacity: { ...capacity, full: fullCapacity },
        profile,
      }
    }
    if (visualLines <= fullCapacity) {
      return {
        layoutDemand: 'full',
        rowSpan: 3,
        columnCount: 1,
        fitStrategy: 'full-one-column',
        capacity: { ...capacity, full: fullCapacity },
        profile,
      }
    }
    if (canUseTwoColumns) {
      return {
        layoutDemand: 'full',
        rowSpan: 3,
        columnCount: 2,
        fitStrategy: 'full-two-columns',
        capacity: { ...capacity, full: fullCapacity },
        profile,
        overflowRisk: twoColumnVisualLines > fullCapacity,
      }
    }
    return {
      layoutDemand: 'full',
      rowSpan: 3,
      columnCount: 1,
      fitStrategy: 'full-one-column',
      capacity: { ...capacity, full: fullCapacity },
      profile,
      overflowRisk: visualLines > fullCapacity,
    }
  }
  if (canUseTwoColumns) {
    return {
      layoutDemand: 'tall',
      rowSpan: 2,
      columnCount: 2,
      fitStrategy: 'tall-two-columns',
      capacity,
      profile,
      overflowRisk: twoColumnVisualLines > capacity.tall,
    }
  }
  return {
    layoutDemand: 'tall',
    rowSpan: 2,
    columnCount: 1,
    fitStrategy: 'tall-one-column',
    capacity,
    profile,
    overflowRisk: visualLines > capacity.tall,
  }
}

const resolveGridSpan = ({
  profile,
  visualLines,
  twoColumnVisualLines,
  itemCount,
  hasNotes,
  layoutDemand,
  columnCount,
  overflowRisk,
  viewportProfile,
}) => {
  if (profile.id === 'focus') return layoutDemand === 'normal' ? 3 : 6
  if (profile.id === 'balanced') return layoutDemand === 'normal' ? 4 : 8

  const effectiveVisualLines = columnCount === 2 ? twoColumnVisualLines : visualLines

  if (profile.id === 'roomy') {
    if (itemCount <= 2 && !hasNotes && effectiveVisualLines <= 2) return 6
    if (itemCount === 1) return 7
    const roomySpan = Math.max(6, 4 + Math.ceil(Math.max(1, effectiveVisualLines) * 1.15))
    if (overflowRisk) return profile.gridRows
    return Math.min(profile.gridRows, roomySpan)
  }

  if (viewportProfile === 'constrained') {
    if (itemCount === 1) {
      if (!hasNotes && visualLines === 1) return 6
      return 8
    }
    const constrainedSpan = Math.max(
      6,
      4 + Math.ceil(Math.max(1, effectiveVisualLines) * 1.35) + (hasNotes ? 1 : 0),
    )
    if (overflowRisk) return profile.gridRows
    return Math.min(profile.gridRows, constrainedSpan)
  }

  if (viewportProfile === 'standard') {
    if (itemCount === 1) {
      if (!hasNotes && visualLines === 1) return 5
      return 6
    }
    const standardSpan = Math.max(
      5,
      3 + Math.ceil(Math.max(1, effectiveVisualLines) * 1.15) + (hasNotes ? 1 : 0),
    )
    if (overflowRisk) return profile.gridRows
    return Math.min(profile.gridRows, standardSpan)
  }

  if (itemCount === 1) {
    if (!hasNotes && visualLines === 1) return 4
    return 5
  }

  const proportionalSpan = Math.max(4, 2 + Math.ceil(Math.max(1, effectiveVisualLines)))
  if (overflowRisk) return profile.gridRows
  return Math.min(profile.gridRows, proportionalSpan)
}

export function getKitchenCardContentMetrics(items = [], { viewportWidth, viewportHeight, boardProfile } = {}) {
  const safeItems = Array.isArray(items) ? items : []
  const profile = normalizeBoardProfile(boardProfile)
  const oneColumnLimits = resolveLineLimits({ viewportWidth, profile, columnCount: 1 })
  const twoColumnLimits = resolveLineLimits({ viewportWidth, profile, columnCount: 2 })
  const oneColumnLineHeights = safeItems.map((item) => countVisualLines(item, oneColumnLimits))
  const twoColumnLineHeights = safeItems.map((item) => countVisualLines(item, twoColumnLimits))
  const visualLines = oneColumnLineHeights.reduce((total, lines) => total + lines, 0)
  const twoColumnVisualLines = countTwoColumnVisualLines(twoColumnLineHeights)
  const itemCount = safeItems.length
  const hasNotes = safeItems.some((item) => Boolean(normalizeKitchenItemNote(item)))
  const density = visualLines >= 10 || itemCount >= 8
    ? 'dense'
    : visualLines >= 5 || itemCount >= 5
      ? 'compact'
      : 'comfortable'
  const viewportProfile = resolveKitchenViewportProfile(viewportHeight)
  const estimatedCardWidth = resolveEstimatedCardWidth(viewportWidth, profile)
  const canUseTwoColumns = !estimatedCardWidth || estimatedCardWidth >= 340
  const fit = resolveFitStrategy({
    visualLines,
    twoColumnVisualLines,
    itemCount,
    viewportProfile,
    boardProfile,
    canUseTwoColumns,
  })
  const isNano = fit.profile.id === 'compact'
    && itemCount === 1
    && !hasNotes
    && visualLines === 1
    && fit.layoutDemand === 'normal'
    && fit.columnCount === 1
  const gridSpan = resolveGridSpan({
    profile: fit.profile,
    visualLines,
    twoColumnVisualLines,
    itemCount,
    hasNotes,
    layoutDemand: fit.layoutDemand,
    columnCount: fit.columnCount,
    overflowRisk: fit.overflowRisk === true,
    viewportProfile,
  })

  return {
    itemCount,
    visualLines,
    twoColumnVisualLines,
    density,
    viewportProfile,
    boardProfile: fit.profile.id,
    layoutDemand: fit.layoutDemand,
    rowSpan: fit.rowSpan,
    gridSpan,
    isNano,
    columnCount: fit.columnCount,
    fitStrategy: fit.fitStrategy,
    normalLineCapacity: fit.capacity.normal,
    tallLineCapacity: fit.capacity.tall,
    fullLineCapacity: fit.capacity.full ?? null,
    overflowRisk: fit.overflowRisk === true,
  }
}

const normalizedSlotCeiling = (value, fallback = 6) => {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const cardGridSpan = (card, profile, boardProfileProvided) => {
  if (!boardProfileProvided) {
    return Math.min(
      Math.max(1, Math.trunc(Number(card?.rowSpan ?? card?.contentMetrics?.rowSpan ?? (card?.layoutDemand === 'tall' ? 2 : 1))) || 1),
      Math.max(1, profile.rows),
    )
  }
  return Math.min(
    Math.max(1, Math.trunc(Number(card?.gridSpan ?? card?.contentMetrics?.gridSpan)) || 1),
    Math.max(1, profile.gridRows),
  )
}

const assignKitchenGrid = (cards, boardProfile, boardProfileProvided = true) => {
  const profile = normalizeBoardProfile(boardProfile)
  const source = Array.isArray(cards) ? cards : []
  const rowCount = boardProfileProvided ? profile.gridRows : profile.rows
  const heights = Array.from({ length: profile.columns }, () => 0)
  const placements = new Array(source.length)
  const failedStates = new Set()

  // Cards occupy one full column width and always stack from the top of that
  // column. Tracking only column heights avoids 2D fragmentation and keeps
  // backtracking bounded even with dense 16-track boards.
  const stateKey = (index) => `${index}:${[...heights].sort((a, b) => a - b).join(',')}`

  const visit = (index) => {
    if (index >= source.length) return true
    const key = stateKey(index)
    if (failedStates.has(key)) return false

    const span = cardGridSpan(source[index], profile, boardProfileProvided)
    const columns = heights
      .map((height, column) => ({ height, column }))
      .sort((a, b) => a.height - b.height || a.column - b.column)
    const triedHeights = new Set()

    for (const { height, column } of columns) {
      if (triedHeights.has(height) || height + span > rowCount) continue
      triedHeights.add(height)

      placements[index] = {
        gridColumn: column + 1,
        gridRow: span > 1 ? `${height + 1} / span ${span}` : height + 1,
        rowSpan: span,
      }
      heights[column] += span

      if (visit(index + 1)) return true

      heights[column] -= span
      placements[index] = undefined
    }

    failedStates.add(key)
    return false
  }

  return visit(0) ? placements : null
}

export function packKitchenDisplaySlots(entries = [], { maxSlots, viewportWidth, viewportHeight, boardProfile } = {}) {
  const source = Array.isArray(entries) ? entries : []
  const profile = normalizeBoardProfile(boardProfile)
  const hasBoardProfile = Boolean(boardProfile)
  const slotCeiling = normalizedSlotCeiling(maxSlots, hasBoardProfile ? profile.maxSlots : 6)
  const cards = []
  let usedSlots = 0

  for (const entry of source) {
    const metrics = getKitchenCardContentMetrics(entry?.order?.items, { viewportWidth, viewportHeight, boardProfile })
    if (hasBoardProfile && metrics.overflowRisk) continue
    const slotCost = hasBoardProfile ? metrics.gridSpan : metrics.rowSpan
    if (usedSlots + slotCost > slotCeiling) {
      if (hasBoardProfile) continue
      break
    }

    const candidate = {
      ...entry,
      contentMetrics: metrics,
      layoutDemand: metrics.layoutDemand,
      rowSpan: metrics.rowSpan,
      gridSpan: metrics.gridSpan,
      slotCost,
    }
    if (hasBoardProfile && !assignKitchenGrid([...cards, candidate], profile, true)) continue

    cards.push(candidate)
    usedSlots += slotCost
  }

  return {
    cards,
    usedSlots,
    remainingSlots: slotCeiling - usedSlots,
    overflow: Math.max(0, source.length - cards.length),
  }
}

export function positionKitchenDisplayGrid(cards = [], { boardProfile, fillAvailable = false } = {}) {
  const source = Array.isArray(cards) ? cards : []
  const profile = normalizeBoardProfile(boardProfile)
  const hasBoardProfile = Boolean(boardProfile)
  const placement = assignKitchenGrid(source, profile, hasBoardProfile)

  if (!placement) return source.map((card) => ({
    ...card,
    gridPosition: { gridColumn: 1, gridRow: 1, rowSpan: cardGridSpan(card, profile, hasBoardProfile) },
  }))

  const positioned = fillAvailable && hasBoardProfile && source.length > 0 && source.length <= profile.columns
    ? placement.map((entry) => ({
        ...entry,
        gridRow: `1 / span ${profile.gridRows}`,
        rowSpan: profile.gridRows,
      }))
    : placement

  return source.map((card, index) => ({
    ...card,
    gridPosition: positioned[index],
  }))
}
