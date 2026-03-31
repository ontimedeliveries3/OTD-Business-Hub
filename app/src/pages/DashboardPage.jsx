import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import DateInput from '../components/DateInput'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/useAuth'
import TripPnLView from '../components/TripPnLView'

export default function DashboardPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [trips, setTrips] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [clients, setClients] = useState([])
  const [nonRunningDays, setNonRunningDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filters
  const [dateFrom, setDateFrom] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [dateTo, setDateTo] = useState('')
  const [clientFilter, setClientFilter] = useState('all')
  const [vehicleSearch, setVehicleSearch] = useState('')

  useEffect(() => {
    async function init() {
      try {
        const [tripsSnap, vehiclesSnap, clientsSnap, nrdSnap] = await Promise.all([
          getDocs(collection(db, 'trips')),
          getDocs(collection(db, 'vehicles')),
          getDocs(collection(db, 'clients')),
          getDocs(collection(db, 'non_running_days')),
        ])

        const tripsList = []
        tripsSnap.forEach(d => tripsList.push({ id: d.id, ...d.data() }))
        tripsList.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        setTrips(tripsList)

        const vehList = []
        vehiclesSnap.forEach(d => vehList.push({ id: d.id, ...d.data() }))
        setVehicles(vehList)

        const clientsList = []
        clientsSnap.forEach(d => clientsList.push({ id: d.id, ...d.data() }))
        setClients(clientsList)

        const nrdList = []
        nrdSnap.forEach(d => nrdList.push({ id: d.id, ...d.data() }))
        setNonRunningDays(nrdList)

        setError(null)
      } catch (err) {
        console.error('Dashboard load error:', err)
        setError('Failed to load dashboard data.')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  // Filtered trips
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

  // Filtered non-running days
  const filteredNrd = useMemo(() => {
    return nonRunningDays.filter(n => {
      if (dateFrom && n.date < dateFrom) return false
      if (dateTo && n.date > dateTo) return false
      if (vehicleSearch) {
        const q = vehicleSearch.toUpperCase()
        if (!(n.vehicle_no || '').toUpperCase().includes(q)) return false
      }
      return true
    })
  }, [nonRunningDays, dateFrom, dateTo, vehicleSearch])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">OTD Business Hub</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500 hidden sm:inline">{user.email}</span>
            <button onClick={logout} className="text-sm text-red-600 hover:text-red-800 font-medium py-2">
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => window.location.reload()}
              className="ml-4 px-3 py-1 bg-red-100 hover:bg-red-200 rounded text-red-800 font-medium text-xs">
              Retry
            </button>
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          <button onClick={() => navigate('/bids')}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-left hover:border-blue-300 hover:shadow transition-all group">
            <div className="flex items-center gap-3">
              <span className="text-xl">&#127919;</span>
              <div>
                <p className="font-medium text-sm text-gray-900 group-hover:text-blue-600">Bids</p>
              </div>
            </div>
          </button>
          <button onClick={() => navigate('/trips')}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-left hover:border-blue-300 hover:shadow transition-all group">
            <div className="flex items-center gap-3">
              <span className="text-xl">&#128666;</span>
              <div>
                <p className="font-medium text-sm text-gray-900 group-hover:text-blue-600">Trips</p>
              </div>
            </div>
          </button>
          <button onClick={() => navigate('/mis')}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-left hover:border-blue-300 hover:shadow transition-all group">
            <div className="flex items-center gap-3">
              <span className="text-xl">&#128202;</span>
              <div>
                <p className="font-medium text-sm text-gray-900 group-hover:text-blue-600">MIS</p>
              </div>
            </div>
          </button>
          <button onClick={() => navigate('/expenses')}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-left hover:border-blue-300 hover:shadow transition-all group">
            <div className="flex items-center gap-3">
              <span className="text-xl">&#128176;</span>
              <div>
                <p className="font-medium text-sm text-gray-900 group-hover:text-blue-600">Expenses</p>
              </div>
            </div>
          </button>
          <button onClick={() => navigate('/invoices')}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-left hover:border-blue-300 hover:shadow transition-all group">
            <div className="flex items-center gap-3">
              <span className="text-xl">&#128196;</span>
              <div>
                <p className="font-medium text-sm text-gray-900 group-hover:text-blue-600">Invoices</p>
              </div>
            </div>
          </button>
        </div>

        {/* P&L Section */}
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Trip P&L</h2>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <DateInput value={dateFrom} onChange={setDateFrom}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            <DateInput value={dateTo} onChange={setDateTo} placeholder="DD/MM/YYYY"
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              <option value="all">All Clients</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
            </select>
            <input type="text" placeholder="Vehicle no..." value={vehicleSearch}
              onChange={(e) => setVehicleSearch(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-gray-400 text-sm">
            Loading...
          </div>
        ) : (
          <TripPnLView
            trips={filteredTrips}
            vehicles={vehicles}
            nonRunningDays={filteredNrd}
          />
        )}
      </main>
    </div>
  )
}
