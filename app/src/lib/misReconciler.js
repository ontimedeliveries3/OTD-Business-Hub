import { normalizeVehicleNo } from './sfxTripDetailsParser'

/**
 * MIS Reconciliation Engine
 * Matches Shadowfax MIS trips against OTD's Bid Tracker and Trip Logger
 */

// ── Origin fuzzy matching ───────────────────────────────────────────────
function normalizeOriginForMatch(raw) {
  if (!raw) return ''
  return raw.toLowerCase()
    .replace(/\s+dc$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function originsMatch(a, b) {
  if (!a || !b) return false
  return normalizeOriginForMatch(a) === normalizeOriginForMatch(b)
}

// ── Amount comparison ───────────────────────────────────────────────────
const AMOUNT_TOLERANCE_PERCENT = 0.02  // 2%
const AMOUNT_TOLERANCE_ABS = 100       // ₹100

function amountsMatch(a, b) {
  if (a === 0 && b === 0) return true
  if (!a || !b) return false
  const diff = Math.abs(a - b)
  const tolerance = Math.max(Math.max(a, b) * AMOUNT_TOLERANCE_PERCENT, AMOUNT_TOLERANCE_ABS)
  return diff <= tolerance
}

// ── Match Adhoc trips by SFEC Request ID ────────────────────────────────
function matchAdhocTrips(misTrips, bids) {
  // Build lookup: requestId → bid
  const bidByRequestId = {}
  for (const bid of bids) {
    if (bid.requestId) {
      bidByRequestId[bid.requestId] = bid
    }
  }

  for (const trip of misTrips) {
    if (trip.tripType !== 'adhoc' || !trip.sfx_requestId) continue

    const bid = bidByRequestId[trip.sfx_requestId]
    if (bid) {
      trip.otd_bidId = bid.id
      trip.otd_bidAmount = bid.allocationPrice || bid.bidAmount || 0

      // Check amount match
      if (trip.sfx_cost && trip.otd_bidAmount) {
        if (amountsMatch(trip.sfx_cost, trip.otd_bidAmount)) {
          trip.matchStatus = 'matched'
        } else {
          trip.matchStatus = 'amount_mismatch'
          trip.amountDifference = (trip.sfx_cost || 0) - (trip.otd_bidAmount || 0)
        }
      } else {
        trip.matchStatus = 'matched' // Matched by ID, no amount to compare
      }
    }
    // If no bid match, try trip logger below
  }
}

// ── Match Regular trips + unmatched Adhoc by date+vehicle ────────────────
function matchByDateVehicle(misTrips, otdTrips) {
  // Build lookup: date+vehicleNo → [trips]
  const tripsByDateVehicle = {}
  for (const t of otdTrips) {
    if (!t.date || !t.vehicle_no) continue
    const key = `${t.date}|${normalizeVehicleNo(t.vehicle_no)}`
    if (!tripsByDateVehicle[key]) tripsByDateVehicle[key] = []
    tripsByDateVehicle[key].push(t)
  }

  for (const trip of misTrips) {
    // Skip already matched
    if (trip.matchStatus === 'matched' || trip.matchStatus === 'amount_mismatch') continue

    if (!trip.sfx_date || !trip.sfx_vehicleNo) continue

    const key = `${trip.sfx_date}|${trip.sfx_vehicleNo}`
    const candidates = tripsByDateVehicle[key]

    if (!candidates || candidates.length === 0) continue

    // Find best match — prefer origin match, then amount match
    let bestMatch = null
    let bestScore = -1

    for (const c of candidates) {
      let score = 1 // base score for date+vehicle match
      if (originsMatch(trip.sfx_origin, c.origin)) score += 2
      if (trip.sfx_cost && c.amount && amountsMatch(trip.sfx_cost, parseFloat(c.amount))) score += 1
      if (score > bestScore) {
        bestScore = score
        bestMatch = c
      }
    }

    if (bestMatch) {
      trip.otd_tripId = bestMatch.id
      const otdAmount = parseFloat(bestMatch.amount) || 0

      if (trip.sfx_cost != null && otdAmount > 0) {
        if (amountsMatch(trip.sfx_cost, otdAmount)) {
          trip.matchStatus = 'matched'
        } else {
          trip.matchStatus = 'amount_mismatch'
          trip.amountDifference = (trip.sfx_cost || 0) - otdAmount
        }
      } else {
        // Regular trips have no cost column — match by identity only
        trip.matchStatus = 'matched'
      }
    }
  }
}

// ── Mark unmatched as missing_in_otd ────────────────────────────────────
function markUnmatched(misTrips) {
  for (const trip of misTrips) {
    if (!trip.matchStatus) {
      trip.matchStatus = 'unmatched'
    }
  }
}

// ── Find OTD trips missing from SFX MIS ─────────────────────────────────
function findMissingFromMis(misTrips, otdTrips) {
  // Collect all OTD trip IDs that were matched
  const matchedOtdTripIds = new Set()
  const matchedBidIds = new Set()
  for (const t of misTrips) {
    if (t.otd_tripId) matchedOtdTripIds.add(t.otd_tripId)
    if (t.otd_bidId) matchedBidIds.add(t.otd_bidId)
  }

  // OTD trips (Shadowfax only) not in any MIS record
  return otdTrips
    .filter(t => !matchedOtdTripIds.has(t.id))
    .map(t => ({
      id: t.id,
      date: t.date,
      vehicle_no: t.vehicle_no,
      origin: t.origin,
      destination: t.destination,
      amount: t.amount,
      vehicle_size: t.vehicle_size,
      driver_name: t.driver_name,
    }))
}

// ── Merge Credit Note data into MIS trips ───────────────────────────────
export function mergeCreditNoteData(misTrips, cnTrips) {
  // Build lookup by trip ID (SFEC or TRP)
  const cnByTripId = {}
  for (const cn of cnTrips) {
    if (cn.cn_tripId) {
      cnByTripId[cn.cn_tripId] = cn
    }
  }

  let mergedCount = 0
  for (const trip of misTrips) {
    // Try matching by SFEC Request ID first (adhoc), then by TRP Trip ID (regular)
    const matchId = trip.sfx_requestId || trip.sfx_tripId
    const cn = cnByTripId[matchId]

    if (cn) {
      // Merge CN data into the trip
      Object.assign(trip, cn)
      mergedCount++

      // Update match status if there's a diff
      if (cn.cn_diff && cn.cn_diff !== 0) {
        trip.matchStatus = 'amount_mismatch'
        trip.amountDifference = cn.cn_diff
      }
    }
  }

  return { mergedCount, totalCnTrips: cnTrips.length }
}

// ── Main reconciliation function ────────────────────────────────────────
export function reconcile(misTrips, otdTrips, bids) {
  // Reset match status on all MIS trips
  for (const trip of misTrips) {
    if (trip.matchStatus !== 'disputed') {
      trip.matchStatus = null
      trip.otd_bidId = trip.otd_bidId || null
      trip.otd_bidAmount = trip.otd_bidAmount || null
      trip.otd_tripId = trip.otd_tripId || null
      trip.amountDifference = null
    }
  }

  // Step 1: Match adhoc by SFEC Request ID
  matchAdhocTrips(misTrips, bids)

  // Step 2: Match remaining by date + vehicle
  matchByDateVehicle(misTrips, otdTrips)

  // Step 3: Mark unmatched
  markUnmatched(misTrips)

  // Step 4: Find OTD trips missing from MIS
  const missingFromMis = findMissingFromMis(misTrips, otdTrips)

  // Compute stats
  const stats = {
    total: misTrips.length,
    matched: misTrips.filter(t => t.matchStatus === 'matched').length,
    amountMismatch: misTrips.filter(t => t.matchStatus === 'amount_mismatch').length,
    unmatched: misTrips.filter(t => t.matchStatus === 'unmatched').length,
    disputed: misTrips.filter(t => t.matchStatus === 'disputed').length,
    missingFromMis: missingFromMis.length,
    totalMisAmount: misTrips.reduce((s, t) => s + (t.sfx_cost || 0), 0),
    totalOtdAmount: misTrips.reduce((s, t) => s + (t.otd_bidAmount || 0), 0),
    totalDiff: misTrips.reduce((s, t) => s + (t.amountDifference || 0), 0),
    totalCnDiff: misTrips.reduce((s, t) => s + (t.cn_diff || 0), 0),
  }

  return { misTrips, missingFromMis, stats }
}
