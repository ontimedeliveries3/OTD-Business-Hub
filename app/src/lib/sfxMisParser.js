import * as XLSX from 'xlsx'

/**
 * Shadowfax MIS Excel Parser
 * Handles 3 formats: Regular, Adhoc, KM Reading
 * Auto-detects format from column headers
 */

// ── Format detection headers ────────────────────────────────────────────

const FORMAT_SIGNATURES = {
  regular: {
    required: ['invoice', 'freight', 'trip id'],
    // Matches: "Invoice no" + "Freight Amount"/"Freight amount" + "Trip ID"
    // Also matches Mid-Mile format (KM Slab, Total KM Billed) — stored as regular with extra fields
  },
  adhoc: {
    required: ['request id', 'lh trip', 'cost'],
  },
  km_reading: {
    required: ['vehicle code', 'count of trips'],
  },
}

// ── Column name mappings (Excel header → our field name) ────────────────

const REGULAR_COLUMNS = {
  'Invoice no': 'invoice_no',
  'Invoice No': 'invoice_no',
  'Vendor name': 'vendor_name',
  'Vendor Name': 'vendor_name',
  'VENDOR NAME': 'vendor_name',
  'Vehicle No.': 'vehicle_no',
  'Vehicle No': 'vehicle_no',
  'Vehicle Number': 'vehicle_no',
  'Veh. Type': 'vehicle_type',
  'Vehicle Size': 'vehicle_type',
  'Vehicle type': 'vehicle_type',
  'Origin': 'origin',
  'Destination': 'destination',
  'Touch Point': 'touch_points',
  'Touch point': 'touch_points',
  'Sector': 'touch_points',
  'Dispatch Date': 'date',
  'Dispatch date': 'date',
  'Date': 'date',
  'Trip ID': 'trip_id',
  'Trip Id': 'trip_id',
  'Freight Amount': 'freight_amount',
  'Freight amount': 'freight_amount',
  'Other Charges': 'other_charges',
  'Other charges': 'other_charges',
  'Other Charges/FSC': 'other_charges',
  'Net Base Amount': 'net_base_amount',
  'Net amount': 'net_base_amount',
  'IGST': 'gst',
  'GST': 'gst',
  'GST amount': 'gst',
  'IGST / GST': 'gst',
  'Total Invoice Amount': 'total_amount',
  'Invoice amount': 'total_amount',
  'Lane Code': 'lane_code',
  'Line haul type': 'line_haul_type',
  'Requirement type': 'line_haul_type',
  'Sr. No.': '_serial',
  'S.No.': '_serial',
  'SL.NO': '_serial',
  // Mid-Mile / KM-based extras
  'No Of Trips': 'km_trip_count',
  'Fixed Cost': 'km_fixed_cost',
  'KM Slab': 'km_slab',
  'Total KM Billed': 'km_total_billed',
  'Extra KM': 'km_extra',
  'Extra Km rate': 'km_extra_rate',
  'Extra KM Freight': 'km_extra_freight',
  'Freight': 'freight_amount',
  'Toll': 'other_charges',
  'Toll charges': 'other_charges',
  'Total Billing Amount': 'total_amount',
  'RFQ No': 'rfq_no',
  'RFQ No.': 'rfq_no',
  'Remark': 'remarks',
  'Remarks': 'remarks',
  'Replacement Vehicle': '_replacement_vehicle',
}

const ADHOC_COLUMNS = {
  'Date': 'date',
  'Vehicle no': 'vehicle_no',
  'Vehicle No': 'vehicle_no',
  'Vehicle No.': 'vehicle_no',
  'Request ID': 'request_id',
  'LH trip': 'trip_id',
  'LH Trip': 'trip_id',
  'Origin': 'origin',
  'Destination': 'destination',
  'Via': 'via',
  'Lane': 'lane',
  'Vendor': 'vendor_name',
  'Vehicle type': 'vehicle_type',
  'Vehicle Type': 'vehicle_type',
  'Cost': 'cost',
  'GST': 'gst',
  'GST@18%': 'gst',
  'Total': 'total_amount',
}

