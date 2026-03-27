import * as XLSX from 'xlsx'

// ── Constants ────────────────────────────────────────────────────────────────

export const ORIGINS = ['Patna DC', 'Ranchi DC', 'Purnia DC', 'Other']

export const VEHICLE_SIZES = [
  'Bolero', 'Tata 407', 'Tata 710',
]

export const SKIP_REASONS = [
  { value: 'no_vehicle', label: 'No vehicle available' },
  { value: 'price_too_low', label: 'Price too low' },
  { value: 'driver_unavailable', label: 'Driver unavailable' },
  { value: 'outside_area', label: 'Outside operating area' },
  { value: 'other', label: 'Other' },
]

export const BID_STATUSES = [
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

const todayISO = () => new Date().toISOString().split('T')[0]

export const emptyBid = () => ({
  requestId: '',
  client: 'Shadowfax',
  origin: '',
  destination: '',
  touchPoints: '',        // comma-separated string in form, converted to array on save
  vehicleSize: '',
  tat: '',
  placementTime: todayISO(),
  bidDeadline: '',
  status: 'won',
  bidAmount: '',
  allocationPrice: '',
  skipReason: '',
  requestDate: todayISO(),
})

// ── Excel date serial → ISO date string ──────────────────────────────────────

function excelSerialToISO(serial) {
  if (!serial || typeof serial !== 'number') return ''
  // Excel epoch: 1900-01-01, but Excel incorrectly treats 1900 as leap year
  // So serial 1 = 1900-01-01, serial 60 = 1900-02-29 (doesn't exist)
  // For dates after 1900-02-28, subtract 1 extra day
  const epoch = new Date(1899, 11, 30) // Dec 30, 1899
  const date = new Date(epoch.getTime() + serial * 86400000)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ── Normalize vehicle size from Excel to app constants ───────────────────────

function normalizeVehicleSize(raw) {
  if (!raw) return ''
  const lower = raw.trim().toLowerCase()
  if (lower === 'bolero' || lower === 'belero') return 'Bolero'
  if (lower === 'tata 407' || lower === 'tata_407' || lower === '407') return 'Tata 407'
  if (lower === 'tata 710' || lower === 'tata_710' || lower === '710') return 'Tata 710'
  if (lower === 'tata ace' || lower === 'tata_ace') return 'Bolero' // Map Tata Ace to Bolero (closest equivalent)
  return raw.trim()
}

// ── Parse price string "Rs. 6300/-" → 6300 ──────────────────────────────────

function parsePrice(raw) {
  if (typeof raw === 'number') return raw
  if (!raw) return 0
  // Extract only digits (no decimals expected in prices like "Rs. 6300/-")
  const cleaned = String(raw).replace(/[^\d]/g, '')
  return parseInt(cleaned, 10) || 0
}

// ── Parse Shadowfax allocation Excel ─────────────────────────────────────────

export function parseAllocationExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

        if (rows.length < 2) {
          reject(new Error('Excel file is empty or has no data rows'))
          return
        }

        // Group rows: forward-fill Request ID, collect touch points
        const grouped = []
        let current = null

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i]
          const requestId = String(row[0] || '').trim()
          const touchPoint = String(row[4] || '').trim()

          if (requestId) {
            // New request — save previous if exists
            if (current) grouped.push(current)
            current = {
              requestId,
              type: String(row[1] || '').trim(),
              origin: String(row[2] || '').trim(),
              destination: String(row[3] || '').trim(),
              touchPoints: touchPoint ? [touchPoint] : [],
              vehicleSize: normalizeVehicleSize(String(row[5] || '')),
              requirementDate: row[6],
              price: parsePrice(row[7]),
            }
          } else if (current && touchPoint) {
            // Continuation row — additional touch point
            current.touchPoints.push(touchPoint)
          }
        }
        // Push last group
        if (current) grouped.push(current)

        // Convert to bid objects
        const bids = grouped.map(g => ({
          requestId: g.requestId,
          client: 'Shadowfax',
          origin: g.origin,
          destination: g.destination,
          touchPoints: g.touchPoints,
          vehicleSize: g.vehicleSize,
          tat: null,
          placementTime: excelSerialToISO(g.requirementDate),
          bidDeadline: '',
          status: 'won',
          bidAmount: g.price,
          allocationPrice: g.price,
          skipReason: null,
          requestDate: excelSerialToISO(g.requirementDate),
        }))

        resolve(bids)
      } catch (err) {
        reject(new Error('Failed to parse Excel file: ' + err.message))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}
