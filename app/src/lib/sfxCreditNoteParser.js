import * as XLSX from 'xlsx'
import { parseExcelDate, normalizeVehicleNo, normalizeVehicleType, normalizeLocation } from './sfxTripDetailsParser'

/**
 * Shadowfax Credit Note Summary Parser
 * Handles 3 format variants:
 *   1. Simple (25 cols): Vendor, Invoice number, Vehicle No., ...
 *   2. Detailed (27 cols): S.No., Email Address, Transporter Name, Invoice no, ...
 *   3. Ranchi (27 cols): Same as #2 but "LH Remark" instead of "Vendor Remarks"
 *
 * Key fields extracted:
 *   Trip ID (contains SFEC* for Adhoc, TRP* for Regular)
 *   Freight Amount (OTD's billed amount)
 *   SFX Final Amount (Shadowfax's approved amount)
 *   DIFF (credit note amount per trip)
 */

// ── Column name normalization map ───────────────────────────────────────
// Maps various column header spellings to our standard field names
const COLUMN_MAP = {
  // Identifiers
  's.no.': 'sno',
  'email address': 'email',
  'transporter name': 'transporter_name',
  'vendor': 'vendor',
  'invoice number': 'invoice_no',
  'invoice no': 'invoice_no',
  'vehicle no.': 'vehicle_no',
  'vehicle no': 'vehicle_no',
  'veh. type': 'vehicle_type',
  'veh type': 'vehicle_type',

  // Trip details
  'origin': 'origin',
  'destination': 'destination',
  'sector': 'sector',
  'touch points': 'touch_points',
  'touch point': 'touch_points',
  'trip id': 'trip_id',
  'dispatch date': 'dispatch_date',

  // OTD's billed amounts
  'freight amount': 'freight_amount',
  'other charges/fsc': 'other_charges',
  'other charges': 'other_charges',
  'net base amount': 'net_base_amount',
  'net  base amount': 'net_base_amount', // extra space variant
  'gst': 'gst',
  'total invoice amount': 'total_invoice_amount',

  // Classification
  'requirement type': 'requirement_type',
  'line haul type': 'line_haul_type',

  // Shadowfax's approved amounts
  'sfx freight amount': 'sfx_freight_amount',
  'sfx  freight amount': 'sfx_freight_amount', // extra space
  'other charges/fuel surcharge': 'sfx_other_charges',
  'sfx final freight amount': 'sfx_final_freight_amount',
  'sfx final amount': 'sfx_final_amount',

  // Difference & remarks
  'diff': 'diff',
  'remark': 'remark',
  'vendor remarks': 'vendor_remarks',
  'lh remark': 'vendor_remarks', // Ranchi variant
  'lh remark ': 'vendor_remarks', // trailing space variant
}

function findHeaderRow(rows) {
  // Look for the row containing "Trip ID" or "Freight Amount" — that's the header
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const rowStr = rows[i].map(c => String(c).trim().toLowerCase()).join('|')
    if (rowStr.includes('trip id') && (rowStr.includes('freight') || rowStr.includes('vehicle'))) {
      return i
    }
  }
  return 0 // default to first row
}

function mapHeaders(headerRow) {
  const mapping = {}
  for (let i = 0; i < headerRow.length; i++) {
    const raw = String(headerRow[i]).trim()
    const key = raw.toLowerCase().replace(/\s+/g, ' ')
    const field = COLUMN_MAP[key]
    if (field) {
      // Handle duplicate GST columns — first is OTD's GST, second is SFX's GST
      if (field === 'gst' && mapping['gst'] !== undefined) {
        mapping['sfx_gst'] = i
      } else {
        mapping[field] = i
      }
    }
  }
  return mapping
}

function parseGST(val) {
  if (!val && val !== 0) return 0
  const s = String(val).trim()
  // "18%" → 0.18
  if (s.endsWith('%')) {
    return parseFloat(s.replace('%', '')) / 100
  }
  return parseFloat(s) || 0
}

