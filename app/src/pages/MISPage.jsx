import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, doc, deleteDoc, updateDoc, query, where, writeBatch } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import MISUploadModal from '../components/MISUploadModal'

const BATCH_SIZE = 499

export default function MISPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  // Data state
  const [imports, setImports] = useState([])
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // UI state
  const [showUpload, setShowUpload] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [editingInvoice, setEditingInvoice] = useState(null) // import id being edited
  const [invoiceNumberInput, setInvoiceNumberInput] = useState('')

  // Filters
  const [formatFilter, setFormatFilter] = useState('all')
  const [importFilter, setImportFilter] = useState('all')
  const [vehicleFilter, setVehicleFilter] = useState('all')
  const [originFilter, setOriginFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Load data
  const loadData = async () => {
    try {
      setError(null)
      const [importsSnap, tripsSnap] = await Promise.all([
        getDocs(collection(db, 'mis_imports')),
        getDocs(collection(db, 'mis_trips')),
      ])

      const importsList = []
      importsSnap.forEach((d) => importsList.push({ id: d.id, ...d.data() }))
      importsList.sort((a, b) => {
        if (a.period_year !== b.period_year) return b.period_year - a.period_year
        return b.period_month - a.period_month
      })

      const tripsList = []
      tripsSnap.forEach((d) => tripsList.push({ id: d.id, ...d.data() }))
      tripsList.sort((a, b) => (b.date || '').localeCompare(a.date || ''))

      setImports(importsList)
      setTrips(tripsList)
    } catch (err) {
      console.error('Failed to load MIS data:', err)
      setError('Failed to load data: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  // ── Derived data ──────────────────────────────────────────────────────

  const vehicles = useMemo(() => {
    const set = new Set()
    trips.forEach((t) => { if (t.vehicle_no) set.add(t.vehicle_no) })
    return [...set].sort()
  }, [trips])

  const origins = useMemo(() => {
    const set = new Set()
    trips.forEach((t) => { if (t.origin) set.add(t.origin) })
    return [...set].sort()
  }, [trips])

  const filteredTrips = useMemo(() => {
    return trips.filter((t) => {
      if (formatFilter !== 'all' && t.format !== formatFilter) return false
      if (importFilter !== 'all' && t.import_id !== importFilter) return false
      if (vehicleFilter !== 'all' && t.vehicle_no !== vehicleFilter) return false
      if (originFilter !== 'all' && t.origin !== originFilter) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const searchFields = [
          t.trip_id, t.request_id, t.vehicle_no, t.vehicle_code,
          t.origin, t.destination, t.lane, t.invoice_no,
        ].filter(Boolean).map(s => s.toLowerCase())
        if (!searchFields.some(f => f.includes(q))) return false
      }
      return true
    })
  }, [trips, formatFilter, importFilter, vehicleFilter, originFilter, searchQuery])

  // Summary stats
  const stats = useMemo(() => {
    let totalAmount = 0
    const vehicleSet = new Set()
    filteredTrips.forEach((t) => {
      totalAmount += t.total_amount || t.cost || 0
      if (t.vehicle_no) vehicleSet.add(t.vehicle_no)
    })
    return {
      imports: imports.length,
      trips: filteredTrips.length,
      amount: totalAmount,
      vehicles: vehicleSet.size,
    }
  }, [imports, filteredTrips])

  // ── Formatting helpers ────────────────────────────────────────────────

  const formatCurrency = (amount) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount)

  const formatDate = (dateStr) => {
    if (!dateStr) return '—'
    // Handle Firestore Timestamp objects
    if (dateStr?.toDate) {
      const d = dateStr.toDate()
      return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
    }
    // Handle JS Date objects
    if (dateStr instanceof Date) {
      return `${dateStr.getDate()}/${dateStr.getMonth() + 1}/${dateStr.getFullYear()}`
    }
    const str = String(dateStr)
    const parts = str.split('-')
    if (parts.length === 3 && parts[0].length === 4) return `${parts[2]}/${parts[1]}/${parts[0]}`
    return str
  }

  const formatTimestamp = (ts) => {
    if (!ts?.toDate) return '—'
    const d = ts.toDate()
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
  }

  // ── Invoice status cycling ────────────────────────────────────────────

  const statusCycle = ['pending', 'generated', 'submitted']

  const handleStatusClick = async (imp, e) => {
    e.stopPropagation()
    const currentIdx = statusCycle.indexOf(imp.invoice_status || 'pending')
    const nextStatus = statusCycle[(currentIdx + 1) % statusCycle.length]

    // If cycling to "generated", open invoice number input
    if (nextStatus === 'generated') {
      setEditingInvoice(imp.id)
      setInvoiceNumberInput(imp.invoice_number || '')
      // Still update status
      try {
        await updateDoc(doc(db, 'mis_imports', imp.id), { invoice_status: nextStatus })
        setImports(prev => prev.map(i =>
          i.id === imp.id ? { ...i, invoice_status: nextStatus } : i
        ))
      } catch (err) {
        console.error('Failed to update status:', err)
      }
      return
    }

    try {
      const updates = { invoice_status: nextStatus }
      if (nextStatus === 'pending') {
        updates.invoice_number = null
      }
      await updateDoc(doc(db, 'mis_imports', imp.id), updates)
      setImports(prev => prev.map(i =>
        i.id === imp.id ? { ...i, ...updates } : i
      ))
    } catch (err) {
      console.error('Failed to update status:', err)
    }
  }

  const handleInvoiceNumberSave = async (impId) => {
    try {
      await updateDoc(doc(db, 'mis_imports', impId), {
        invoice_number: invoiceNumberInput.trim() || null,
      })
      setImports(prev => prev.map(i =>
        i.id === impId ? { ...i, invoice_number: invoiceNumberInput.trim() || null } : i
      ))
      setEditingInvoice(null)
    } catch (err) {
      console.error('Failed to save invoice number:', err)
    }
  }

  // ── Delete import ─────────────────────────────────────────────────────

  const handleDelete = async (imp) => {
    setDeleting(true)
    try {
      // Find all trips for this import
      const tripsQuery = query(
        collection(db, 'mis_trips'),
        where('import_id', '==', imp.id)
      )
      const tripsSnap = await getDocs(tripsQuery)

      // Chunked batch delete
      const tripDocs = []
      tripsSnap.forEach((d) => tripDocs.push(d.ref))

      for (let i = 0; i < tripDocs.length; i += BATCH_SIZE) {
        const batch = writeBatch(db)
        tripDocs.slice(i, i + BATCH_SIZE).forEach((ref) => batch.delete(ref))
        await batch.commit()
      }

      // Delete the import doc
      await deleteDoc(doc(db, 'mis_imports', imp.id))

      // Update local state
      setImports(prev => prev.filter(i => i.id !== imp.id))
      setTrips(prev => prev.filter(t => t.import_id !== imp.id))
      setDeleteConfirm(null)
    } catch (err) {
      console.error('Failed to delete import:', err)
      setError('Failed to delete: ' + err.message)
    } finally {
      setDeleting(false)
    }
  }

  // ── Status badge component ────────────────────────────────────────────

  const StatusBadge = ({ status }) => {
    const styles = {
      pending: 'bg-yellow-100 text-yellow-800',
      generated: 'bg-green-100 text-green-800',
      submitted: 'bg-blue-100 text-blue-800',
    }
    return (
      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
        {status || 'pending'}
      </span>
    )
  }

  const FormatBadge = ({ format }) => {
    const styles = {
      regular: 'bg-blue-100 text-blue-700',
      adhoc: 'bg-amber-100 text-amber-700',
      km_reading: 'bg-green-100 text-green-700',
    }
    const labels = {
      regular: 'Regular',
      adhoc: 'Adhoc',
      km_reading: 'KM Reading',
    }
    return (
      <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${styles[format] || 'bg-gray-100 text-gray-600'}`}>
        {labels[format] || format}
      </span>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-3">
        <div className="w-8 h-8 border-3 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
        <p className="text-gray-500 text-sm">Loading MIS data...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Upload Modal */}
      {showUpload && (
        <MISUploadModal
          onClose={() => setShowUpload(false)}
          onImported={() => {
            setShowUpload(false)
            setLoading(true)
            loadData()
          }}
          existingImports={imports}
        />
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4 w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Import</h3>
            <p className="text-sm text-gray-600 mb-1">
              Delete <span className="font-medium">{deleteConfirm.filename}</span>?
            </p>
            <p className="text-sm text-gray-600 mb-1">
              This will remove <span className="font-medium">{deleteConfirm.trip_count} trip records</span> for{' '}
              {deleteConfirm.period_label}.
            </p>
            <p className="text-xs text-red-500 mb-4">This action cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-sm disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700">
              &larr; Dashboard
            </button>
            <h1 className="text-xl font-bold text-gray-900">MIS Dashboard</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500 hidden sm:inline">{user.email}</span>
            <button onClick={logout} className="text-sm text-red-600 hover:text-red-800 font-medium">
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Action Bar */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900">Shadowfax MIS</h2>
          <button
            onClick={() => setShowUpload(true)}
            className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
          >
            + Import MIS
          </button>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Imports</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{stats.imports}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Total Rows</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{stats.trips}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Total Billing</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(stats.amount)}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Vehicles</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{stats.vehicles}</p>
          </div>
        </div>

        {/* Import History */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Import History</h3>
          </div>
          {imports.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500">
              <p className="mb-1">No MIS data imported yet.</p>
              <p className="text-sm">Click "Import MIS" to upload a Shadowfax Excel file.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-left">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Period</th>
                    <th className="px-4 py-2.5 font-medium hidden sm:table-cell">File</th>
                    <th className="px-4 py-2.5 font-medium">Formats</th>
                    <th className="px-4 py-2.5 font-medium text-right">Rows</th>
                    <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                    <th className="px-4 py-2.5 font-medium">Invoice</th>
                    <th className="px-4 py-2.5 font-medium hidden lg:table-cell">Provision</th>
                    <th className="px-4 py-2.5 font-medium hidden sm:table-cell">Imported</th>
                    <th className="px-4 py-2.5 font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {imports.map((imp) => (
                    <tr key={imp.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                        {imp.period_label}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell text-xs max-w-[160px] truncate" title={imp.filename}>
                        {imp.filename}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {(imp.formats || []).map((f, i) => (
                            <FormatBadge key={i} format={f} />
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-900 text-right">{imp.trip_count}</td>
                      <td className="px-4 py-3 text-gray-900 text-right whitespace-nowrap">
                        {formatCurrency(imp.total_amount || 0)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={(e) => handleStatusClick(imp, e)}
                            title="Click to cycle status"
                          >
                            <StatusBadge status={imp.invoice_status} />
                          </button>
                          {/* Invoice number edit */}
                          {editingInvoice === imp.id ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={invoiceNumberInput}
                                onChange={(e) => setInvoiceNumberInput(e.target.value)}
                                placeholder="RS/047/25-26"
                                className="w-28 px-1.5 py-0.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleInvoiceNumberSave(imp.id)
                                  if (e.key === 'Escape') setEditingInvoice(null)
                                }}
                                autoFocus
                              />
                              <button
                                onClick={() => handleInvoiceNumberSave(imp.id)}
                                className="text-green-600 hover:text-green-800 text-xs font-medium"
                              >
                                ✓
                              </button>
                            </div>
                          ) : imp.invoice_number ? (
                            <button
                              onClick={() => {
                                setEditingInvoice(imp.id)
                                setInvoiceNumberInput(imp.invoice_number || '')
                              }}
                              className="text-xs text-gray-500 hover:text-blue-600"
                            >
                              {imp.invoice_number}
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden lg:table-cell text-xs">
                        {imp.provision_amount ? formatCurrency(imp.provision_amount) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell text-xs whitespace-nowrap">
                        {formatTimestamp(imp.imported_at)}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setDeleteConfirm(imp)}
                          className="text-gray-400 hover:text-red-600 transition-colors p-1"
                          title="Delete import"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Filters */}
        {trips.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <select
                value={formatFilter}
                onChange={(e) => setFormatFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Formats</option>
                <option value="regular">Regular</option>
                <option value="adhoc">Adhoc</option>
                <option value="km_reading">KM Reading</option>
              </select>

              <select
                value={importFilter}
                onChange={(e) => setImportFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Imports</option>
                {imports.map((imp) => (
                  <option key={imp.id} value={imp.id}>{imp.period_label}</option>
                ))}
              </select>

              <select
                value={vehicleFilter}
                onChange={(e) => setVehicleFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Vehicles</option>
                {vehicles.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>

              <select
                value={originFilter}
                onChange={(e) => setOriginFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Origins</option>
                {origins.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>

              <input
                type="text"
                placeholder="Search trip ID, vehicle..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        )}

        {/* Results count */}
        {trips.length > 0 && (
          <p className="text-sm text-gray-500 mb-3">
            {filteredTrips.length} row{filteredTrips.length !== 1 ? 's' : ''}
            {formatFilter !== 'all' && ` (${formatFilter})`}
          </p>
        )}

        {/* Trips Table */}
        {trips.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {filteredTrips.length === 0 ? (
              <div className="px-6 py-12 text-center text-gray-500">
                No rows match your filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Format</th>
                      <th className="px-4 py-3 font-medium">Trip / Vehicle ID</th>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Vehicle</th>
                      <th className="px-4 py-3 font-medium">Origin</th>
                      <th className="px-4 py-3 font-medium">Destination</th>
                      {/* Conditional columns based on format */}
                      {(formatFilter === 'all' || formatFilter === 'regular') && (
                        <>
                          <th className="px-4 py-3 font-medium text-right hidden lg:table-cell">Freight</th>
                          <th className="px-4 py-3 font-medium text-right hidden lg:table-cell">Other</th>
                          <th className="px-4 py-3 font-medium text-right hidden lg:table-cell">GST</th>
                        </>
                      )}
                      {(formatFilter === 'km_reading') && (
                        <>
                          <th className="px-4 py-3 font-medium text-right">Trips</th>
                          <th className="px-4 py-3 font-medium text-right">Total KM</th>
                          <th className="px-4 py-3 font-medium text-right">Toll</th>
                        </>
                      )}
                      <th className="px-4 py-3 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredTrips.slice(0, 500).map((t) => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <FormatBadge format={t.format} />
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                          {t.trip_id || t.request_id || t.vehicle_code || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {formatDate(t.date)}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {t.vehicle_no || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {t.origin || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {t.destination || t.via || '—'}
                        </td>
                        {/* Conditional columns */}
                        {(formatFilter === 'all' || formatFilter === 'regular') && (
                          <>
                            <td className="px-4 py-3 text-gray-500 text-right hidden lg:table-cell whitespace-nowrap">
                              {t.freight_amount ? formatCurrency(t.freight_amount) : '—'}
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-right hidden lg:table-cell whitespace-nowrap">
                              {t.other_charges ? formatCurrency(t.other_charges) : '—'}
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-right hidden lg:table-cell whitespace-nowrap">
                              {t.gst ? formatCurrency(t.gst) : '—'}
                            </td>
                          </>
                        )}
                        {(formatFilter === 'km_reading') && (
                          <>
                            <td className="px-4 py-3 text-gray-900 text-right">
                              {t.trip_count || '—'}
                            </td>
                            <td className="px-4 py-3 text-gray-900 text-right">
                              {t.total_travel_km ? `${t.total_travel_km} km` : '—'}
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-right whitespace-nowrap">
                              {t.toll_charges ? formatCurrency(t.toll_charges) : '—'}
                            </td>
                          </>
                        )}
                        <td className="px-4 py-3 text-gray-900 font-medium text-right whitespace-nowrap">
                          {formatCurrency(t.total_amount || t.cost || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredTrips.length > 500 && (
                  <div className="px-4 py-3 text-center text-sm text-gray-500 bg-gray-50 border-t border-gray-200">
                    Showing first 500 of {filteredTrips.length} rows. Use filters to narrow results.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
