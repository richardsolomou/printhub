export type PrinterProfile = {
  id: string
  name: string
  widthMm: number
  depthMm: number
  heightMm: number
  spacingMm: number
  supportMarginMm: number
  adhesionMarginMm: number
  heightAllowanceMm: number
  maxHeightDifferenceMm: number
}

export type PlateCandidate = {
  copyId: string
  requestId: string
  name: string
  footprint: { widthMm: number; depthMm: number; known: boolean }
  estimatedSupportedHeightMm: number
}

export type PlatePlacement = PlateCandidate & {
  xMm: number
  yMm: number
  rotationZDegrees: number
}

export type PlateModelAnalysis = {
  requestId: string
  widthMm: number
  depthMm: number
  heightMm: number
}

export type PlatePlannerDraft = {
  fingerprint: string
  printerId: string
  candidates: PlateCandidate[]
  placements: PlatePlacement[]
  skippedCount: number
  savedAt: number
}

export type PlacementIssue = 'overlap' | 'spacing' | 'out-of-bounds'

export function placementDimensions(placement: Pick<PlatePlacement, 'footprint' | 'rotationZDegrees'>, printer?: PrinterProfile) {
  const quarterTurn = Math.abs(Math.round(placement.rotationZDegrees / 90)) % 2 === 1
  const footprint = quarterTurn ? { widthMm: placement.footprint.depthMm, depthMm: placement.footprint.widthMm } : placement.footprint
  const margin = printer ? printer.supportMarginMm + printer.adhesionMarginMm : 0
  return { widthMm: footprint.widthMm + margin * 2, depthMm: footprint.depthMm + margin * 2 }
}

function bounds(placement: PlatePlacement, printer: PrinterProfile, padding = 0) {
  const size = placementDimensions(placement, printer)
  return {
    left: placement.xMm - size.widthMm / 2 - padding,
    right: placement.xMm + size.widthMm / 2 + padding,
    top: placement.yMm - size.depthMm / 2 - padding,
    bottom: placement.yMm + size.depthMm / 2 + padding,
  }
}

function intersects(first: ReturnType<typeof bounds>, second: ReturnType<typeof bounds>) {
  return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top
}

export function placementIssues(placements: PlatePlacement[], printer: PrinterProfile) {
  const issues = new Map<string, Set<PlacementIssue>>()
  const add = (copyId: string, issue: PlacementIssue) => {
    const current = issues.get(copyId) ?? new Set<PlacementIssue>()
    current.add(issue)
    issues.set(copyId, current)
  }

  for (const placement of placements) {
    const box = bounds(placement, printer)
    if (
      box.left < 0 ||
      box.top < 0 ||
      box.right > printer.widthMm ||
      box.bottom > printer.depthMm ||
      placement.estimatedSupportedHeightMm > printer.heightMm
    ) {
      add(placement.copyId, 'out-of-bounds')
    }
  }

  for (let firstIndex = 0; firstIndex < placements.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < placements.length; secondIndex++) {
      const first = placements[firstIndex]
      const second = placements[secondIndex]
      if (!first || !second) continue
      if (intersects(bounds(first, printer), bounds(second, printer))) {
        add(first.copyId, 'overlap')
        add(second.copyId, 'overlap')
      } else if (intersects(bounds(first, printer, printer.spacingMm / 2), bounds(second, printer, printer.spacingMm / 2))) {
        add(first.copyId, 'spacing')
        add(second.copyId, 'spacing')
      }
    }
  }
  return issues
}

function canPlace(placement: PlatePlacement, placed: PlatePlacement[], printer: PrinterProfile) {
  const box = bounds(placement, printer)
  if (
    box.left < 0 ||
    box.top < 0 ||
    box.right > printer.widthMm ||
    box.bottom > printer.depthMm ||
    placement.estimatedSupportedHeightMm > printer.heightMm
  ) {
    return false
  }
  return placed.every(
    (other) => !intersects(bounds(placement, printer, printer.spacingMm / 2), bounds(other, printer, printer.spacingMm / 2)),
  )
}

