import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/useAuth'
import TripForm from '../components/TripForm'
import TripEditModal from '../components/TripEditModal'

// Default vehicles to seed if collection is empty
const DEFAULT_VEHICLES = [
  { number: 'BR11GF3128', size: 'Tata 407' },
  { number: 'BR11GF7560', size: 'Tata 407' },
  { number: 'JH05DR0249', size: 'Tata 407' },
  { number: 'JH05DT1651', size: 'Bolero' },
  { number: 'JH05DV0634', size: 'Bolero' },
  { number: 'BR11GF4665', size: 'Bolero' },
  { number: 'BR02GD1367', size: '8 FT' },
]

// Default locations per client (shared pool for origin & destination)
const DEFAULT_LOCATIONS = [
  // Shadowfax
  { name: 'Patna DC', client_id: 'shadowfax' },
  { name: 'Ranchi DC', client_id: 'shadowfax' },
  { name: 'Purnia DC', client_id: 'shadowfax' },
  { name: 'Jamshedpur DC', client_id: 'shadowfax' },
  { name: 'Monifit DC', client_id: 'shadowfax' },
  { name: 'SimrahiBazar DC', client_id: 'shadowfax' },
  { name: 'Madhepura DC', client_id: 'shadowfax' },
  { name: 'Pawakhali DC', client_id: 'shadowfax' },
  { name: 'Bhawanipur DC', client_id: 'shadowfax' },
  { name: 'Bahadurganj DC', client_id: 'shadowfax' },
  // Meesho
  { name: 'PTS (Patna Sort Center)', client_id: 'meesho' },
  { name: 'Ranchi SC (RNS)', client_id: 'meesho' },
  { name: 'Janakpur Lane', client_id: 'meesho' },
  { name: 'Bero Lane', client_id: 'meesho' },
  { name: 'Chhattisgarh Lane', client_id: 'meesho' },
]

