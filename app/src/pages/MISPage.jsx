import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, doc, deleteDoc, addDoc, updateDoc, query, where, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/useAuth'
import { parseTripDetailsExcel } from '../lib/sfxTripDetailsParser'
import { parseCreditNoteExcel } from '../lib/sfxCreditNoteParser'
import { reconcile, mergeCreditNoteData } from '../lib/misReconciler'

const BATCH_SIZE = 450
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const displayMonth = (ym) => {
  if (!ym) return ''
  const [y, m] = ym.split('-').map(Number)
  return `${SHORT_MONTHS[m - 1]} ${y}`
}

const formatCurrency = (amount) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0)

const formatDate = (dateStr) => {
  if (!dateStr) return '—'
  if (dateStr?.toDate) {
    const d = dateStr.toDate()
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
  }
  const str = String(dateStr)
  const parts = str.split('-')
  if (parts.length === 3 && parts[0].length === 4) return `${parts[2]}/${parts[1]}/${parts[0]}`
  return str
}

// ── Status badge ────────────────────────────────────────────────────────
function MatchBadge({ status }) {
  const map = {
    matched: { bg: 'bg-green-100 text-green-800', label: 'Matched' },
    amount_mismatch: { bg: 'bg-amber-100 text-amber-800', label: 'Amt Mismatch' },
    unmatched: { bg: 'bg-red-100 text-red-800', label: 'Missing in OTD' },
    disputed: { bg: 'bg-purple-100 text-purple-800', label: 'Disputed' },
  }
  const s = map[status] || { bg: 'bg-gray-100 text-gray-600', label: status || '—' }
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${s.bg}`}>{s.label}</span>
}

function TypeBadge({ type }) {
  const isAdhoc = type === 'adhoc'
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${isAdhoc ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
      {isAdhoc ? 'Adhoc' : 'Regular'}
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════════════
export default function MISPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  // ── Core data ──
  const [misImports, setMisImports] = useState([])
  const [misTrips, setMisTrips] = useState([])
  const [otdTrips, setOtdTrips] = useState([]) // from trips collection (Shadowfax)
  const [bids, setBids] = useState([])          // from bids collection
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  // ── UI state ──
  const [activeTab, setActiveTab] = useState('import') // import | reconciliation | disputes | regular_trips

  // Regular Trips (lane contracts)
  const [regularTrips, setRegularTrips] = useState([])
  const [editingRegular, setEditingRegular] = useState(null) // null = list, 'new' = add, doc = edit
  const [regularForm, setRegularForm] = useState({ lane: '', vehicleNo: '', vehicleType: 'Bolero', cpkRate: '', allottedKms: '', startDate: '', status: 'active' })
  const [selectedMonth, setSelectedMonth] = useState(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`)

  // Import state
  const [tripFile, setTripFile] = useState(null)
  const [cnFile, setCnFile] = useState(null)
  const [tripParseResult, setTripParseResult] = useState(null)
  const [cnParseResult, setCnParseResult] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Reconciliation state
  const [reconciling, setReconciling] = useState(false)
  const [reconStats, setReconStats] = useState(null)
  const [missingFromMis, setMissingFromMis] = useState([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [tripTypeFilter, setTripTypeFilter] = useState('all') // all | adhoc | regular

  // Dispute editing
  const [editingDispute, setEditingDispute] = useState(null)
  const [disputeNotes, setDisputeNotes] = useState('')

  // ── Load all data ──
  const loadData = useCallback(async () => {
    try {
      setError(null)
      const [misImportsSnap, misTripsSnap, otdTripsSnap, bidsSnap, regularTripsSnap] = await Promise.all([
        getDocs(collection(db, 'mis_imports')),
        getDocs(collection(db, 'mis_trips')),
        getDocs(collection(db, 'trips')),
        getDocs(collection(db, 'bids')),
        getDocs(collection(db, 'regular_trips')),
      ])

      const importsList = []
      misImportsSnap.forEach(d => importsList.push({ id: d.id, ...d.data() }))
      importsList.sort((a, b) => (b.month || '').localeCompare(a.month || ''))

      const tripsList = []
      misTripsSnap.forEach(d => tripsList.push({ id: d.id, ...d.data() }))

      const otdList = []
      otdTripsSnap.forEach(d => {
        const data = d.data()
        // Only Shadowfax trips
        if (data.client_name?.toLowerCase().includes('shadowfax') || data.client_id?.toLowerCase().includes('shadowfax')) {
          otdList.push({ id: d.id, ...data })
        }
      })

      const bidsList = []
      bidsSnap.forEach(d => bidsList.push({ id: d.id, ...d.data() }))

      const regularList = []
      regularTripsSnap.forEach(d => regularList.push({ id: d.id, ...d.data() }))

      setMisImports(importsList)
      setMisTrips(tripsList)
      setOtdTrips(otdList)
      setBids(bidsList)
      setRegularTrips(regularList)
    } catch (err) {
      console.error('Failed to load MIS data:', err)
      setError('Failed to load data: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Derived: trips for selected month ──
  const monthTrips = useMemo(() => {
    return misTrips.filter(t => t.month === selectedMonth)
  }, [misTrips, selectedMonth])

  const monthImport = useMemo(() => {
    return misImports.find(i => i.month === selectedMonth)
  }, [misImports, selectedMonth])

  // Available months (from imports)
  const availableMonths = useMemo(() => {
    const set = new Set(misImports.map(i => i.month).filter(Boolean))
    return [...set].sort().reverse()
  }, [misImports])

  // Filtered trips for reconciliation view
  const filteredReconTrips = useMemo(() => {
    let filtered = monthTrips
    if (statusFilter !== 'all') filtered = filtered.filter(t => t.matchStatus === statusFilter)
    if (tripTypeFilter !== 'all') filtered = filtered.filter(t => t.tripType === tripTypeFilter)
    return filtered
  }, [monthTrips, statusFilter, tripTypeFilter])

  // Dispute trips
  const disputeTrips = useMemo(() => {
    return misTrips.filter(t => t.matchStatus === 'disputed' || t.matchStatus === 'amount_mismatch')
  }, [misTrips])

  // ══════════════════════════════════════════════════════════════════════
  // IMPORT TAB HANDLERS
  // ══════════════════════════════════════════════════════════════════════

  const handleTripFileChange = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setTripFile(f)
    setParsing(true)
    setError(null)
    setTripParseResult(null)
    try {
      const result = await parseTripDetailsExcel(f)
      setTripParseResult(result)
      // Auto-detect month from parsed trip dates
      const allTrips = [...(result.adhocTrips || []), ...(result.regularTrips || [])]
      const dates = allTrips.map(t => t.sfx_date).filter(Boolean)
      if (dates.length > 0) {
        // Find most common YYYY-MM
        const monthCounts = {}
        dates.forEach(d => {
          const ym = d.substring(0, 7)
          monthCounts[ym] = (monthCounts[ym] || 0) + 1
        })
        const detectedMonth = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0][0]
        setSelectedMonth(detectedMonth)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setParsing(false)
    }
  }

  const handleCnFileChange = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setCnFile(f)
    setParsing(true)
    setError(null)
    setCnParseResult(null)
    try {
      const result = await parseCreditNoteExcel(f)
      setCnParseResult(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setParsing(false)
    }
  }

  const handleImport = async () => {
    if (!tripParseResult) {
      setError('Please upload a Trip Details file first.')
      return
    }
    setImporting(true)
    setError(null)
    try {
      const [year, month] = selectedMonth.split('-').map(Number)
      const periodLabel = `${MONTHS[month - 1]} ${year}`

      // Check for existing import for this month
      const existing = misImports.find(i => i.month === selectedMonth)
      if (existing) {
        // Delete old data first
        const oldTripsQuery = query(collection(db, 'mis_trips'), where('month', '==', selectedMonth))
        const oldSnap = await getDocs(oldTripsQuery)
        const oldRefs = []
        oldSnap.forEach(d => oldRefs.push(d.ref))
        for (let i = 0; i < oldRefs.length; i += BATCH_SIZE) {
          const batch = writeBatch(db)
          oldRefs.slice(i, i + BATCH_SIZE).forEach(r => batch.delete(r))
          await batch.commit()
        }
        await deleteDoc(doc(db, 'mis_imports', existing.id))
      }

      // Combine all trips
      const allTrips = [
        ...tripParseResult.adhocTrips,
        ...tripParseResult.regularTrips,
      ]

      // Merge credit note data if available
      let cnSummary = null
      if (cnParseResult) {
        const mergeResult = mergeCreditNoteData(allTrips, cnParseResult.trips)
        cnSummary = {
          ...cnParseResult.summary,
          mergedCount: mergeResult.mergedCount,
          revision: 1,
          lastUpdated: new Date().toISOString(),
        }
      }

      // Create import doc
      const importData = {
        client: 'Shadowfax',
        month: selectedMonth,
        periodLabel,
        importedAt: serverTimestamp(),
        importedBy: user.email,
        adhocTrips: tripParseResult.summary.adhocCount,
        adhocTotal: tripParseResult.summary.adhocTotal,
        regularTrips: tripParseResult.summary.regularCount,
        totalTrips: allTrips.length,
        status: 'draft',
        files: {
          tripDetails: tripFile?.name || null,
          creditNote: cnFile?.name || null,
        },
      }
      if (cnSummary) {
        importData.cnSummary = cnSummary
      }

      const importRef = await addDoc(collection(db, 'mis_imports'), importData)

      // Write trips in batches
      for (let i = 0; i < allTrips.length; i += BATCH_SIZE) {
        const batch = writeBatch(db)
        allTrips.slice(i, i + BATCH_SIZE).forEach(trip => {
          const tripRef = doc(collection(db, 'mis_trips'))
          batch.set(tripRef, {
            ...trip,
            misImportId: importRef.id,
            month: selectedMonth,
            client: 'Shadowfax',
            matchStatus: null,
            otd_bidId: null,
            otd_bidAmount: null,
            otd_tripId: null,
            amountDifference: null,
            disputeReason: null,
            disputeNotes: '',
            resolvedAmount: null,
            created_at: serverTimestamp(),
          })
        })
        await batch.commit()
      }

      setSuccess(`Imported ${allTrips.length} trips (${tripParseResult.summary.adhocCount} Adhoc + ${tripParseResult.summary.regularCount} Regular)${cnSummary ? ` with Credit Note data` : ''}`)
      setTripFile(null)
      setCnFile(null)
      setTripParseResult(null)
      setCnParseResult(null)
      setLoading(true)
      await loadData()
    } catch (err) {
      setError('Import failed: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  const handleUploadCreditNote = async () => {
    if (!cnParseResult || !monthImport) return
    setImporting(true)
    setError(null)
    try {
      // Merge CN data into existing month's trips
      const monthTripsCopy = monthTrips.map(t => ({ ...t }))
      const mergeResult = mergeCreditNoteData(monthTripsCopy, cnParseResult.trips)

      // Update each merged trip in Firestore
      for (const trip of monthTripsCopy) {
        if (trip.cn_tripId) {
          const updates = {}
          for (const key of Object.keys(trip)) {
            if (key.startsWith('cn_')) updates[key] = trip[key]
          }
          if (trip.matchStatus) updates.matchStatus = trip.matchStatus
          if (trip.amountDifference !== undefined) updates.amountDifference = trip.amountDifference
          await updateDoc(doc(db, 'mis_trips', trip.id), updates)
        }
      }

      // Update import doc with CN summary
      const cnSummary = {
        ...cnParseResult.summary,
        mergedCount: mergeResult.mergedCount,
        revision: (monthImport.cnSummary?.revision || 0) + 1,
        lastUpdated: new Date().toISOString(),
      }
      await updateDoc(doc(db, 'mis_imports', monthImport.id), {
        cnSummary,
        'files.creditNote': cnFile?.name || null,
      })

      setSuccess(`Merged Credit Note data: ${mergeResult.mergedCount}/${mergeResult.totalCnTrips} trips matched`)
      setCnFile(null)
      setCnParseResult(null)
      setLoading(true)
      await loadData()
    } catch (err) {
      setError('Credit Note upload failed: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  const handleDeleteImport = async (imp) => {
    setDeleting(true)
    try {
      // Only query mis_trips if month is defined
      if (imp.month) {
        const tripsQuery = query(collection(db, 'mis_trips'), where('month', '==', imp.month))
        const snap = await getDocs(tripsQuery)
        const refs = []
        snap.forEach(d => refs.push(d.ref))
        for (let i = 0; i < refs.length; i += BATCH_SIZE) {
          const batch = writeBatch(db)
          refs.slice(i, i + BATCH_SIZE).forEach(r => batch.delete(r))
          await batch.commit()
        }
      }
      await deleteDoc(doc(db, 'mis_imports', imp.id))
      setDeleteConfirm(null)
      setLoading(true)
      await loadData()
    } catch (err) {
      setError('Delete failed: ' + err.message)
    } finally {
      setDeleting(false)
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // RECONCILIATION HANDLERS
  // ══════════════════════════════════════════════════════════════════════

  const handleReconcile = async () => {
    if (monthTrips.length === 0) {
      setError('No MIS data for selected month. Import first.')
      return
    }
    setReconciling(true)
    setError(null)
    try {
      // Get month's date range for filtering OTD trips
      const [year, month] = selectedMonth.split('-').map(Number)
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`
      const endDay = new Date(year, month, 0).getDate()
      const endDate = `${year}-${String(month).padStart(2, '0')}-${endDay}`

      const monthOtdTrips = otdTrips.filter(t => t.date >= startDate && t.date <= endDate)

      // Run reconciliation
      const tripsCopy = monthTrips.map(t => ({ ...t }))
      const result = reconcile(tripsCopy, monthOtdTrips, bids)

      setReconStats(result.stats)
      setMissingFromMis(result.missingFromMis)

      // Persist match results to Firestore
      for (const trip of result.misTrips) {
        await updateDoc(doc(db, 'mis_trips', trip.id), {
          matchStatus: trip.matchStatus,
          otd_bidId: trip.otd_bidId || null,
          otd_bidAmount: trip.otd_bidAmount || null,
          otd_tripId: trip.otd_tripId || null,
          amountDifference: trip.amountDifference || null,
          reconciledAt: serverTimestamp(),
          reconciledBy: user.email,
        })
      }

      // Update import status
      if (monthImport) {
        await updateDoc(doc(db, 'mis_imports', monthImport.id), {
          status: 'in_progress',
          reconStats: result.stats,
        })
      }

      // Refresh data
      setLoading(true)
      await loadData()
      setSuccess(`Reconciliation complete: ${result.stats.matched} matched, ${result.stats.amountMismatch} mismatches, ${result.stats.unmatched} unmatched`)
    } catch (err) {
      setError('Reconciliation failed: ' + err.message)
    } finally {
      setReconciling(false)
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // DISPUTE HANDLERS
  // ══════════════════════════════════════════════════════════════════════

  const handleMarkDisputed = async (trip) => {
    try {
      await updateDoc(doc(db, 'mis_trips', trip.id), {
        matchStatus: 'disputed',
      })
      setMisTrips(prev => prev.map(t => t.id === trip.id ? { ...t, matchStatus: 'disputed' } : t))
    } catch (err) {
      setError('Failed to mark as disputed: ' + err.message)
    }
  }

  const handleSaveDisputeNotes = async (tripId) => {
    try {
      await updateDoc(doc(db, 'mis_trips', tripId), {
        disputeNotes,
      })
      setMisTrips(prev => prev.map(t => t.id === tripId ? { ...t, disputeNotes } : t))
      setEditingDispute(null)
      setDisputeNotes('')
    } catch (err) {
      setError('Failed to save notes: ' + err.message)
    }
  }

  const handleResolveDispute = async (trip, resolvedAmount) => {
    try {
      await updateDoc(doc(db, 'mis_trips', trip.id), {
        matchStatus: 'matched',
        resolvedAmount: resolvedAmount || null,
        disputeNotes: trip.disputeNotes || '',
      })
      setMisTrips(prev => prev.map(t => t.id === trip.id ? { ...t, matchStatus: 'matched', resolvedAmount } : t))
    } catch (err) {
      setError('Failed to resolve: ' + err.message)
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════
  // REGULAR TRIPS CRUD
  const VEHICLE_TYPES = ['Bolero', 'Tata Ace', 'Tata 407', '8 ft', '10 ft', '14 ft', '17 ft', '32 ft']

  const resetRegularForm = () => {
    setRegularForm({ lane: '', vehicleNo: '', vehicleType: 'Bolero', cpkRate: '', allottedKms: '', startDate: '', status: 'active' })
    setEditingRegular(null)
  }

  const handleSaveRegular = async () => {
    if (!regularForm.lane || !regularForm.vehicleNo) {
      setError('Lane name and vehicle number are required.')
      return
    }
    try {
      const data = {
        lane: regularForm.lane.trim(),
        vehicleNo: regularForm.vehicleNo.trim().toUpperCase().replace(/\s+/g, ''),
        vehicleType: regularForm.vehicleType,
        cpkRate: parseFloat(regularForm.cpkRate) || 0,
        allottedKms: parseFloat(regularForm.allottedKms) || 0,
        startDate: regularForm.startDate || null,
        status: regularForm.status,
        client: 'Shadowfax',
        updatedAt: serverTimestamp(),
      }
      if (editingRegular && editingRegular !== 'new') {
        await updateDoc(doc(db, 'regular_trips', editingRegular.id), data)
      } else {
        data.createdAt = serverTimestamp()
        await addDoc(collection(db, 'regular_trips'), data)
      }
      resetRegularForm()
      await loadData()
      setSuccess('Regular trip saved.')
    } catch (err) {
      setError('Failed to save: ' + err.message)
    }
  }

  const handleDeleteRegular = async (id) => {
    try {
      await deleteDoc(doc(db, 'regular_trips', id))
      await loadData()
    } catch (err) {
      setError('Failed to delete: ' + err.message)
    }
  }

  const handleEditRegular = (rt) => {
    setEditingRegular(rt)
    setRegularForm({
      lane: rt.lane || '',
      vehicleNo: rt.vehicleNo || '',
      vehicleType: rt.vehicleType || 'Bolero',
      cpkRate: rt.cpkRate || '',
      allottedKms: rt.allottedKms || '',
      startDate: rt.startDate || '',
      status: rt.status || 'active',
    })
  }

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
      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4 w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Import</h3>
            <p className="text-sm text-gray-600 mb-1">
              Delete MIS data for <span className="font-medium">{deleteConfirm.periodLabel}</span>?
            </p>
            <p className="text-sm text-gray-600 mb-1">
              This will remove <span className="font-medium">{deleteConfirm.totalTrips} trip records</span>.
            </p>
            <p className="text-xs text-red-500 mb-4">This action cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium text-sm disabled:opacity-50">
                Cancel
              </button>
              <button onClick={() => handleDeleteImport(deleteConfirm)} disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-sm disabled:opacity-50">
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
            <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700">&larr; Dashboard</button>
            <h1 className="text-xl font-bold text-gray-900">MIS Reconciliation</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500 hidden sm:inline">{user.email}</span>
            <button onClick={logout} className="text-sm text-red-600 hover:text-red-800 font-medium">Sign Out</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Messages */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 ml-2">×</button>
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm flex justify-between items-center">
            <span>{success}</span>
            <button onClick={() => setSuccess(null)} className="text-green-500 hover:text-green-700 ml-2">×</button>
          </div>
        )}

        {/* Sub-tab bar */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 overflow-x-auto">
          {[
            { key: 'import', label: 'Import' },
            { key: 'reconciliation', label: 'Reconciliation' },
            { key: 'disputes', label: `Disputes (${disputeTrips.length})` },
            { key: 'regular_trips', label: `Regular Trips (${regularTrips.length})` },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 min-w-[100px] px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Month selector (shared across tabs) */}
        <div className="flex items-center gap-3 mb-6">
          <label className="text-sm font-medium text-gray-700">Month:</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {monthImport && (
            <span className="text-xs text-green-600 font-medium">✓ Data imported</span>
          )}
        </div>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* IMPORT TAB */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {activeTab === 'import' && (
          <div className="space-y-6">
            {/* Upload Trip Details */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
                1. Upload Trip Details (Muneem&apos;s Excel)
              </h3>
              <div className="flex flex-col sm:flex-row gap-3 items-start">
                <label className="flex-1 cursor-pointer">
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:border-blue-400 transition-colors">
                    <p className="text-sm text-gray-500">
                      {tripFile ? tripFile.name : 'Drop or tap to select Excel file'}
                    </p>
                    {parsing && <p className="text-xs text-blue-600 mt-1">Parsing...</p>}
                  </div>
                  <input type="file" accept=".xlsx,.xls" onChange={handleTripFileChange} className="hidden" />
                </label>
              </div>

              {tripParseResult && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                  <p className="font-medium text-blue-900">
                    Found: {tripParseResult.summary.adhocCount} Adhoc trips ({formatCurrency(tripParseResult.summary.adhocTotal)}) + {tripParseResult.summary.regularCount} Regular trips
                  </p>
                </div>
              )}
            </div>

            {/* Import button */}
            {tripParseResult && (
              <button
                onClick={handleImport}
                disabled={importing}
                className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
              >
                {importing ? 'Importing...' : `Import ${tripParseResult.summary.adhocCount + tripParseResult.summary.regularCount} trips for ${displayMonth(selectedMonth)}`}
                {monthImport && ' (replaces existing)'}
              </button>
            )}

            {/* Import History */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Import History</h3>
              </div>
              {misImports.length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-500 text-sm">No imports yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-left">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Month</th>
                        <th className="px-4 py-2.5 font-medium text-right">Adhoc</th>
                        <th className="px-4 py-2.5 font-medium text-right">Regular</th>
                        <th className="px-4 py-2.5 font-medium text-right">Total</th>
                        <th className="px-4 py-2.5 font-medium text-right">Adhoc Amount</th>
                        <th className="px-4 py-2.5 font-medium hidden sm:table-cell">CN</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {misImports.map(imp => (
                        <tr key={imp.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{imp.periodLabel}</td>
                          <td className="px-4 py-3 text-right">{imp.adhocTrips || 0}</td>
                          <td className="px-4 py-3 text-right">{imp.regularTrips || 0}</td>
                          <td className="px-4 py-3 text-right font-medium">{imp.totalTrips || 0}</td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">{formatCurrency(imp.adhocTotal || 0)}</td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            {imp.cnSummary ? (
                              <span className="text-xs text-green-600">v{imp.cnSummary.revision} | Diff: {formatCurrency(imp.cnSummary.totalDiff)}</span>
                            ) : (
                              <span className="text-xs text-gray-400">Not uploaded</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                              imp.status === 'resolved' ? 'bg-green-100 text-green-800' :
                              imp.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                              imp.status === 'disputed' ? 'bg-red-100 text-red-800' :
                              'bg-gray-100 text-gray-600'
                            }`}>{imp.status || 'draft'}</span>
                          </td>
                          <td className="px-4 py-3">
                            <button onClick={() => setDeleteConfirm(imp)}
                              className="text-gray-400 hover:text-red-600 transition-colors p-1" title="Delete">
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
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* RECONCILIATION TAB */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {activeTab === 'reconciliation' && (
          <div className="space-y-6">
            {/* Action bar */}
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <p className="text-sm text-gray-500">{monthTrips.length} MIS trips for selected month</p>
              <button
                onClick={handleReconcile}
                disabled={reconciling || monthTrips.length === 0}
                className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm disabled:opacity-50"
              >
                {reconciling ? 'Reconciling...' : 'Run Reconciliation'}
              </button>
            </div>

            {/* Summary cards */}
            {(reconStats || monthImport?.reconStats) && (() => {
              const stats = reconStats || monthImport?.reconStats
              return (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <p className="text-xs text-green-600 font-medium">Matched</p>
                    <p className="text-xl font-bold text-green-900">{stats.matched}</p>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <p className="text-xs text-amber-600 font-medium">Amt Mismatch</p>
                    <p className="text-xl font-bold text-amber-900">{stats.amountMismatch}</p>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-xs text-red-600 font-medium">Missing in OTD</p>
                    <p className="text-xl font-bold text-red-900">{stats.unmatched}</p>
                  </div>
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                    <p className="text-xs text-purple-600 font-medium">Disputed</p>
                    <p className="text-xl font-bold text-purple-900">{stats.disputed}</p>
                  </div>
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                    <p className="text-xs text-orange-600 font-medium">Missing in MIS</p>
                    <p className="text-xl font-bold text-orange-900">{missingFromMis.length || stats.missingFromMis || 0}</p>
                  </div>
                </div>
              )
            })()}

            {/* CN Summary if available */}
            {monthImport?.cnSummary && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Credit Note Summary (v{monthImport.cnSummary.revision})</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-gray-500">OTD Freight</p>
                    <p className="font-medium">{formatCurrency(monthImport.cnSummary.totalFreightAmount)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">SFX Final</p>
                    <p className="font-medium">{formatCurrency(monthImport.cnSummary.totalSfxFinalAmount)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Difference</p>
                    <p className="font-medium text-red-600">{formatCurrency(monthImport.cnSummary.totalDiff)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Trips Matched</p>
                    <p className="font-medium">{monthImport.cnSummary.mergedCount}/{monthImport.cnSummary.totalTrips}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Filter by trip type */}
            <div className="flex gap-2 flex-wrap mb-2">
              {['all', 'adhoc', 'regular'].map(t => (
                <button
                  key={t}
                  onClick={() => setTripTypeFilter(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    tripTypeFilter === t
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t === 'all' ? 'All Types' : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* Filter by status */}
            <div className="flex gap-2 flex-wrap">
              {['all', 'matched', 'amount_mismatch', 'unmatched', 'disputed'].map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    statusFilter === s
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {s === 'all' ? 'All' : s === 'amount_mismatch' ? 'Amt Mismatch' : s === 'unmatched' ? 'Missing in OTD' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>

            {/* Reconciliation table */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              {filteredReconTrips.length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-500 text-sm">
                  {monthTrips.length === 0 ? 'No MIS data for this month. Import first.' : 'No trips match filter. Run reconciliation first.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-left">
                      <tr>
                        <th className="px-3 py-2.5 font-medium">Status</th>
                        <th className="px-3 py-2.5 font-medium">Type</th>
                        <th className="px-3 py-2.5 font-medium">Date</th>
                        <th className="px-3 py-2.5 font-medium">Vehicle</th>
                        <th className="px-3 py-2.5 font-medium">Origin → Dest</th>
                        <th className="px-3 py-2.5 font-medium text-right">MIS Amt</th>
                        <th className="px-3 py-2.5 font-medium text-right">OTD Amt</th>
                        <th className="px-3 py-2.5 font-medium text-right">CN Diff</th>
                        <th className="px-3 py-2.5 font-medium w-20">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {filteredReconTrips.slice(0, 500).map(t => (
                        <tr key={t.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2.5"><MatchBadge status={t.matchStatus} /></td>
                          <td className="px-3 py-2.5"><TypeBadge type={t.tripType} /></td>
                          <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{formatDate(t.sfx_date)}</td>
                          <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap text-xs">{t.sfx_vehicleNo || '—'}</td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs">
                            {t.sfx_origin || '—'} → {t.sfx_destination || '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            {t.sfx_cost ? formatCurrency(t.sfx_cost) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            {t.otd_bidAmount ? formatCurrency(t.otd_bidAmount) : '—'}
                          </td>
                          <td className={`px-3 py-2.5 text-right whitespace-nowrap ${t.cn_diff && t.cn_diff !== 0 ? 'text-red-600 font-medium' : ''}`}>
                            {t.cn_diff != null ? formatCurrency(t.cn_diff) : '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            {t.matchStatus !== 'matched' && t.matchStatus !== 'disputed' && (
                              <button onClick={() => handleMarkDisputed(t)}
                                className="text-xs text-purple-600 hover:text-purple-800 font-medium">
                                Dispute
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredReconTrips.length > 500 && (
                    <div className="px-4 py-3 text-center text-sm text-gray-500 bg-gray-50 border-t">
                      Showing first 500 of {filteredReconTrips.length}. Use filters to narrow.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Missing from MIS section */}
            {missingFromMis.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm border border-orange-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-orange-200 bg-orange-50">
                  <h3 className="text-sm font-semibold text-orange-800">
                    Missing from Shadowfax MIS ({missingFromMis.length} trips)
                  </h3>
                  <p className="text-xs text-orange-600 mt-0.5">
                    OTD logged these trips but they&apos;re not in Shadowfax&apos;s MIS — you may be owed money
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-left">
                      <tr>
                        <th className="px-3 py-2.5 font-medium">Date</th>
                        <th className="px-3 py-2.5 font-medium">Vehicle</th>
                        <th className="px-3 py-2.5 font-medium">Origin → Dest</th>
                        <th className="px-3 py-2.5 font-medium text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {missingFromMis.map(t => (
                        <tr key={t.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2.5 whitespace-nowrap">{formatDate(t.date)}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-xs">{t.vehicle_no}</td>
                          <td className="px-3 py-2.5 text-xs">{t.origin} → {t.destination}</td>
                          <td className="px-3 py-2.5 text-right font-medium">{formatCurrency(t.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* DISPUTES TAB */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {activeTab === 'disputes' && (
          <div className="space-y-6">
            {/* Upload Credit Note */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Upload Credit Note Summary
              </h3>
              <p className="text-xs text-gray-400 mb-4">Upload when CN arrives from Shadowfax, or re-upload when revised CN comes</p>
              <div className="flex flex-col sm:flex-row gap-3 items-start">
                <label className="flex-1 cursor-pointer">
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:border-blue-400 transition-colors">
                    <p className="text-sm text-gray-500">
                      {cnFile ? cnFile.name : 'Drop or tap to select Credit Note Excel'}
                    </p>
                  </div>
                  <input type="file" accept=".xlsx,.xls" onChange={handleCnFileChange} className="hidden" />
                </label>
              </div>

              {cnParseResult && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                  <p className="font-medium text-blue-900">
                    Found: {cnParseResult.summary.totalTrips} trips | Freight: {formatCurrency(cnParseResult.summary.totalFreightAmount)} | SFX Final: {formatCurrency(cnParseResult.summary.totalSfxFinalAmount)} | Diff: {formatCurrency(cnParseResult.summary.totalDiff)}
                  </p>
                </div>
              )}

              {monthImport && cnParseResult && (
                <button
                  onClick={handleUploadCreditNote}
                  disabled={importing}
                  className="mt-4 px-4 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium text-sm disabled:opacity-50"
                >
                  {importing ? 'Merging...' : 'Merge Credit Note into existing data'}
                </button>
              )}
            </div>

            {/* Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Total Disputed</p>
                <p className="text-2xl font-bold text-gray-900">{disputeTrips.filter(t => t.matchStatus === 'disputed').length}</p>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Amount Mismatches</p>
                <p className="text-2xl font-bold text-amber-600">{disputeTrips.filter(t => t.matchStatus === 'amount_mismatch').length}</p>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Total Difference</p>
                <p className="text-2xl font-bold text-red-600">
                  {formatCurrency(disputeTrips.reduce((s, t) => s + Math.abs(t.amountDifference || t.cn_diff || 0), 0))}
                </p>
              </div>
            </div>

            {/* Dispute list */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              {disputeTrips.length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-500 text-sm">
                  No disputes or mismatches found. Run reconciliation first.
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {disputeTrips.map(t => (
                    <div key={t.id} className="p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mb-2">
                        <MatchBadge status={t.matchStatus} />
                        <TypeBadge type={t.tripType} />
                        <span className="text-sm text-gray-500">{formatDate(t.sfx_date)}</span>
                        <span className="text-sm font-medium">{t.sfx_vehicleNo}</span>
                        <span className="text-sm text-gray-500">{t.sfx_origin} → {t.sfx_destination}</span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm mb-2">
                        <div>
                          <span className="text-gray-500">MIS Amount: </span>
                          <span className="font-medium">{formatCurrency(t.sfx_cost || t.cn_freightAmount)}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">OTD Amount: </span>
                          <span className="font-medium">{formatCurrency(t.otd_bidAmount)}</span>
                        </div>
                        {t.cn_sfxFinalAmount != null && (
                          <div>
                            <span className="text-gray-500">SFX Final: </span>
                            <span className="font-medium">{formatCurrency(t.cn_sfxFinalAmount)}</span>
                          </div>
                        )}
                        <div>
                          <span className="text-gray-500">Diff: </span>
                          <span className="font-medium text-red-600">{formatCurrency(t.amountDifference || t.cn_diff)}</span>
                        </div>
                      </div>

                      {t.cn_remark && (
                        <p className="text-xs text-gray-500 mb-2">SFX Remark: {t.cn_remark}</p>
                      )}

                      {/* Dispute notes */}
                      {editingDispute === t.id ? (
                        <div className="flex gap-2 mt-2">
                          <input
                            type="text"
                            value={disputeNotes}
                            onChange={e => setDisputeNotes(e.target.value)}
                            placeholder="Dispute notes..."
                            className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                            autoFocus
                          />
                          <button onClick={() => handleSaveDisputeNotes(t.id)}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium">Save</button>
                          <button onClick={() => setEditingDispute(null)}
                            className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm">Cancel</button>
                        </div>
                      ) : (
                        <div className="flex gap-2 mt-2">
                          {t.disputeNotes && (
                            <span className="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
                              Notes: {t.disputeNotes}
                            </span>
                          )}
                          <button
                            onClick={() => { setEditingDispute(t.id); setDisputeNotes(t.disputeNotes || '') }}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            {t.disputeNotes ? 'Edit Notes' : 'Add Notes'}
                          </button>
                          <button
                            onClick={() => handleResolveDispute(t, t.cn_sfxFinalAmount || t.sfx_cost)}
                            className="text-xs text-green-600 hover:text-green-800 font-medium"
                          >
                            Resolve
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {/* ════════════════════════════════════════════════════════════════ */}
        {/* REGULAR TRIPS TAB */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {activeTab === 'regular_trips' && (
          <div className="space-y-6">
            {/* Add/Edit form */}
            {editingRegular !== null ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
                  {editingRegular === 'new' ? 'Add Regular Trip' : 'Edit Regular Trip'}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Lane Name</label>
                    <input
                      type="text"
                      value={regularForm.lane}
                      onChange={e => setRegularForm(f => ({ ...f, lane: e.target.value }))}
                      placeholder="e.g. Patna DC-Sonho DC"
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Number</label>
                    <input
                      type="text"
                      value={regularForm.vehicleNo}
                      onChange={e => setRegularForm(f => ({ ...f, vehicleNo: e.target.value }))}
                      placeholder="e.g. BR11GF7516"
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Type</label>
                    <select
                      value={regularForm.vehicleType}
                      onChange={e => setRegularForm(f => ({ ...f, vehicleType: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      {VEHICLE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">CPK Rate (₹/km)</label>
                    <input
                      type="number"
                      value={regularForm.cpkRate}
                      onChange={e => setRegularForm(f => ({ ...f, cpkRate: e.target.value }))}
                      placeholder="0"
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Allotted KMs</label>
                    <input
                      type="number"
                      value={regularForm.allottedKms}
                      onChange={e => setRegularForm(f => ({ ...f, allottedKms: e.target.value }))}
                      placeholder="0"
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={regularForm.startDate}
                      onChange={e => setRegularForm(f => ({ ...f, startDate: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                    <select
                      value={regularForm.status}
                      onChange={e => setRegularForm(f => ({ ...f, status: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={handleSaveRegular}
                    className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
                  >
                    Save
                  </button>
                  <button
                    onClick={resetRegularForm}
                    className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setEditingRegular('new')}
                className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
              >
                + Add Regular Trip
              </button>
            )}

            {/* List */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              {regularTrips.length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-500 text-sm">
                  No regular trips configured. Add your standing CPK lane contracts here.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-left">
                      <tr>
                        <th className="px-4 py-3 font-medium">Lane</th>
                        <th className="px-4 py-3 font-medium">Vehicle</th>
                        <th className="px-4 py-3 font-medium">Type</th>
                        <th className="px-4 py-3 font-medium text-right">CPK Rate</th>
                        <th className="px-4 py-3 font-medium text-right">Allotted KMs</th>
                        <th className="px-4 py-3 font-medium">Start Date</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium w-20">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {regularTrips.map(rt => (
                        <tr key={rt.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{rt.lane}</td>
                          <td className="px-4 py-3 text-gray-500">{rt.vehicleNo}</td>
                          <td className="px-4 py-3 text-gray-500">{rt.vehicleType}</td>
                          <td className="px-4 py-3 text-right text-gray-900">{rt.cpkRate ? `₹${rt.cpkRate}` : '—'}</td>
                          <td className="px-4 py-3 text-right text-gray-900">{rt.allottedKms || '—'}</td>
                          <td className="px-4 py-3 text-gray-500">{formatDate(rt.startDate)}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                              rt.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                            }`}>{rt.status}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleEditRegular(rt)}
                                className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                              >Edit</button>
                              <button
                                onClick={() => handleDeleteRegular(rt.id)}
                                className="text-red-500 hover:text-red-700 text-xs font-medium"
                              >Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
