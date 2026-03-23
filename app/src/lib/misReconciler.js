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

// ── Match Adhoc trips by SFEC Request ID against Trip Logger ────────────
function matchAdhocByTripLogger(misTrips, otdTrips) {
  // Build lookup: sfec_request_id → trip
  const tripBySfec = {}
  for (const t of otdTrips) {
    if (t.sfec_request_id) {
      tripBySfec[t.sfec_request_id] = t
    }
  }

  for (const trip of misTrips) {
    // Skip already matched or non-adhoc
    if (trip.matchStatus === 'matched' || trip.matchStatus === 'amount_mismatch') continue
    if (!trip.sfx_requestId) continue

    const otdTrip = tripBySfec[trip.sfx_requestId]
    if (otdTrip) {
      trip.otd_tripId = otdTrip.id
      const otdAmount = parseFloat(otdTrip.amount) || 0

      if (trip.sfx_cost && otdAmount > 0) {
        if (amountsMatch(trip.sfx_cost, otdAmount)) {
          trip.matchStatus = 'matched'
        } else {
          trip.matchStatus = 'amount_mismatch'
          trip.amountDifference = (trip.sfx_cost || 0) - otdAmount
        }
      } else {
        trip.matchStatus = 'matched'
      }
    }
  }
}

// ── Match unmatched Adhoc by date+vehicle against Trip Logger ─────────────
function matchAdhocByDateVehicle(misTrips, otdTrips) {
  const tripsByDateVehicle = {}
  for (const t of otdTrips) {
    if (!t.date || !t.vehicle_no) continue
    const key = `${t.date}|${normalizeVehicleNo(t.vehicle_no)}`
    if (!tripsByDateVehicle[key]) tripsByDateVehicle[key] = []
    tripsByDateVehicle[key].push(t)
  }

  for (const trip of misTrips) {
    if (trip.matchStatus === 'matched' || trip.matchStatus === 'amount_mismatch') continue
    if (trip.tripType !== 'adhoc') continue
    if (!trip.sfx_date || !trip.sfx_vehicleNo) continue

    const key = `${trip.sfx_date}|${trip.sfx_vehicleNo}`
    const candidates = tripsByDateVehicle[key]
    if (!candidates || candidates.length === 0) continue

    let bestMatch = null
    let bestScore = -1
    for (const c of candidates) {
      let score = 1
      if (originsMatch(trip.sfx_origin, c.origin)) score += 2
      if (trip.sfx_cost && c.amount && amountsMatch(trip.sfx_cost, parseFloat(c.amount))) score += 1
      if (score > bestScore) { bestScore = score; bestMatch = c }
    }

    if (bestMatch) {
      trip.otd_tripId = bestMatch.id
      const otdAmount = parseFloat(bestMatch.amount) || 0
      if (trip.sfx_cost && otdAmount > 0) {
        if (amountsMatch(trip.sfx_cost, otdAmount)) {
          trip.matchStatus = 'matched'
        } else {
          trip.matchStatus = 'amount_mismatch'
          trip.amountDifference = (trip.sfx_cost || 0) - otdAmount
        }
      } else {
        trip.matchStatus = 'matched'
      }
    }
  }
}

// ── Normalize lane name for fuzzy matching ────────────────────────────────
function normalizeLane(lane) {
  if (!lane) return ''
  return lane.toLowerCase()
    .replace(/\s+dc/gi, '')
    .replace(/[-–—]/g, '-')
    .replace(/\s+/g, '')
    .trim()
}

