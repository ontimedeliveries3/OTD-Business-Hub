import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/useAuth'
import { parseAllocationExcel, ORIGINS, VEHICLE_SIZES } from '../lib/bids'
import BidForm from '../components/BidForm'
import BidEditModal from '../components/BidEditModal'

export default function BidsPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  // Data
  const [bids, setBids] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Tabs
  const [activeTab, setActiveTab] = useState('log')

  // Toast
  const [toast, setToast] = useState(null)
  const toastTimeoutRef = useRef(null)

  // View tab filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [originFilter, setOriginFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [vehicleFilter, setVehicleFilter] = useState('all')

  // Edit & Delete
  const [editingBid, setEditingBid] = useState(null)
  const [editSaving, setEditSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Import
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef(null)

  // ── Load data ──────────────────────────────────────────────────────────

  useEffect(() => {
    async function loadData() {
      try {
        setError(null)
        const bidsSnap = await getDocs(collection(db, 'bids'))
        const bidsList = []
        bidsSnap.forEach(d => bidsList.push({ id: d.id, ...d.data() }))
        bidsList.sort((a, b) => (b.requestDate || '').localeCompare(a.requestDate || ''))
        setBids(bidsList)
      } catch (err) {
        console.error('Failed to load bids:', err)
        setError('Failed to load data: ' + err.message)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  // ── Filtered bids ─────────────────────────────────────────────────────

  const filteredBids = useMemo(() => {
    return bids.filter(b => {
      if (dateFrom && b.requestDate < dateFrom) return false
      if (dateTo && b.requestDate > dateTo) return false
      if (originFilter !== 'all' && b.origin !== originFilter) return false
      if (statusFilter !== 'all' && b.status !== statusFilter) return false
      if (vehicleFilter !== 'all' && b.vehicleSize !== vehicleFilter) return false
      return true
    })
  }, [bids, dateFrom, dateTo, originFilter, statusFilter, vehicleFilter])

  // ── Stats ─────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const total = filteredBids.length
    const won = filteredBids.filter(b => b.status === 'won')
    const lost = filteredBids.filter(b => b.status === 'lost')
    const skipped = filteredBids.filter(b => b.status === 'skipped')
    const winRate = total > 0 ? Math.round((won.length / (won.length + lost.length || 1)) * 100) : 0

    let weekRevenue = 0
    let monthRevenue = 0
    const now = new Date()
    const weekAgo = new Date(now)
    weekAgo.setDate(weekAgo.getDate() - 7)
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const weekAgoStr = weekAgo.toISOString().split('T')[0]

    won.forEach(b => {
      const price = b.allocationPrice || 0
      if (b.requestDate >= weekAgoStr) weekRevenue += price
      if (b.requestDate >= monthStart) monthRevenue += price
    })

    // Average winning price by origin
    const originAvg = {}
    won.forEach(b => {
      const o = b.origin || 'Unknown'
      if (!originAvg[o]) originAvg[o] = { total: 0, count: 0 }
      originAvg[o].total += b.allocationPrice || 0
      originAvg[o].count += 1
    })
    const avgByOrigin = Object.entries(originAvg).map(([origin, d]) => ({
      origin,
      avg: Math.round(d.total / d.count),
      count: d.count,
    })).sort((a, b) => b.count - a.count)

    return { total, won: won.length, lost: lost.length, skipped: skipped.length, winRate, weekRevenue, monthRevenue, avgByOrigin }
  }, [filteredBids])

  // ── Helpers ────────────────────────────────────────────────────────────

  const formatCurrency = (amount) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount)

  const formatDate = (dateStr) => {
    if (!dateStr) return '\u2014'
    const parts = dateStr.split('-')
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`
    return dateStr
  }

  const showToast = (msg, action) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
    setToast({ msg, action })
    toastTimeoutRef.current = setTimeout(() => setToast(null), action ? 5000 : 2500)
  }

  const statusBadge = (status) => {
    const classes = {
      won: 'bg-green-100 text-green-700',
      lost: 'bg-red-100 text-red-700',
      skipped: 'bg-gray-100 text-gray-600',
    }
    return (
      <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${classes[status] || 'bg-gray-100 text-gray-600'}`}>
        {status ? status.charAt(0).toUpperCase() + status.slice(1) : '\u2014'}
      </span>
    )
  }

  // ── Save ───────────────────────────────────────────────────────────────

  const handleSave = async (bidData) => {
    try {
      setError(null)
      const docRef = await addDoc(collection(db, 'bids'), {
        ...bidData,
        created_at: serverTimestamp(),
        created_by: user.email,
      })
      const newBid = { id: docRef.id, ...bidData, created_at: new Date() }
      setBids(prev => [newBid, ...prev])

      if (bidData.status === 'won') {
        showToast('Bid saved! Won ' + formatCurrency(bidData.allocationPrice), {
          label: 'Create trip \u2192',
          onClick: () => {
            const params = new URLSearchParams({
              from_bid: '1',
              origin: bidData.origin,
              destination: bidData.destination || bidData.touchPoints?.[0] || '',
              vehicle_size: bidData.vehicleSize,
              amount: String(bidData.allocationPrice || ''),
            })
            navigate('/trips?' + params.toString())
          },
        })
      } else {
        showToast('Bid saved!')
      }
    } catch (err) {
      console.error('Failed to save bid:', err)
      setError('Failed to save bid: ' + err.message)
    }
  }

  // ── Edit ───────────────────────────────────────────────────────────────

  const handleEditSave = async (bidId, bidData) => {
    setEditSaving(true)
    try {
      await updateDoc(doc(db, 'bids', bidId), {
        ...bidData,
        updated_at: serverTimestamp(),
        updated_by: user.email,
      })
      setBids(prev => prev.map(b => b.id === bidId ? { ...b, ...bidData } : b))
      setEditingBid(null)
      showToast('Bid updated!')
    } finally {
      setEditSaving(false)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────

  const handleDelete = async (bid) => {
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'bids', bid.id))
      setBids(prev => prev.filter(b => b.id !== bid.id))
      setDeleteConfirm(null)
      showToast('Bid deleted.')
    } catch (err) {
      console.error('Failed to delete bid:', err)
      setError('Failed to delete: ' + err.message)
    } finally {
      setDeleting(false)
    }
  }

  // ── Clear all bids ─────────────────────────────────────────────────────

  const [clearingAll, setClearingAll] = useState(false)
  const [clearAllConfirm, setClearAllConfirm] = useState(false)

  const handleClearAll = async () => {
    setClearingAll(true)
    try {
      const ids = bids.map(b => b.id)
      for (let i = 0; i < ids.length; i += 450) {
        const batch = writeBatch(db)
        ids.slice(i, i + 450).forEach(id => batch.delete(doc(db, 'bids', id)))
        await batch.commit()
      }
      setBids([])
      setClearAllConfirm(false)
      showToast(`Cleared ${ids.length} bids.`)
    } catch (err) {
      console.error('Failed to clear bids:', err)
      setError('Failed to clear: ' + err.message)
    } finally {
      setClearingAll(false)
    }
  }

  // ── Import Excel ───────────────────────────────────────────────────────

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setError(null)

    try {
      const parsed = await parseAllocationExcel(file)

      // Check for duplicates by requestId
      const existingIds = new Set(bids.map(b => b.requestId))
      const newBids = parsed.filter(b => !existingIds.has(b.requestId))

      if (newBids.length === 0) {
        showToast('No new bids to import — all already exist.')
        setImporting(false)
        return
      }

      // Batch write to Firestore (max 500 per batch)
      const newDocs = []
      for (let i = 0; i < newBids.length; i += 450) {
        const chunk = newBids.slice(i, i + 450)
        const batch = writeBatch(db)
        const refs = []
        for (const bid of chunk) {
          const ref = doc(collection(db, 'bids'))
          batch.set(ref, {
            ...bid,
            created_at: serverTimestamp(),
            created_by: user.email,
            imported: true,
          })
          refs.push({ ref, bid })
        }
        await batch.commit()
        refs.forEach(({ ref, bid }) => {
          newDocs.push({ id: ref.id, ...bid, created_at: new Date(), imported: true })
        })
      }

      setBids(prev => [...newDocs, ...prev].sort((a, b) => (b.requestDate || '').localeCompare(a.requestDate || '')))
      showToast(`Imported ${newDocs.length} bids!`)
      setActiveTab('history')
    } catch (err) {
      console.error('Import failed:', err)
      setError('Import failed: ' + err.message)
    } finally {
      setImporting(false)
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-3">
        <div className="w-8 h-8 border-3 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
        <p className="text-gray-500 text-sm">Loading bids...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast notification */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-gray-900 text-white text-sm rounded-lg shadow-lg animate-fade-in flex items-center gap-3">
          <span>{toast.msg}</span>
          {toast.action && (
            <button
              onClick={toast.action.onClick}
              className="px-2.5 py-1 bg-blue-500 hover:bg-blue-400 text-white text-xs font-medium rounded transition-colors"
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editingBid && (
        <BidEditModal
          bid={editingBid}
          onSave={handleEditSave}
          onClose={() => setEditingBid(null)}
          saving={editSaving}
        />
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4 w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Bid</h3>
            <p className="text-sm text-gray-600 mb-1">
              Delete bid <span className="font-medium">{deleteConfirm.requestId}</span>?
            </p>
            <p className="text-sm text-gray-600 mb-1">
              {deleteConfirm.origin} &middot; {deleteConfirm.vehicleSize} &middot; {statusBadge(deleteConfirm.status)}
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

      {/* Clear All Confirmation */}
      {clearAllConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4 w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Clear All Bids</h3>
            <p className="text-sm text-gray-600 mb-1">
              Delete all <span className="font-medium">{bids.length}</span> bids?
            </p>
            <p className="text-xs text-red-500 mb-4">This action cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setClearAllConfirm(false)}
                disabled={clearingAll}
                className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleClearAll}
                disabled={clearingAll}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-sm disabled:opacity-50"
              >
                {clearingAll ? 'Clearing...' : 'Clear All'}
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
            <h1 className="text-xl font-bold text-gray-900">Bid Tracker</h1>
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
        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Tab Bar */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab('log')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'log'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Log Bid
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'history'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Bid History ({bids.length})
          </button>
        </div>

        {/* ── LOG TAB ─────────────────────────────────────────────────── */}
        {activeTab === 'log' && (
          <BidForm onSave={handleSave} autoResetOnSave />
        )}

        {/* ── HISTORY TAB ─────────────────────────────────────────────── */}
        {activeTab === 'history' && (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Total Bids</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</p>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Won</p>
                <p className="text-2xl font-bold text-green-600 mt-1">
                  {stats.won} <span className="text-sm font-normal text-gray-400">({stats.winRate}%)</span>
                </p>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Week Revenue</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(stats.weekRevenue)}</p>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Month Revenue</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(stats.monthRevenue)}</p>
              </div>
            </div>

            {/* Avg Winning Price by Origin */}
            {stats.avgByOrigin.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
                <p className="text-sm text-gray-500 mb-2">Avg Winning Price by Origin</p>
                <div className="flex flex-wrap gap-3">
                  {stats.avgByOrigin.map(a => (
                    <div key={a.origin} className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-gray-900">{a.origin}</span>
                      <span className="text-sm text-blue-600 font-semibold">{formatCurrency(a.avg)}</span>
                      <span className="text-xs text-gray-400">({a.count})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Filters + Import */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <select
                  value={originFilter}
                  onChange={(e) => setOriginFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">All Origins</option>
                  {ORIGINS.map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                  <option value="skipped">Skipped</option>
                </select>
                <select
                  value={vehicleFilter}
                  onChange={(e) => setVehicleFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">All Vehicles</option>
                  {VEHICLE_SIZES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleImport}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {importing ? 'Importing...' : 'Import Allocation History'}
                </button>
                {bids.length > 0 && (
                  <button
                    onClick={() => setClearAllConfirm(true)}
                    className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-sm font-medium transition-colors"
                  >
                    Clear All ({bids.length})
                  </button>
                )}
              </div>
            </div>

            {/* Results count */}
            <p className="text-sm text-gray-500 mb-3">
              {filteredBids.length} bid{filteredBids.length !== 1 ? 's' : ''}
            </p>

            {/* Bids Table */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              {filteredBids.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-500">
                  {bids.length === 0
                    ? 'No bids logged yet. Switch to the "Log Bid" tab or import allocation history.'
                    : 'No bids match your filters.'
                  }
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-left">
                      <tr>
                        <th className="px-4 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 font-medium">Request ID</th>
                        <th className="px-4 py-3 font-medium hidden sm:table-cell">Origin</th>
                        <th className="px-4 py-3 font-medium hidden sm:table-cell">Destination</th>
                        <th className="px-4 py-3 font-medium hidden lg:table-cell">Touch Points</th>
                        <th className="px-4 py-3 font-medium hidden sm:table-cell">Vehicle</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium text-right">Amount</th>
                        <th className="px-4 py-3 font-medium w-20"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {filteredBids.slice(0, 500).map(b => (
                        <tr key={b.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-900 whitespace-nowrap">{formatDate(b.requestDate)}</td>
                          <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                            <span className="text-xs">{b.requestId || '\u2014'}</span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{b.origin || '\u2014'}</td>
                          <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{b.destination || '\u2014'}</td>
                          <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">
                            {Array.isArray(b.touchPoints)
                              ? b.touchPoints.slice(0, 2).join(', ') + (b.touchPoints.length > 2 ? ` +${b.touchPoints.length - 2}` : '')
                              : '\u2014'
                            }
                          </td>
                          <td className="px-4 py-3 text-gray-500 hidden sm:table-cell whitespace-nowrap">{b.vehicleSize || '\u2014'}</td>
                          <td className="px-4 py-3">{statusBadge(b.status)}</td>
                          <td className="px-4 py-3 text-gray-900 font-medium text-right whitespace-nowrap">
                            {b.status === 'won'
                              ? formatCurrency(b.allocationPrice || 0)
                              : b.bidAmount
                                ? formatCurrency(b.bidAmount)
                                : '\u2014'
                            }
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              {b.status === 'won' && (
                                <button
                                  onClick={() => {
                                    const params = new URLSearchParams({
                                      from_bid: '1',
                                      origin: b.origin || '',
                                      destination: b.destination || b.touchPoints?.[0] || '',
                                      vehicle_size: b.vehicleSize || '',
                                      amount: String(b.allocationPrice || ''),
                                      sfec_request_id: b.requestId || '',
                                    })
                                    navigate('/trips?' + params.toString())
                                  }}
                                  className="text-green-500 hover:text-green-700 transition-colors p-1"
                                  title="Create trip"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
                                  </svg>
                                </button>
                              )}
                              <button
                                onClick={() => setEditingBid(b)}
                                className="text-gray-400 hover:text-blue-600 transition-colors p-1"
                                title="Edit"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(b)}
                                className="text-gray-400 hover:text-red-600 transition-colors p-1"
                                title="Delete"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredBids.length > 500 && (
                    <div className="px-4 py-3 text-center text-sm text-gray-500 bg-gray-50 border-t border-gray-200">
                      Showing first 500 of {filteredBids.length} bids. Use filters to narrow results.
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
