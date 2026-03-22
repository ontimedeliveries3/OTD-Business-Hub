import * as XLSX from 'xlsx'

/**
 * Shadowfax Trip Details Parser
 * Parses Muneem's monthly trip details Excel (Adhoc + Regular sheets)
 * Handles 3 month format variations (Dec, Jan, Feb)
 */

// ── Vehicle type normalization ──────────────────────────────────────────
const VEHICLE_TYPE_MAP = {
  'bolero': 'Bolero',
  'beloro': 'Bolero',
  'tata ace': 'Tata Ace',
  'tata_ace': 'Tata Ace',
  'tata 407': 'Tata 407',
  'tata_407': 'Tata 407',
  '407': 'Tata 407',
  '8 ft': '8 ft',
  'ft8': '8 ft',
  '10 ft': '10 ft',
  'ft10': '10 ft',
  '14 ft': '14 ft',
  'ft14': '14 ft',
  '17 ft': '17 ft',
  'ft17': '17 ft',
  '32 ft': '32 ft',
  'ft 32': '32 ft',
  'ft32': '32 ft',
}

export function normalizeVehicleType(raw) {
  if (!raw) return ''
  const key = String(raw).trim().toLowerCase().replace(/[_\s]+/g, ' ')
  return VEHICLE_TYPE_MAP[key] || String(raw).trim()
}

// ── Origin/destination normalization ────────────────────────────────────
export function normalizeLocation(raw) {
  if (!raw) return ''
  let s = String(raw).trim()
  // Capitalize first letter of each word, uppercase "DC"
  s = s.replace(/\b\w/g, c => c.toUpperCase())
  // Ensure "Dc" → "DC"
  s = s.replace(/\bDc\b/g, 'DC')
  return s
}

// ── Vehicle number normalization ────────────────────────────────────────
export function normalizeVehicleNo(raw) {
  if (!raw) return ''
  return String(raw).trim().toUpperCase().replace(/[\s-]/g, '')
}

// ── Date parsing (handles formatted strings from Excel) ──
// IMPORTANT: We read Excel with raw:false to get formatted date strings
// because serial numbers are locale-dependent and unreliable
export function parseExcelDate(val) {
  if (!val && val !== 0) return null

  const s = String(val).trim()
  if (!s) return null

  // ISO format: 2025-12-01 or 2025-12-01T00:00:00
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`
  }

  // DD-MM-YYYY or DD/MM/YYYY (Indian convention)
  const dmyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`
  }

  // D/M/YY or DD/MM/YY (formatted Excel dates like "1/12/25" = Dec 1 2025)
  const dmyShort = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/)
  if (dmyShort) {
    const year = parseInt(dmyShort[3]) > 50 ? `19${dmyShort[3]}` : `20${dmyShort[3]}`
    return `${year}-${dmyShort[2].padStart(2, '0')}-${dmyShort[1].padStart(2, '0')}`
  }

  // MM/DD/YYYY — only if first number > 12 (clearly day) or second > 12 (clearly month)
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashMatch) {
    const a = parseInt(slashMatch[1])
    const b = parseInt(slashMatch[2])
    // If first > 12, it must be DD/MM/YYYY
    if (a > 12) return `${slashMatch[3]}-${slashMatch[2].padStart(2, '0')}-${slashMatch[1].padStart(2, '0')}`
    // If second > 12, it must be MM/DD/YYYY
    if (b > 12) return `${slashMatch[3]}-${slashMatch[1].padStart(2, '0')}-${slashMatch[2].padStart(2, '0')}`
    // Ambiguous — assume DD/MM/YYYY (Indian convention)
    return `${slashMatch[3]}-${slashMatch[2].padStart(2, '0')}-${slashMatch[1].padStart(2, '0')}`
  }

  // Malformed like "9/12/0205"
  const weirdMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/0?(\d{3,4})$/)
  if (weirdMatch) {
    let year = weirdMatch[3]
    if (year.length === 3) year = '2' + year
    return `${year}-${weirdMatch[2].padStart(2, '0')}-${weirdMatch[1].padStart(2, '0')}`
  }

  return null
}