export default function TripsPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Pre-fill from bid (when navigating from Bid Tracker with "Create trip")
  const bidPrefill = useMemo(() => {
    if (searchParams.get('from_bid') !== '1') return null
    return {
      client_id: 'shadowfax',
      origin: searchParams.get('origin') || '',
      destination: searchParams.get('destination') || '',
      vehicle_size: searchParams.get('vehicle_size') || '',
      amount: searchParams.get('amount') || '',
      sfec_request_id: searchParams.get('sfec_request_id') || '',
    }
  }, [searchParams])

  // Data
  const [trips, setTrips] = useState([])
  const [clients, setClients] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [locations, setLocations] = useState([])

  // Tabs
  const [activeTab, setActiveTab] = useState('log')

  // Toast
  const [toast, setToast] = useState(null)

  // View tab filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [clientFilter, setClientFilter] = useState('all')
  const [vehicleSearch, setVehicleSearch] = useState('')
  // Regular Trips (lane contracts)
  const [regularTrips, setRegularTrips] = useState([])
  const [editingRegular, setEditingRegular] = useState(null)
  const [regularForm, setRegularForm] = useState({ lane: '', vehicleNo: '', vehicleType: 'Bolero', cpkRate: '', allottedKms: '', workingDays: '30', startDate: '', endDate: '', status: 'active' })
  const [logSubTab, setLogSubTab] = useState('adhoc') // adhoc | regular

  // Edit & Delete
  const [editingTrip, setEditingTrip] = useState(null)
  const [editSaving, setEditSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // ── Load data ──────────────────────────────────────────────────────────

  useEffect(() => {
    async function loadData() {
      try {
        setError(null)
        const [tripsSnap, clientsSnap, vehiclesSnap, locationsSnap, regularTripsSnap] = await Promise.all([
          getDocs(collection(db, 'trips')),
          getDocs(collection(db, 'clients')),
          getDocs(collection(db, 'vehicles')),
          getDocs(collection(db, 'locations')),
          getDocs(collection(db, 'regular_trips')),
        ])

        const tripsList = []
        tripsSnap.forEach(d => tripsList.push({ id: d.id, ...d.data() }))
        tripsList.sort((a, b) => (b.date || '').localeCompare(a.date || ''))

        const clientsList = []
        clientsSnap.forEach(d => clientsList.push({ id: d.id, ...d.data() }))

        let vehiclesList = []
        vehiclesSnap.forEach(d => vehiclesList.push({ id: d.id, ...d.data() }))

        // Seed any missing default vehicles
        const existingIds = new Set(vehiclesList.map(v => v.id))
        const missing = DEFAULT_VEHICLES.filter(v => !existingIds.has(v.number))
        if (missing.length > 0) {
          for (const v of missing) {
            await setDoc(doc(db, 'vehicles', v.number), { number: v.number, size: v.size, active: true })
            vehiclesList.push({ id: v.number, number: v.number, size: v.size, active: true })
          }
        }

        let locationsList = []
        locationsSnap.forEach(d => locationsList.push({ id: d.id, ...d.data() }))

        // Seed any missing default locations
        const existingLocIds = new Set(locationsList.map(l => l.id))
        const missingLocs = DEFAULT_LOCATIONS.filter(l => {
          const locId = `${l.client_id}_${l.name.replace(/[^a-zA-Z0-9]/g, '_')}`
          return !existingLocIds.has(locId)
        })
        if (missingLocs.length > 0) {
          for (const l of missingLocs) {
            const locId = `${l.client_id}_${l.name.replace(/[^a-zA-Z0-9]/g, '_')}`
            await setDoc(doc(db, 'locations', locId), { name: l.name, client_id: l.client_id, active: true })
            locationsList.push({ id: locId, name: l.name, client_id: l.client_id, active: true })
          }
        }

        setTrips(tripsList)
        setClients(clientsList)
        setVehicles(vehiclesList.filter(v => v.active !== false))
        setLocations(locationsList.filter(l => l.active !== false))

        const regularList = []
        regularTripsSnap.forEach(d => regularList.push({ id: d.id, ...d.data() }))
        setRegularTrips(regularList)
      } catch (err) {
        console.error('Failed to load trips:', err)
        setError('Failed to load data: ' + err.message)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  // ── Suggestions from existing trips (recent-first, deduplicated) ──────

  const suggestions = useMemo(() => {
    const driverMap = new Map()

    // trips are already sorted by date desc
    trips.forEach(t => {
      if (t.driver_name && !driverMap.has(t.driver_name)) driverMap.set(t.driver_name, true)
    })

    return {
      driver_name: [...driverMap.keys()],
    }
  }, [trips])

  // ── Filtered trips ─────────────────────────────────────────────────────

  const filteredTrips = useMemo(() => {
    return trips.filter(t => {
      if (dateFrom && t.date < dateFrom) return false
      if (dateTo && t.date > dateTo) return false
      if (clientFilter !== 'all' && t.client_id !== clientFilter) return false
      if (vehicleSearch) {
        const q = vehicleSearch.toUpperCase()
        if (!(t.vehicle_no || '').toUpperCase().includes(q)) return false
      }
      return true
    })
  }, [trips, dateFrom, dateTo, clientFilter, vehicleSearch])

  const stats = useMemo(() => {
    let totalAmount = 0
    const vehicleSet = new Set()
    filteredTrips.forEach(t => {
      totalAmount += t.amount || 0
      if (t.vehicle_no) vehicleSet.add(t.vehicle_no)
    })
    return { trips: filteredTrips.length, amount: totalAmount, vehicles: vehicleSet.size }
  }, [filteredTrips])

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

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // ── Single save ────────────────────────────────────────────────────────

  const handleSingleSave = async (tripData) => {
    try {
      setError(null)
      const docRef = await addDoc(collection(db, 'trips'), {
        ...tripData,
        created_at: serverTimestamp(),
        created_by: user.email,
        updated_at: serverTimestamp(),
        updated_by: user.email,
      })
      setTrips(prev => [{ id: docRef.id, ...tripData, created_at: new Date() }, ...prev])
      showToast('Trip saved!')
    } catch (err) {
      console.error('Failed to save trip:', err)
      setError('Failed to save trip: ' + err.message)
    }
  }

  // ── Edit ───────────────────────────────────────────────────────────────

  const handleEditSave = async (tripId, tripData) => {
    setEditSaving(true)
    try {
      await updateDoc(doc(db, 'trips', tripId), {
        ...tripData,
        updated_at: serverTimestamp(),
        updated_by: user.email,
      })
      setTrips(prev => prev.map(t => t.id === tripId ? { ...t, ...tripData } : t))
      setEditingTrip(null)
      showToast('Trip updated!')
    } finally {
      setEditSaving(false)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────

  const handleDelete = async (trip) => {
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'trips', trip.id))
      setTrips(prev => prev.filter(t => t.id !== trip.id))
      setDeleteConfirm(null)
      showToast('Trip deleted.')
    } catch (err) {
      console.error('Failed to delete trip:', err)
      setError('Failed to delete: ' + err.message)
    } finally {
      setDeleting(false)
    }
  }

  // ── Regular Trips CRUD ─────────────────────────────────────────────────
  const VEHICLE_TYPES = ['Bolero', 'Tata Ace', 'Tata 407', '8 ft', '10 ft', '14 ft', '17 ft', '32 ft']

  const resetRegularForm = () => {
    setRegularForm({ lane: '', vehicleNo: '', vehicleType: 'Bolero', cpkRate: '', allottedKms: '', workingDays: '30', startDate: '', endDate: '', status: 'active' })
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
        workingDays: parseInt(regularForm.workingDays) || 30,
        startDate: regularForm.startDate || null,
        endDate: regularForm.endDate || null,
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
      // Reload regular trips
      const snap = await getDocs(collection(db, 'regular_trips'))
      const list = []
      snap.forEach(d => list.push({ id: d.id, ...d.data() }))
      setRegularTrips(list)
      showToast('Regular trip saved.')
    } catch (err) {
      setError('Failed to save: ' + err.message)
    }
  }

  const handleDeleteRegular = async (id) => {
    try {
      await deleteDoc(doc(db, 'regular_trips', id))
      setRegularTrips(prev => prev.filter(r => r.id !== id))
      showToast('Regular trip deleted.')
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
      workingDays: rt.workingDays || '30',
      startDate: rt.startDate || '',
      endDate: rt.endDate || '',
      status: rt.status || 'active',
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-3">
        <div className="w-8 h-8 border-3 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
        <p className="text-gray-500 text-sm">Loading trips...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast notification */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-gray-900 text-white text-sm rounded-lg shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* Edit Modal */}
      {editingTrip && (
        <TripEditModal
          trip={editingTrip}
          clients={clients}
          vehicles={vehicles}
          locations={locations}
          onSave={handleEditSave}
          onClose={() => setEditingTrip(null)}
          saving={editSaving}
          suggestions={suggestions}
        />
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4 w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Trip</h3>
            <p className="text-sm text-gray-600 mb-1">
              Delete trip on <span className="font-medium">{formatDate(deleteConfirm.date)}</span>?
            </p>
            <p className="text-sm text-gray-600 mb-1">
              {deleteConfirm.vehicle_no} &middot; {deleteConfirm.origin} &rarr; {deleteConfirm.destination}
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
            <h1 className="text-xl font-bold text-gray-900">Trip Logger</h1>
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
            Log Trip
          </button>
          <button
            onClick={() => setActiveTab('view')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'view'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Trip Log ({trips.length})
          </button>
        </div>

        {/* ── LOG TAB ─────────────────────────────────────────────────── */}
        {activeTab === 'log' && (
          <>
            {/* Sub-tabs: Adhoc | Regular */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setLogSubTab('adhoc')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  logSubTab === 'adhoc' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >Adhoc</button>
              <button
                onClick={() => setLogSubTab('regular')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  logSubTab === 'regular' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >Regular ({regularTrips.length})</button>
            </div>

            {logSubTab === 'adhoc' && (
          <TripForm
            clients={clients}
            vehicles={vehicles}
            locations={locations}
            onSave={(data) => {
              handleSingleSave(data)
              // Clear bid prefill params after saving
              if (bidPrefill) setSearchParams({}, { replace: true })
            }}
            autoResetOnSave
            suggestions={suggestions}
            initialValues={bidPrefill ? {
              date: new Date().toISOString().split('T')[0],
              vehicle_no: '',
              vehicle_size: bidPrefill.vehicle_size,
              driver_name: '',
              origin: bidPrefill.origin,
              destination: bidPrefill.destination,
              client_id: bidPrefill.client_id,
              amount: bidPrefill.amount,
              remarks: '',
            } : undefined}
          />
            )}

            {logSubTab === 'regular' && (
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
                        <input type="text" value={regularForm.lane} onChange={e => setRegularForm(f => ({ ...f, lane: e.target.value }))}
                          placeholder="e.g. Patna DC-Sonho DC" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Number</label>
                        <input type="text" value={regularForm.vehicleNo} onChange={e => setRegularForm(f => ({ ...f, vehicleNo: e.target.value }))}
                          placeholder="e.g. BR11GF7516" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Type</label>
                        <select value={regularForm.vehicleType} onChange={e => setRegularForm(f => ({ ...f, vehicleType: e.target.value }))}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                          {VEHICLE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">CPK Rate (₹/km)</label>
                        <input type="number" value={regularForm.cpkRate} onChange={e => setRegularForm(f => ({ ...f, cpkRate: e.target.value }))}
                          placeholder="0" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Allotted KMs (per trip)</label>
                        <input type="number" value={regularForm.allottedKms} onChange={e => setRegularForm(f => ({ ...f, allottedKms: e.target.value }))}
                          placeholder="0" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Working Days/Month</label>
                        <input type="number" value={regularForm.workingDays} onChange={e => setRegularForm(f => ({ ...f, workingDays: e.target.value }))}
                          placeholder="30" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                        <input type="date" value={regularForm.startDate} onChange={e => setRegularForm(f => ({ ...f, startDate: e.target.value }))}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                        <input type="date" value={regularForm.endDate} onChange={e => setRegularForm(f => ({ ...f, endDate: e.target.value }))}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                        <select value={regularForm.status} onChange={e => setRegularForm(f => ({ ...f, status: e.target.value }))}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-3 mt-4">
                      <button onClick={handleSaveRegular} className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm">Save</button>
                      <button onClick={resetRegularForm} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium text-sm">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setEditingRegular('new')} className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm">
                    + Add Regular Trip
                  </button>
                )}

                {/* Regular Trips List */}
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
                            <th className="px-4 py-3 font-medium text-right">CPK</th>
                            <th className="px-4 py-3 font-medium text-right">KMs</th>
                            <th className="px-4 py-3 font-medium text-right">Days</th>
                            <th className="px-4 py-3 font-medium text-right">Est. Revenue</th>
                            <th className="px-4 py-3 font-medium">Period</th>
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
                              <td className="px-4 py-3 text-right text-gray-900">{rt.workingDays || 30}</td>
                              <td className="px-4 py-3 text-right text-gray-900 font-medium">
                                {rt.cpkRate && rt.allottedKms ? formatCurrency((rt.workingDays || 30) * rt.allottedKms * rt.cpkRate) : '—'}
                              </td>
                              <td className="px-4 py-3 text-gray-500 text-xs">
                                {formatDate(rt.startDate)}{rt.endDate ? ` → ${formatDate(rt.endDate)}` : ' → present'}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                                  rt.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                                }`}>{rt.status}</span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex gap-2">
                                  <button onClick={() => handleEditRegular(rt)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Edit</button>
                                  <button onClick={() => handleDeleteRegular(rt.id)} className="text-red-500 hover:text-red-700 text-xs font-medium">Delete</button>
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
          </>
        )}

        {/* ── VIEW TAB ────────────────────────────────────────────────── */}
        {activeTab === 'view' && (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Trips</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{stats.trips}</p>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Total Amount</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(stats.amount)}</p>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Vehicles</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{stats.vehicles}</p>
              </div>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  placeholder="From"
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  placeholder="To"
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <select
                  value={clientFilter}
                  onChange={(e) => setClientFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">All Clients</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.name || c.id}</option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Search vehicle..."
                  value={vehicleSearch}
                  onChange={(e) => setVehicleSearch(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            {/* Results count */}
            <p className="text-sm text-gray-500 mb-3">
              {filteredTrips.length} trip{filteredTrips.length !== 1 ? 's' : ''}
            </p>

            {/* Trips Table */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              {filteredTrips.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-500">
                  {trips.length === 0
                    ? 'No trips logged yet. Switch to the "Log Trip" tab to get started.'
                    : 'No trips match your filters.'
                  }
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-left">
                      <tr>
                        <th className="px-4 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 font-medium">Vehicle</th>
                        <th className="px-4 py-3 font-medium hidden lg:table-cell">Size</th>
                        <th className="px-4 py-3 font-medium hidden xl:table-cell">Driver</th>
                        <th className="px-4 py-3 font-medium hidden sm:table-cell">Origin</th>
                        <th className="px-4 py-3 font-medium hidden sm:table-cell">Destination</th>
                        <th className="px-4 py-3 font-medium">Client</th>
                        <th className="px-4 py-3 font-medium text-right">Amount</th>
                        <th className="px-4 py-3 font-medium w-20"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {filteredTrips.slice(0, 500).map(t => (
                        <tr key={t.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-900 whitespace-nowrap">{formatDate(t.date)}</td>
                          <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{t.vehicle_no || '\u2014'}</td>
                          <td className="px-4 py-3 text-gray-500 hidden lg:table-cell whitespace-nowrap">{t.vehicle_size || '\u2014'}</td>
                          <td className="px-4 py-3 text-gray-500 hidden xl:table-cell">{t.driver_name || '\u2014'}</td>
                          <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{t.origin || '\u2014'}</td>
                          <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{t.destination || '\u2014'}</td>
                          <td className="px-4 py-3 text-gray-500">{t.client_name || t.client_id || '\u2014'}</td>
                          <td className="px-4 py-3 text-gray-900 font-medium text-right whitespace-nowrap">
                            {formatCurrency(t.amount || 0)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setEditingTrip(t)}
                                className="text-gray-400 hover:text-blue-600 transition-colors p-1"
                                title="Edit"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(t)}
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
                  {filteredTrips.length > 500 && (
                    <div className="px-4 py-3 text-center text-sm text-gray-500 bg-gray-50 border-t border-gray-200">
                      Showing first 500 of {filteredTrips.length} trips. Use filters to narrow results.
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