// ── Match Regular trips against Regular Trips (lane contracts) ────────────
function matchRegularTrips(misTrips, regularTripsSetup) {
  console.log('[MIS Recon] matchRegularTrips called with', regularTripsSetup?.length, 'contracts')
  if (!regularTripsSetup || regularTripsSetup.length === 0) return

  // Build lookup: normalized lane → contract(s)
  const contractsByLane = {}
  for (const rt of regularTripsSetup) {
    if (rt.status !== 'active') continue
    const key = normalizeLane(rt.lane)
    console.log('[MIS Recon] Contract:', rt.lane, '→ normalized:', key, '| status:', rt.status)
    if (!contractsByLane[key]) contractsByLane[key] = []
    contractsByLane[key].push(rt)
  }

  const regularMisTrips = misTrips.filter(t => t.tripType === 'regular')
  console.log('[MIS Recon] Regular MIS trips to match:', regularMisTrips.length)
  if (regularMisTrips.length > 0) {
    const first = regularMisTrips[0]
    console.log('[MIS Recon] First regular trip: sfx_lane=', JSON.stringify(first.sfx_lane), '| normalized:', normalizeLane(first.sfx_lane || ''))
  }

  for (const trip of misTrips) {
    if (trip.tripType !== 'regular') continue
    if (trip.matchStatus === 'disputed') continue

    const lane = trip.sfx_lane || ''
    const normalizedLane = normalizeLane(lane)

    // Try to find matching contract
    const contracts = contractsByLane[normalizedLane]
    if (contracts && contracts.length > 0) {
      // If vehicle matches one of the contracts, prefer that
      const vehicleMatch = contracts.find(c =>
        normalizeVehicleNo(c.vehicleNo) === trip.sfx_vehicleNo
      )
      const contract = vehicleMatch || contracts[0]
      trip.otd_regularTripId = contract.id
      trip.otd_regularLane = contract.lane
      trip.matchStatus = 'matched'
    }
    // If no contract match, stays unmatched
  }
}