// ── Parse Adhoc sheet ───────────────────────────────────────────────────
function parseAdhocSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
  if (rows.length < 2) return []

  // Row 0 is header
  const headers = rows[0].map(h => String(h).trim().toLowerCase())

  // Find column indices
  const colIdx = {
    date: headers.findIndex(h => h === 'date'),
    week: headers.findIndex(h => h === 'week'),
    vehicleNo: headers.findIndex(h => h.includes('vehicle') && h.includes('no')),
    requestId: headers.findIndex(h => h.includes('request') && h.includes('id')),
    lhTrip: headers.findIndex(h => h.includes('lh') && h.includes('trip')),
    origin: headers.findIndex(h => h === 'origin'),
    destination: headers.findIndex(h => h === 'destination'),
    via: headers.findIndex(h => h === 'via'),
    lane: headers.findIndex(h => h === 'lane'),
    vendor: headers.findIndex(h => h === 'vendor'),
    vehicleType: headers.findIndex(h => h.includes('vehicle') && h.includes('type')),
    cost: headers.findIndex(h => h === 'cost'),
    costCenter: headers.findIndex(h => h.includes('cost') && h.includes('center')),
  }

  const trips = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const requestId = String(row[colIdx.requestId] || '').trim()
    if (!requestId || !requestId.startsWith('SFEC')) continue // skip empty/summary rows

    const cost = parseFloat(row[colIdx.cost]) || 0

    trips.push({
      tripType: 'adhoc',
      sfx_date: parseExcelDate(row[colIdx.date]),
      sfx_week: String(row[colIdx.week] || '').trim(),
      sfx_vehicleNo: normalizeVehicleNo(row[colIdx.vehicleNo]),
      sfx_requestId: requestId,
      sfx_tripId: String(row[colIdx.lhTrip] || '').trim(),
      sfx_origin: normalizeLocation(row[colIdx.origin]),
      sfx_destination: normalizeLocation(row[colIdx.destination]),
      sfx_via: String(row[colIdx.via] || '').trim(),
      sfx_lane: String(row[colIdx.lane] || '').trim(),
      sfx_vendor: String(row[colIdx.vendor] || '').trim(),
      sfx_vehicleType: normalizeVehicleType(row[colIdx.vehicleType]),
      sfx_cost: cost,
      sfx_costCenter: colIdx.costCenter >= 0 ? String(row[colIdx.costCenter] || '').trim() : null,
    })
  }

  return trips
}

// ── Parse Regular sheet ─────────────────────────────────────────────────
function parseRegularSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
  if (rows.length < 2) return []

  const headers = rows[0].map(h => String(h).trim().toLowerCase())

  // Dec/Feb format: Date, Trip, Lane, Vehicle (4 cols)
  // Jan format: Date of Connection, Departure Type, Vendor, Vehicle No., LH trip, Lane (6 cols)
  const isJanFormat = headers.some(h => h.includes('departure') || h.includes('connection'))

  let colIdx
  if (isJanFormat) {
    colIdx = {
      date: headers.findIndex(h => h.includes('date')),
      tripId: headers.findIndex(h => h.includes('lh') || h.includes('trip')),
      lane: headers.findIndex(h => h === 'lane'),
      vehicleNo: headers.findIndex(h => h.includes('vehicle')),
      vendor: headers.findIndex(h => h.includes('vendor')),
      departureType: headers.findIndex(h => h.includes('departure')),
    }
  } else {
    // Dec/Feb: Date, Trip, Lane, Vehicle
    colIdx = {
      date: 0,
      tripId: 1,
      lane: 2,
      vehicleNo: 3,
    }
  }

  const trips = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const tripId = String(row[colIdx.tripId] || '').trim()
    if (!tripId || !tripId.startsWith('TRP')) continue

    // Extract origin and destination from lane (e.g., "Patna DC-Sonho DC")
    const lane = String(row[colIdx.lane] || '').trim()
    let origin = '', destination = ''
    if (lane.includes('-')) {
      const parts = lane.split('-')
      origin = normalizeLocation(parts[0])
      destination = normalizeLocation(parts.slice(1).join('-'))
    }

    trips.push({
      tripType: 'regular',
      sfx_date: parseExcelDate(row[colIdx.date]),
      sfx_tripId: tripId,
      sfx_lane: lane,
      sfx_vehicleNo: normalizeVehicleNo(row[colIdx.vehicleNo]),
      sfx_origin: origin,
      sfx_destination: destination,
      sfx_requestId: null, // Regular trips have no SFEC ID
      sfx_via: null,
      sfx_vendor: isJanFormat ? String(row[colIdx.vendor] || '').trim() : null,
      sfx_vehicleType: null, // Not in Regular sheet
      sfx_cost: null, // Not in Regular sheet
      sfx_week: null,
      sfx_costCenter: null,
    })
  }

  return trips
}

// ── Main parser ─────────────────────────────────────────────────────────
export function parseTripDetailsExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })

        let adhocTrips = []
        let regularTrips = []

        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName]
          const name = sheetName.toLowerCase().trim()

          if (name.includes('adhoc') || name === 'adhoc') {
            adhocTrips = parseAdhocSheet(ws)
          } else if (name.includes('regular') || name === 'regular') {
            regularTrips = parseRegularSheet(ws)
          }
        }

        if (adhocTrips.length === 0 && regularTrips.length === 0) {
          reject(new Error('No Adhoc or Regular sheets found in the Excel file. Expected sheets named "Adhoc" and "Regular".'))
          return
        }

        const adhocTotal = adhocTrips.reduce((sum, t) => sum + (t.sfx_cost || 0), 0)

        resolve({
          adhocTrips,
          regularTrips,
          summary: {
            adhocCount: adhocTrips.length,
            regularCount: regularTrips.length,
            adhocTotal,
          },
        })
      } catch (err) {
        reject(new Error('Failed to parse Trip Details Excel: ' + err.message))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}