// ── Main parser ─────────────────────────────────────────────────────────
export function parseCreditNoteExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })

        // Find the right sheet — look for one with trip data, skip summary-only sheets
        let targetSheet = null
        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName]
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
          const rowStr = rows.map(r => r.map(c => String(c).toLowerCase()).join('|')).join('||')
          if (rowStr.includes('trip id') && rowStr.includes('freight')) {
            targetSheet = { ws, rows, sheetName }
            break
          }
        }

        if (!targetSheet) {
          reject(new Error('No Credit Note data sheet found. Expected columns like "Trip ID", "Freight Amount".'))
          return
        }

        const { rows } = targetSheet
        const headerIdx = findHeaderRow(rows)
        const headerRow = rows[headerIdx]
        const colMap = mapHeaders(headerRow)

        if (!colMap.trip_id) {
          reject(new Error('Could not find "Trip ID" column in the Credit Note.'))
          return
        }

        const trips = []
        let totalFreight = 0
        let totalSfxFinal = 0
        let totalDiff = 0

        for (let i = headerIdx + 1; i < rows.length; i++) {
          const row = rows[i]
          const tripId = String(row[colMap.trip_id] || '').trim()

          // Skip empty rows and summary rows (Grand Total, etc.)
          if (!tripId) continue
          if (tripId.toLowerCase().includes('total') || tripId.toLowerCase().includes('grand')) continue
          // Valid trip IDs start with SFEC or TRP
          if (!tripId.startsWith('SFEC') && !tripId.startsWith('TRP')) continue

          const freightAmount = parseFloat(row[colMap.freight_amount]) || 0
          const netBaseAmount = parseFloat(row[colMap.net_base_amount]) || 0
          const gst = parseGST(row[colMap.gst])
          const totalInvoiceAmount = parseFloat(row[colMap.total_invoice_amount]) || 0
          const sfxFreightAmount = parseFloat(row[colMap.sfx_freight_amount]) || 0
          const sfxFinalFreightAmount = parseFloat(row[colMap.sfx_final_freight_amount]) || 0
          const sfxFinalAmount = parseFloat(row[colMap.sfx_final_amount]) || 0
          const diff = parseFloat(row[colMap.diff]) || 0

          totalFreight += freightAmount
          totalSfxFinal += sfxFinalAmount
          totalDiff += diff

          trips.push({
            cn_tripId: tripId,
            cn_invoiceNo: colMap.invoice_no !== undefined ? String(row[colMap.invoice_no] || '').trim() : null,
            cn_vehicleNo: colMap.vehicle_no !== undefined ? normalizeVehicleNo(row[colMap.vehicle_no]) : null,
            cn_vehicleType: colMap.vehicle_type !== undefined ? normalizeVehicleType(row[colMap.vehicle_type]) : null,
            cn_origin: colMap.origin !== undefined ? normalizeLocation(row[colMap.origin]) : null,
            cn_destination: colMap.destination !== undefined ? normalizeLocation(row[colMap.destination]) : null,
            cn_sector: colMap.sector !== undefined ? String(row[colMap.sector] || '').trim() : null,
            cn_touchPoints: colMap.touch_points !== undefined ? String(row[colMap.touch_points] || '').trim() : null,
            cn_dispatchDate: colMap.dispatch_date !== undefined ? parseExcelDate(row[colMap.dispatch_date]) : null,
            cn_freightAmount: freightAmount,
            cn_otherCharges: colMap.other_charges !== undefined ? (parseFloat(row[colMap.other_charges]) || 0) : 0,
            cn_netBaseAmount: netBaseAmount,
            cn_gstRate: gst,
            cn_totalInvoiceAmount: totalInvoiceAmount,
            cn_requirementType: colMap.requirement_type !== undefined ? String(row[colMap.requirement_type] || '').trim().toUpperCase() : null,
            cn_lineHaulType: colMap.line_haul_type !== undefined ? String(row[colMap.line_haul_type] || '').trim() : null,
            cn_sfxFreightAmount: sfxFreightAmount,
            cn_sfxFinalFreightAmount: sfxFinalFreightAmount,
            cn_sfxFinalAmount: sfxFinalAmount,
            cn_diff: diff,
            cn_remark: colMap.remark !== undefined ? String(row[colMap.remark] || '').trim() : null,
            cn_vendorRemarks: colMap.vendor_remarks !== undefined ? String(row[colMap.vendor_remarks] || '').trim() : null,
          })
        }

        if (trips.length === 0) {
          reject(new Error('No valid trip records found in the Credit Note.'))
          return
        }

        resolve({
          trips,
          summary: {
            totalTrips: trips.length,
            totalFreightAmount: totalFreight,
            totalSfxFinalAmount: totalSfxFinal,
            totalDiff: totalDiff,
          },
        })
      } catch (err) {
        reject(new Error('Failed to parse Credit Note Excel: ' + err.message))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}
