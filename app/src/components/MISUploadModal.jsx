import { useState } from 'react'
import { collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { parseSfxExcel } from '../lib/sfxMisParser'
import { useAuth } from '../contexts/AuthContext'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const YEARS = ['2024', '2025', '2026', '2027']

export default function MISUploadModal({ onClose, onImported, existingImports = [] }) {
  const { user } = useAuth()
  const [file, setFile] = useState(null)
  const [parseResult, setParseResult] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState(null)

  // Period selection
  const now = new Date()
  const [periodMonth, setPeriodMonth] = useState(now.getMonth()) // 0-indexed for display
  const [periodYear, setPeriodYear] = useState(String(now.getFullYear()))

  // Provision fields
  const [provisionAmount, setProvisionAmount] = useState('')
  const [provisionNotes, setProvisionNotes] = useState('')

  // Duplicate detection
  const isDuplicate = existingImports.some(
    (imp) => imp.period_month === periodMonth + 1 && imp.period_year === parseInt(periodYear)
  )
  const duplicateImport = existingImports.find(
    (imp) => imp.period_month === periodMonth + 1 && imp.period_year === parseInt(periodYear)
  )

  // Handle file selection
  const handleFileChange = async (e) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    if (!selectedFile.name.endsWith('.xlsx') && !selectedFile.name.endsWith('.xls')) {
      setError('Please select an Excel file (.xlsx or .xls)')
      return
    }

    setFile(selectedFile)
    setError(null)
    setParsing(true)
    setParseResult(null)

    try {
      const result = await parseSfxExcel(selectedFile)

      if (result.trips.length === 0) {
        setError('No recognizable trip data found in this file. Make sure it\'s a Shadowfax MIS file.')
        setParsing(false)
        return
      }

      setParseResult(result)

      // Auto-detect period from date range if available
      if (result.summary.dateRange.from) {
        const [year, month] = result.summary.dateRange.from.split('-')
        setPeriodMonth(parseInt(month) - 1)
        setPeriodYear(year)
      }
    } catch (err) {
      setError('Failed to parse file: ' + err.message)
    } finally {
      setParsing(false)
    }
  }

  // Format currency
  const formatCurrency = (amount) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount)

  // Handle import
  const handleImport = async () => {
    if (!parseResult || parseResult.trips.length === 0) return

    setImporting(true)
    setError(null)

    try {
      const importDocRef = doc(collection(db, 'mis_imports'))
      const importData = {
        filename: file.name,
        client: 'shadowfax',
        formats: parseResult.summary.formats,
        period_month: periodMonth + 1, // 1-indexed
        period_year: parseInt(periodYear),
        period_label: `${MONTHS[periodMonth]} ${periodYear}`,
        trip_count: parseResult.trips.length,
        total_amount: parseResult.summary.totalAmount,
        invoice_status: 'pending',
        invoice_number: null,
        provision_amount: provisionAmount ? parseFloat(provisionAmount) : null,
        provision_notes: provisionNotes.trim() || '',
        imported_at: serverTimestamp(),
        imported_by: user.email,
      }

      // Chunked batch writes — Firestore limit is 500 ops per batch
      const BATCH_SIZE = 499
      const trips = parseResult.trips

      for (let i = 0; i < trips.length; i += BATCH_SIZE) {
        const batch = writeBatch(db)

        // Include import doc in first batch
        if (i === 0) {
          batch.set(importDocRef, importData)
        }

        const chunk = trips.slice(i, i + BATCH_SIZE)
        for (const trip of chunk) {
          const tripDocRef = doc(collection(db, 'mis_trips'))
          batch.set(tripDocRef, {
            ...trip,
            import_id: importDocRef.id,
            client: 'shadowfax',
            imported_at: serverTimestamp(),
            imported_by: user.email,
          })
        }

        await batch.commit()
      }

      onImported?.()
      onClose()
    } catch (err) {
      console.error('Import failed:', err)
      setError('Failed to import: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl max-w-lg mx-4 w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Import Shadowfax MIS</h3>
          <button
            onClick={onClose}
            disabled={importing}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* File picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Excel File</label>
            <label className="flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-300 border-dashed rounded-lg hover:bg-gray-100 cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              <span className="text-sm text-gray-600">
                {file ? file.name : 'Choose .xlsx file...'}
              </span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                disabled={importing}
                className="hidden"
              />
            </label>
          </div>

          {/* Parsing indicator */}
          {parsing && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
              Parsing file...
            </div>
          )}

          {/* Period selection */}
          {parseResult && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Period</label>
                <div className="flex gap-2">
                  <select
                    value={periodMonth}
                    onChange={(e) => setPeriodMonth(parseInt(e.target.value))}
                    disabled={importing}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {MONTHS.map((m, i) => (
                      <option key={i} value={i}>{m}</option>
                    ))}
                  </select>
                  <select
                    value={periodYear}
                    onChange={(e) => setPeriodYear(e.target.value)}
                    disabled={importing}
                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {YEARS.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Duplicate warning */}
              {isDuplicate && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
                  <span className="font-medium">Warning:</span> You already imported{' '}
                  <span className="font-medium">{duplicateImport?.trip_count} trips</span> for{' '}
                  {MONTHS[periodMonth]} {periodYear} ({duplicateImport?.filename}). Import anyway?
                </div>
              )}

              {/* Preview */}
              <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Preview</p>
                <div className="space-y-1">
                  {parseResult.sheets.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">
                        Sheet "{s.name}" —{' '}
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                          s.format === 'regular' ? 'bg-blue-100 text-blue-700' :
                          s.format === 'adhoc' ? 'bg-amber-100 text-amber-700' :
                          s.format === 'km_reading' ? 'bg-green-100 text-green-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {s.format === 'km_reading' ? 'KM Reading' : s.format}
                        </span>
                      </span>
                      <span className="text-gray-900 font-medium">{s.rowCount} rows</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">
                    Total: {parseResult.summary.totalTrips} rows
                  </span>
                  <span className="text-sm font-medium text-gray-900">
                    {formatCurrency(parseResult.summary.totalAmount)}
                  </span>
                </div>
                {parseResult.summary.dateRange.from && (
                  <p className="mt-1 text-xs text-gray-500">
                    Date range: {parseResult.summary.dateRange.from} → {parseResult.summary.dateRange.to}
                  </p>
                )}
              </div>

              {/* Provision fields */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Provision Estimate <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                    <input
                      type="number"
                      value={provisionAmount}
                      onChange={(e) => setProvisionAmount(e.target.value)}
                      disabled={importing}
                      placeholder="Estimated amount"
                      className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
                <input
                  type="text"
                  value={provisionNotes}
                  onChange={(e) => setProvisionNotes(e.target.value)}
                  disabled={importing}
                  placeholder="Notes (e.g., submitted to Zubair on 3rd)"
                  className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <button
            onClick={onClose}
            disabled={importing}
            className="px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!parseResult || parseResult.trips.length === 0 || importing}
            className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm disabled:opacity-50"
          >
            {importing
              ? 'Importing...'
              : parseResult
                ? `Import ${parseResult.summary.totalTrips} rows`
                : 'Import'
            }
          </button>
        </div>
      </div>
    </div>
  )
}