function placementAnchors(placed: PlatePlacement[], printer: PrinterProfile) {
  const anchors = [{ x: printer.spacingMm, y: printer.spacingMm }]
  for (const placement of placed) {
    const box = bounds(placement, printer)
    anchors.push({ x: box.right + printer.spacingMm, y: box.top })
    anchors.push({ x: box.left, y: box.bottom + printer.spacingMm })
  }
  return anchors.sort((first, second) => first.y - second.y || first.x - second.x)
}

export function packPlate(candidates: PlateCandidate[], printer: PrinterProfile) {
  const compatible = bestHeightBand(candidates, printer)
  const compatibleIds = new Set(compatible.map((candidate) => candidate.copyId))
  const ordered = [...compatible].sort((first, second) => {
    const firstSize = placementDimensions({ ...first, rotationZDegrees: 0 }, printer)
    const secondSize = placementDimensions({ ...second, rotationZDegrees: 0 }, printer)
    return secondSize.widthMm * secondSize.depthMm - firstSize.widthMm * firstSize.depthMm
  })
  const placements: PlatePlacement[] = []
  const skipped: PlateCandidate[] = candidates.filter((candidate) => !compatibleIds.has(candidate.copyId))

  for (const candidate of ordered) {
    let accepted: PlatePlacement | undefined
    for (const rotationZDegrees of [0, 90]) {
      const rotated = { ...candidate, xMm: 0, yMm: 0, rotationZDegrees }
      const size = placementDimensions(rotated, printer)
      for (const anchor of placementAnchors(placements, printer)) {
        const placement = {
          ...rotated,
          xMm: anchor.x + size.widthMm / 2,
          yMm: anchor.y + size.depthMm / 2,
        }
        if (canPlace(placement, placements, printer)) {
          accepted = placement
          break
        }
      }
      if (accepted) break
    }
    if (accepted) placements.push(accepted)
    else skipped.push(candidate)
  }
  return { placements, skipped }
}

function bestHeightBand(candidates: PlateCandidate[], printer: PrinterProfile) {
  if (!candidates.length || printer.maxHeightDifferenceMm <= 0) return candidates
  const byHeight = [...candidates].sort((first, second) => first.estimatedSupportedHeightMm - second.estimatedSupportedHeightMm)
  let best: PlateCandidate[] = []
  let right = 0
  for (let left = 0; left < byHeight.length; left++) {
    while (
      right < byHeight.length &&
      byHeight[right].estimatedSupportedHeightMm - byHeight[left].estimatedSupportedHeightMm <= printer.maxHeightDifferenceMm
    ) {
      right++
    }
    const band = byHeight.slice(left, right)
    const bandArea = band.reduce((total, candidate) => {
      const size = placementDimensions({ ...candidate, rotationZDegrees: 0 }, printer)
      return total + size.widthMm * size.depthMm
    }, 0)
    const bestArea = best.reduce((total, candidate) => {
      const size = placementDimensions({ ...candidate, rotationZDegrees: 0 }, printer)
      return total + size.widthMm * size.depthMm
    }, 0)
    if (band.length > best.length || (band.length === best.length && bandArea > bestArea)) best = band
  }
  return best
}

export function normalizePrinterProfile(
  profile: Partial<PrinterProfile> & Pick<PrinterProfile, 'id' | 'name' | 'widthMm' | 'depthMm' | 'heightMm'>,
) {
  return {
    id: profile.id,
    name: profile.name,
    widthMm: profile.widthMm,
    depthMm: profile.depthMm,
    heightMm: profile.heightMm,
    spacingMm: profile.spacingMm ?? 5,
    supportMarginMm: profile.supportMarginMm ?? 4,
    adhesionMarginMm: profile.adhesionMarginMm ?? 2,
    heightAllowanceMm: profile.heightAllowanceMm ?? 5,
    maxHeightDifferenceMm: profile.maxHeightDifferenceMm ?? 20,
  } satisfies PrinterProfile
}