// ── Build Regular lane-level summary with day-by-day attendance ───────────
export function buildRegularLaneSummary(misTrips, regularTripsSetup, month) {
  // Parse month to get all days
  const [year, mon] = (month || '').split('-').map(Number)
  const daysInMonth = year && mon ? new Date(year, mon, 0).getDate() : 31
  const allDates = []
  if (year && mon) {
    for (let d = 1; d <= daysInMonth; d++) {
      allDates.push(`${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
    }
  }

  // Group Regular MIS trips by lane
  const misTripsByLane = {}
  for (const trip of misTrips) {
    if (trip.tripType !== 'regular') continue
    const lane = trip.sfx_lane || 'Unknown'
    if (!misTripsByLane[lane]) misTripsByLane[lane] = []
    misTripsByLane[lane].push(trip)
  }

  const summary = []

  // For each contract, find matching MIS trips
  for (const contract of regularTripsSetup) {
    if (contract.status !== 'active') continue

    const normalizedContractLane = normalizeLane(contract.lane)
    let matchedLane = null
    let matchedTrips = []

    for (const [misLane, trips] of Object.entries(misTripsByLane)) {
      if (normalizeLane(misLane) === normalizedContractLane) {
        matchedLane = misLane
        matchedTrips = trips
        break
      }
    }

    // Build date attendance map: date → trip data (or null if missing)
    const tripDatesSet = new Set(matchedTrips.map(t => t.sfx_date).filter(Boolean))
    const tripByDate = {}
    for (const t of matchedTrips) {
      if (t.sfx_date) tripByDate[t.sfx_date] = t
    }

    const dateGrid = allDates.map(date => ({
      date,
      day: new Date(date).getDate(),
      hasTrip: tripDatesSet.has(date),
      tripId: tripByDate[date]?.sfx_tripId || null,
      vehicleNo: tripByDate[date]?.sfx_vehicleNo || null,
    }))

    const missingDates = dateGrid.filter(d => !d.hasTrip).map(d => d.date)

    const expectedTrips = contract.workingDays || 30
    const actualTrips = matchedTrips.length
    const perTripRevenue = contract.client === 'Meesho'
      ? (contract.tripRate || 0)
      : (contract.allottedKms || 0) * (contract.cpkRate || 0)
    const expectedRevenue = expectedTrips * perTripRevenue
    const actualRevenue = actualTrips * perTripRevenue

    const vehiclesInMis = [...new Set(matchedTrips.map(t => t.sfx_vehicleNo).filter(Boolean))]
    const vehicleMatch = vehiclesInMis.length === 0 || vehiclesInMis.includes(normalizeVehicleNo(contract.vehicleNo))

    let status = 'match'
    if (actualTrips === 0) status = 'no_data'
    else if (actualTrips < expectedTrips) status = 'count_low'
    else if (actualTrips > expectedTrips) status = 'count_high'
    if (!vehicleMatch) status = 'vehicle_mismatch'

    summary.push({
      contractId: contract.id,
      lane: contract.lane,
      vehicleNo: contract.vehicleNo,
      vehicleType: contract.vehicleType,
      cpkRate: contract.cpkRate,
      allottedKms: contract.allottedKms,
      expectedTrips,
      actualTrips,
      expectedRevenue,
      actualRevenue,
      vehiclesInMis,
      vehicleMatch,
      status,
      missingTrips: expectedTrips - actualTrips,
      dateGrid,
      missingDates,
      daysInMonth,
    })

    if (matchedLane) delete misTripsByLane[matchedLane]
  }

  // Unrecognized lanes
  for (const [lane, trips] of Object.entries(misTripsByLane)) {
    const tripDatesSet = new Set(trips.map(t => t.sfx_date).filter(Boolean))
    const tripByDate = {}
    for (const t of trips) {
      if (t.sfx_date) tripByDate[t.sfx_date] = t
    }
    const dateGrid = allDates.map(date => ({
      date,
      day: new Date(date).getDate(),
      hasTrip: tripDatesSet.has(date),
      tripId: tripByDate[date]?.sfx_tripId || null,
      vehicleNo: tripByDate[date]?.sfx_vehicleNo || null,
    }))

    summary.push({
      contractId: null,
      lane,
      vehicleNo: trips[0]?.sfx_vehicleNo || '—',
      vehicleType: '—',
      cpkRate: 0, allottedKms: 0,
      expectedTrips: 0, actualTrips: trips.length,
      expectedRevenue: 0, actualRevenue: 0,
      vehiclesInMis: [...new Set(trips.map(t => t.sfx_vehicleNo).filter(Boolean))],
      vehicleMatch: false,
      status: 'unrecognized',
      missingTrips: 0,
      dateGrid,
      missingDates: [],
      daysInMonth,
    })
  }

  return summary
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
export function reconcile(misTrips, otdTrips, bids, regularTripsSetup = [], month = '') {
  // Reset match status on all MIS trips
  for (const trip of misTrips) {
    if (trip.matchStatus !== 'disputed') {
      trip.matchStatus = null
      trip.otd_bidId = trip.otd_bidId || null
      trip.otd_bidAmount = trip.otd_bidAmount || null
      trip.otd_tripId = trip.otd_tripId || null
      trip.otd_regularTripId = null
      trip.otd_regularLane = null
      trip.amountDifference = null
    }
  }

  // Step 1: Match adhoc by SFEC Request ID against Bid Tracker
  matchAdhocTrips(misTrips, bids)

  // Step 1b: Match adhoc by SFEC Request ID against Trip Logger
  matchAdhocByTripLogger(misTrips, otdTrips)

  // Step 2: Match unmatched adhoc by date + vehicle against Trip Logger
  matchAdhocByDateVehicle(misTrips, otdTrips)

  // Step 3: Match Regular trips against Regular Trips contracts (lane matching)
  matchRegularTrips(misTrips, regularTripsSetup)

  // Step 4: Mark unmatched
  markUnmatched(misTrips)

  // Step 5: Find OTD trips missing from MIS (adhoc only — regular uses lane contracts)
  const missingFromMis = findMissingFromMis(misTrips, otdTrips)

  // Step 6: Build Regular lane summary
  const regularLaneSummary = buildRegularLaneSummary(misTrips, regularTripsSetup, month)

  // Compute stats
  const adhocTrips = misTrips.filter(t => t.tripType === 'adhoc')
  const regularMisTrips = misTrips.filter(t => t.tripType === 'regular')

  const stats = {
    total: misTrips.length,
    matched: misTrips.filter(t => t.matchStatus === 'matched').length,
    amountMismatch: misTrips.filter(t => t.matchStatus === 'amount_mismatch').length,
    unmatched: misTrips.filter(t => t.matchStatus === 'unmatched').length,
    disputed: misTrips.filter(t => t.matchStatus === 'disputed').length,
    missingFromMis: missingFromMis.length,
    totalMisAmount: adhocTrips.reduce((s, t) => s + (t.sfx_cost || 0), 0),
    totalOtdAmount: adhocTrips.reduce((s, t) => s + (t.otd_bidAmount || 0), 0),
    totalDiff: adhocTrips.reduce((s, t) => s + (t.amountDifference || 0), 0),
    totalCnDiff: misTrips.reduce((s, t) => s + (t.cn_diff || 0), 0),
    // Regular stats
    regularTotal: regularMisTrips.length,
    regularMatched: regularMisTrips.filter(t => t.matchStatus === 'matched').length,
    regularUnmatched: regularMisTrips.filter(t => t.matchStatus === 'unmatched').length,
    regularExpectedRevenue: regularLaneSummary.reduce((s, l) => s + l.expectedRevenue, 0),
    regularActualRevenue: regularLaneSummary.reduce((s, l) => s + l.actualRevenue, 0),
  }

  return { misTrips, missingFromMis, stats, regularLaneSummary }
}
