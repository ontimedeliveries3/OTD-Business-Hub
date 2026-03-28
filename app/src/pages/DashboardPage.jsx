import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, orderBy, limit, doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/useAuth'

export default function DashboardPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState({ totalInvoices: 0, totalRevenue: 0, lastInvoice: '—', fiscalYear: '—' })
  const [recentInvoices, setRecentInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function init() {
      try {
        // Fetch counters for last invoice number
        const countersSnap = await getDoc(doc(db, 'config', 'counters'))
        const counters = countersSnap.data()
        const fy = counters?.current_fy || '25-26'

        // Fetch invoices for this FY
        const invoicesRef = collection(db, 'invoices')
        // Fetch recent 10 invoices (fast, limited query)
        const recentQuery = query(invoicesRef, where('fiscal_year', '==', fy), orderBy('created_at', 'desc'), limit(10))
        const recentSnap = await getDocs(recentQuery)

        const recent = []
        let totalRevenue = 0
        let lastInvoice = '—'

        recentSnap.forEach((doc) => {
          const data = doc.data()
          recent.push({ id: doc.id, ...data })
          if (data.status !== 'draft') {
            totalRevenue += data.grand_total || 0
            if (lastInvoice === '—' && data.invoice_number) {
              lastInvoice = data.invoice_number
            }
          }
        })

        setStats({
          totalInvoices: recentSnap.size,
          totalRevenue,
          lastInvoice,
          fiscalYear: fy,
        })
        setRecentInvoices(recent)
        setError(null)
      } catch (err) {
        console.error('Dashboard load error:', err)
        setError('Failed to load dashboard data. Please check your connection and try again.')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">OTD Business Hub</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500 hidden sm:inline">{user.email}</span>
            <button
              onClick={logout}
              className="text-sm text-red-600 hover:text-red-800 font-medium py-2"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl sm:text-2xl font-semibold text-gray-900">Dashboard</h2>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => window.location.reload()}
              className="ml-4 px-3 py-1 bg-red-100 hover:bg-red-200 rounded text-red-800 font-medium text-xs"
            >
              Retry
            </button>
          </div>
        )}

        {/* Quick Actions — render immediately, no data dependency */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
              <button
                onClick={() => navigate('/bids')}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 text-left hover:border-blue-300 hover:shadow transition-all group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">&#127919;</span>
                  <div>
                    <p className="font-medium text-gray-900 group-hover:text-blue-600">Bid Tracker</p>
                    <p className="text-sm text-gray-500">Log & track bids</p>
                  </div>
                </div>
              </button>
              <button
                onClick={() => navigate('/trips')}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 text-left hover:border-blue-300 hover:shadow transition-all group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">&#128666;</span>
                  <div>
                    <p className="font-medium text-gray-900 group-hover:text-blue-600">Trip Logger</p>
                    <p className="text-sm text-gray-500">Log & view trips</p>
                  </div>
                </div>
              </button>
              <button
                onClick={() => navigate('/mis')}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 text-left hover:border-blue-300 hover:shadow transition-all group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📊</span>
                  <div>
                    <p className="font-medium text-gray-900 group-hover:text-blue-600">MIS Dashboard</p>
                    <p className="text-sm text-gray-500">Import & view trip data</p>
                  </div>
                </div>
              </button>
              <button
                onClick={() => navigate('/expenses')}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 text-left hover:border-blue-300 hover:shadow transition-all group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">&#128176;</span>
                  <div>
                    <p className="font-medium text-gray-900 group-hover:text-blue-600">Expenses</p>
                    <p className="text-sm text-gray-500">Track costs & settlements</p>
                  </div>
                </div>
              </button>
              <button
                onClick={() => navigate('/invoices')}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 text-left hover:border-blue-300 hover:shadow transition-all group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📄</span>
                  <div>
                    <p className="font-medium text-gray-900 group-hover:text-blue-600">Invoices</p>
                    <p className="text-sm text-gray-500">Create & manage invoices</p>
                  </div>
                </div>
              </button>
            </div>

            {/* Summary Cards — show skeleton while loading */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 sm:p-6">
                <p className="text-sm text-gray-500">Invoices (FY {stats.fiscalYear})</p>
                <p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-1">{loading ? '...' : stats.totalInvoices}</p>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 sm:p-6">
                <p className="text-sm text-gray-500">Total Revenue</p>
                <p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-1">{loading ? '...' : formatCurrency(stats.totalRevenue)}</p>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 sm:p-6">
                <p className="text-sm text-gray-500">Last Invoice</p>
                <p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-1">{loading ? '...' : stats.lastInvoice}</p>
              </div>
            </div>

            {/* Recent Invoices */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-4 sm:px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">Recent Invoices</h3>
                <button
                  onClick={() => navigate('/invoices')}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium py-1"
                >
                  View All &rarr;
                </button>
              </div>
              {loading ? (
                <div className="px-6 py-8 text-center text-gray-400 text-sm">Loading...</div>
              ) : recentInvoices.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-500">
                  <p>No invoices yet. Create your first invoice to get started.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-left">
                      <tr>
                        <th className="px-4 sm:px-6 py-3 font-medium">Invoice #</th>
                        <th className="px-4 sm:px-6 py-3 font-medium hidden sm:table-cell">Date</th>
                        <th className="px-4 sm:px-6 py-3 font-medium">Client</th>
                        <th className="px-4 sm:px-6 py-3 font-medium text-right">Amount</th>
                        <th className="px-4 sm:px-6 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {recentInvoices.map((inv) => (
                        <tr
                          key={inv.id}
                          className="hover:bg-gray-50 cursor-pointer active:bg-gray-100"
                          onClick={() => {
                            if (inv.status === 'draft') {
                              navigate(`/invoices/${inv.id}/edit`)
                            } else if (inv.pdf_url) {
                              window.open(inv.pdf_url, '_blank')
                            }
                          }}
                        >
                          <td className="px-4 sm:px-6 py-3.5 font-medium text-gray-900 whitespace-nowrap">
                            {inv.invoice_number || 'Draft'}
                          </td>
                          <td className="px-4 sm:px-6 py-3.5 text-gray-500 hidden sm:table-cell">{inv.invoice_date || '—'}</td>
                          <td className="px-4 sm:px-6 py-3.5 text-gray-500">{inv.client_name || '—'}</td>
                          <td className="px-4 sm:px-6 py-3.5 text-gray-900 text-right whitespace-nowrap">
                            {inv.grand_total ? formatCurrency(inv.grand_total) : '—'}
                          </td>
                          <td className="px-4 sm:px-6 py-3.5">
                            <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                              inv.status === 'generated' ? 'bg-green-100 text-green-800' :
                              inv.status === 'draft' ? 'bg-yellow-100 text-yellow-800' :
                              inv.status === 'sent' ? 'bg-blue-100 text-blue-800' :
                              inv.status === 'paid' ? 'bg-purple-100 text-purple-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {inv.status || 'unknown'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
      </main>
    </div>
  )
}