const KM_READING_COLUMNS = {
  'Vehicle No': 'vehicle_no',
  'Vehicle No.': 'vehicle_no',
  'Vehicle Number': 'vehicle_no',
  'Vehicle Code': 'vehicle_code',
  'Vehicle Type': 'vehicle_type',
  'Veh. Type': 'vehicle_type',
  'Count of trips': 'trip_count',
  'Count of Trips': 'trip_count',
  'Sum of Total Travel KM': 'total_travel_km',
  'Total Travel KM': 'total_travel_km',
  'Total KM': 'total_travel_km',
  'Toll charges': 'toll_charges',
  'Toll Charges': 'toll_charges',
  'Remarks': 'remarks',
  'Remark': 'remarks',
}

// ── Date parsing ────────────────────────────────────────────────────────

function parseDate(value) {
  if (!value) return ''

  // If it's already a JS Date (xlsx parses Excel dates)
  if (value instanceof Date) {
    return formatISODate(value)
  }

  // If it's a number (Excel serial date)
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value)
    if (d) {
      return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
    }
    return ''
  }

  const str = String(value).trim()

  // Try ISO format: 2025-11-01
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.substring(0, 10)
  }

  // Try DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`
  }

  // Try MM/DD/YYYY (Shadowfax requirement format)
  const mdyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (mdyMatch) {
    const m = parseInt(mdyMatch[1])
    const d = parseInt(mdyMatch[2])
    // Heuristic: if first number > 12, it's DD/MM/YYYY already handled above
    if (m <= 12) {
      return `${mdyMatch[3]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }

  // Try text dates: "1st June .25", "15th Nov 25", "1st June 2025"
  const textMatch = str.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(\w+)\.?\s*['.]?(\d{2,4})/)
  if (textMatch) {
    const day = textMatch[1].padStart(2, '0')
    const monthStr = textMatch[2].toLowerCase().substring(0, 3)
    const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }
    const month = months[monthStr]
    if (month) {
      let year = textMatch[3]
      if (year.length === 2) year = '20' + year
      return `${year}-${month}-${day}`
    }
  }

  return str // return as-is if can't parse
}

function formatISODate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ── Number parsing ──────────────────────────────────────────────────────

function parseNumber(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return value
  const cleaned = String(value).replace(/[₹,\s]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

// ── Format detection ────────────────────────────────────────────────────

function detectFormat(headers) {
  const headerSet = headers.map(h => String(h || '').trim())

  // Check each format's required headers
  for (const [format, sig] of Object.entries(FORMAT_SIGNATURES)) {
    const matches = sig.required.every(req =>
      headerSet.some(h => h.toLowerCase().includes(req.toLowerCase()))
    )
    if (matches) return format
  }

  // Fallback: check for KM-related fields (Mid-Mile → treat as regular)
  if (headerSet.some(h => /KM Slab|Total KM Billed/i.test(h))) {
    return 'regular'
  }

  return 'unknown'
}

// ── Find header row ─────────────────────────────────────────────────────

// Build a lowercase lookup from all column maps for case-insensitive header matching
const ALL_COLUMN_KEYS_LOWER = new Set(
  [...Object.keys(REGULAR_COLUMNS), ...Object.keys(ADHOC_COLUMNS), ...Object.keys(KM_READING_COLUMNS)]
    .map(k => k.toLowerCase())
)

function findHeaderRow(sheetData) {
  // Try first 10 rows to find the one with the most recognized column names
  let bestRow = 0
  let bestCount = 0
  for (let i = 0; i < Math.min(10, sheetData.length); i++) {
    const row = sheetData[i]
    if (!row) continue
    const values = Object.values(row).map(v => String(v || '').trim())
    const matchCount = values.filter(v => ALL_COLUMN_KEYS_LOWER.has(v.toLowerCase())).length
    if (matchCount > bestCount) {
      bestCount = matchCount
      bestRow = i
    }
  }
  return bestCount >= 3 ? bestRow : 0
}

// ── Parse a single sheet ────────────────────────────────────────────────

function parseSheet(worksheet, sheetName) {
  // Convert to JSON with header detection
  const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })

  if (rawData.length < 2) {
    return { format: 'unknown', trips: [], rowCount: 0, sheetName }
  }

  // Find the header row
  const headerRowIdx = findHeaderRow(
    rawData.map(row => {
      const obj = {}
      row.forEach((val, i) => { obj[i] = val })
      return obj
    })
  )

  const headers = rawData[headerRowIdx].map(h => String(h || '').trim())
  const format = detectFormat(headers)

  if (format === 'unknown') {
    return { format: 'unknown', trips: [], rowCount: 0, sheetName }
  }

  // Get column mapping for this format — build case-insensitive lookup
  const columnMapSource = format === 'adhoc' ? ADHOC_COLUMNS :
    format === 'km_reading' ? KM_READING_COLUMNS :
      REGULAR_COLUMNS

  // Build lowercase → field name lookup
  const columnMapLower = {}
  for (const [key, val] of Object.entries(columnMapSource)) {
    columnMapLower[key.toLowerCase()] = val
  }

  // Build header index → field name mapping (case-insensitive)
  const fieldMap = {}
  headers.forEach((header, idx) => {
    const match = columnMapLower[header.toLowerCase()]
    if (match) {
      fieldMap[idx] = match
    }
  })

  // Parse data rows
  const trips = []
  for (let r = headerRowIdx + 1; r < rawData.length; r++) {
    const row = rawData[r]
    if (!row || row.every(cell => cell === '' || cell == null)) continue

    const trip = { format }

    for (const [colIdx, fieldName] of Object.entries(fieldMap)) {
      const value = row[parseInt(colIdx)]
      if (fieldName.startsWith('_')) continue // skip internal fields

      // Parse based on field type
      if (fieldName === 'date') {
        trip[fieldName] = parseDate(value)
      } else if ([
        'freight_amount', 'other_charges', 'net_base_amount', 'gst',
        'total_amount', 'cost', 'toll_charges', 'trip_count',
        'total_travel_km', 'km_slab', 'km_total_billed', 'km_extra',
        'km_extra_rate', 'km_extra_freight', 'km_fixed_cost', 'km_trip_count',
      ].includes(fieldName)) {
        trip[fieldName] = parseNumber(value)
      } else {
        trip[fieldName] = value != null ? String(value).trim() : ''
      }
    }

    // Skip rows that are clearly empty (no trip ID / vehicle / date)
    const hasIdentifier = trip.trip_id || trip.request_id || trip.vehicle_no || trip.vehicle_code
    if (!hasIdentifier) continue

    trips.push(trip)
  }

  return { format, trips, rowCount: trips.length, sheetName }
}

// ── Main parser function ────────────────────────────────────────────────

export async function parseSfxExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array', cellDates: true })

        const sheets = []
        const allTrips = []
        const formats = new Set()

        for (const sheetName of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sheetName]
          const result = parseSheet(worksheet, sheetName)

          if (result.format !== 'unknown' && result.rowCount > 0) {
            sheets.push({
              name: sheetName,
              format: result.format,
              rowCount: result.rowCount,
            })
            formats.add(result.format)
            allTrips.push(...result.trips)
          }
        }

        // Build summary
        let totalAmount = 0
        const byFormat = {}
        const byVehicle = {}
        let minDate = null
        let maxDate = null

        for (const trip of allTrips) {
          // Amount: use total_amount if available, otherwise cost
          const amt = trip.total_amount || trip.cost || 0
          totalAmount += amt

          // By format
          byFormat[trip.format] = (byFormat[trip.format] || 0) + 1

          // By vehicle
          const veh = trip.vehicle_no || trip.vehicle_code || 'Unknown'
          byVehicle[veh] = (byVehicle[veh] || 0) + 1

          // Date range
          if (trip.date && trip.date.length >= 10) {
            if (!minDate || trip.date < minDate) minDate = trip.date
            if (!maxDate || trip.date > maxDate) maxDate = trip.date
          }
        }

        resolve({
          sheets,
          trips: allTrips,
          summary: {
            totalTrips: allTrips.length,
            totalAmount: Math.round(totalAmount * 100) / 100,
            formats: [...formats],
            byFormat,
            byVehicle,
            dateRange: { from: minDate, to: maxDate },
          },
        })
      } catch (err) {
        reject(new Error('Failed to parse Excel file: ' + err.message))
      }
    }

    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}
