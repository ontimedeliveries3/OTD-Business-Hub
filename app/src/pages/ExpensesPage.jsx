import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/useAuth'

const CATEGORIES = [
  { value: 'fuel', label: 'Fuel/Diesel' },
  { value: 'driver_salary', label: 'Driver Salary' },
  { value: 'driver_advance', label: 'Driver Advance' },
  { value: 'maintenance', label: 'Vehicle Maintenance' },
  { value: 'tolls', label: 'Tolls' },
  { value: 'penalty', label: 'Penalties/Deductions' },
  { value: 'misc', label: 'Misc' },
]

const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map(c => [c.value, c.label]))

const todayISO = () => new Date().toISOString().split('T')[0]

const formatCurrency = (amt) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amt)

const formatDate = (dateStr) => {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function ExpensesPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const [activeTab, setActiveTab] = useState('log') // log | monthly | settlement
  const [expenses, setExpenses] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  // Form state
  const [category, setCategory] = useState('driver_advance')
  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState('')
  const [vehicleNo, setVehicleNo] = useState('')
  const [driverName, setDriverName] = useState('')
  const [clientId, setClientId] = useState('')
  const [note, setNote] = useState('')

  // Monthly view
  const now = new Date()
  const [viewMonth, setViewMonth] = useState(now.getMonth())
  const [viewYear, setViewYear] = useState(now.getFullYear())

  // Load expenses and vehicles
  useEffect(() => {
    async function load() {
      try {
        const [expSnap, vehSnap] = await Promise.all([
          getDocs(collection(db, 'expenses')),
          getDocs(collection(db, 'vehicles')),
        ])
        const expList = []
        expSnap.forEach(d => expList.push({ id: d.id, ...d.data() }))
        expList.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        setExpenses(expList)

        const vehList = []
        vehSnap.forEach(d => vehList.push({ id: d.id, ...d.data() }))
        vehList.sort((a, b) => (a.number || '').localeCompare(b.number || ''))
        setVehicles(vehList)
      } catch (err) {
        console.error('Failed to load data:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Unique driver names from expenses for suggestions
  const driverSuggestions = useMemo(() => {
    const names = new Set()
    expenses.forEach(e => { if (e.driverName) names.add(e.driverName) })
    return [...names].sort()
  }, [expenses])

  // EMI data from vehicles
  const emiData = useMemo(() => {
    return vehicles
      .filter(v => v.emi && v.emi > 0)
      .map(v => ({ vehicleNo: v.number, vehicleType: v.type, emi: v.emi, ownership: v.ownership }))
  }, [vehicles])

  const totalEmi = useMemo(() => emiData.reduce((sum, v) => sum + v.emi, 0), [emiData])

  // Monthly filtered expenses
  const monthKey = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`
  const monthlyExpenses = useMemo(() => {
    return expenses.filter(e => e.date && e.date.startsWith(monthKey))
  }, [expenses, monthKey])

  // Monthly totals by category
  const monthlyTotals = useMemo(() => {
    const totals = {}
    monthlyExpenses.forEach(e => {
      totals[e.category] = (totals[e.category] || 0) + (e.amount || 0)
    })
    const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0) + totalEmi
    return { ...totals, emi: totalEmi, total: grandTotal }
  }, [monthlyExpenses, totalEmi])

  // Driver settlement data
  const driverSettlement = useMemo(() => {
    const drivers = {}
    monthlyExpenses.forEach(e => {
      if (e.category === 'driver_salary' && e.driverName) {
        if (!drivers[e.driverName]) drivers[e.driverName] = { salary: 0, advances: 0 }
        drivers[e.driverName].salary += e.amount || 0
      }
      if (e.category === 'driver_advance' && e.driverName) {
        if (!drivers[e.driverName]) drivers[e.driverName] = { salary: 0, advances: 0 }
        drivers[e.driverName].advances += e.amount || 0
      }
    })
    return Object.entries(drivers).map(([name, data]) => ({
      name,
      salary: data.salary,
      advances: data.advances,
      netPayable: data.salary - data.advances,
    })).sort((a, b) => a.name.localeCompare(b.name))
  }, [monthlyExpenses])

  // Reset form
  const resetForm = () => {
    setAmount('')
    setVehicleNo('')
    setNote('')
    // Keep category, date, driverName, clientId for rapid re-entry
  }

  // Save expense
  const handleSave = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter an amount.')
      return
    }
    if ((category === 'driver_advance' || category === 'driver_salary') && !driverName.trim()) {
      setError('Please enter a driver name.')
      return
    }
    if ((category === 'fuel' || category === 'maintenance' || category === 'tolls') && !vehicleNo) {
      setError('Please select a vehicle.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const data = {
        category,
        date,
        amount: parseFloat(amount),
        month: date.substring(0, 7), // YYYY-MM for easy querying
        vehicleNo: vehicleNo || null,
        driverName: driverName.trim() || null,
        clientId: clientId || null,
        note: note.trim() || null,
        createdAt: serverTimestamp(),
        createdBy: user.email,
      }
      const docRef = await addDoc(collection(db, 'expenses'), data)
      setExpenses(prev => [{ id: docRef.id, ...data }, ...prev])
      setSuccess(`${CATEGORY_LABELS[category]} — ${formatCurrency(parseFloat(amount))} saved`)
      resetForm()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError('Failed to save: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  // Delete expense
  const handleDelete = async (id) => {
    if (!confirm('Delete this expense?')) return
    try {
      await deleteDoc(doc(db, 'expenses', id))
      setExpenses(prev => prev.filter(e => e.id !== id))
    } catch (err) {
      setError('Failed to delete: ' + err.message)
    }
  }

  // Conditional fields based on category
  const showVehicle = ['fuel', 'maintenance', 'tolls'].includes(category)
  const showDriver = ['driver_salary', 'driver_advance'].includes(category)
  const showClient = category === 'penalty'
  const showNote = ['maintenance', 'penalty', 'misc'].includes(category)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700">&larr; Dashboard</button>
            <h1 className="text-xl font-bold text-gray-900">Expense Tracker</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500 hidden sm:inline">{user.email}</span>
            <button onClick={logout} className="text-sm text-red-600 hover:text-red-800 font-medium">Sign Out</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex justify-between items-center">
            {error} <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">&times;</button>
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm flex justify-between items-center">
            {success} <button onClick={() => setSuccess(null)} className="text-green-400 hover:text-green-600">&times;</button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-6">
          {[
            { key: 'log', label: 'Log Expense' },
            { key: 'monthly', label: 'Monthly View' },
            { key: 'settlement', label: 'Settlement' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >{tab.label}</button>
          ))}
        </div>

        {/* ── LOG TAB ─────────────────────────────────── */}
        {activeTab === 'log' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Category */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select value={category} onChange={e => setCategory(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>

                {/* Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹)</label>
                  <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                    placeholder="0" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                </div>

                {/* Vehicle (conditional) */}
                {showVehicle && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle</label>
                    <select value={vehicleNo} onChange={e => setVehicleNo(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                      <option value="">Select vehicle...</option>
                      {vehicles.map(v => (
                        <option key={v.id} value={v.number}>{v.number} ({v.type})</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Driver (conditional) */}
                {showDriver && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Driver Name</label>
                    <input type="text" value={driverName} onChange={e => setDriverName(e.target.value)}
                      list="driver-suggestions" placeholder="e.g. Subhash"
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                    <datalist id="driver-suggestions">
                      {driverSuggestions.map(n => <option key={n} value={n} />)}
                    </datalist>
                  </div>
                )}

                {/* Client (conditional - penalties) */}
                {showClient && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
                    <select value={clientId} onChange={e => setClientId(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                      <option value="">Select client...</option>
                      <option value="shadowfax">Shadowfax</option>
                      <option value="meesho">Meesho</option>
                    </select>
                  </div>
                )}

                {/* Note (conditional) */}
                {showNote && (
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Details (optional)</label>
                    <input type="text" value={note} onChange={e => setNote(e.target.value)}
                      placeholder={category === 'misc' ? 'e.g. CA fees, phone recharge' : 'e.g. Tyre replacement, brake pad'}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                  </div>
                )}
              </div>

              <button onClick={handleSave} disabled={saving}
                className="mt-4 w-full sm:w-auto px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Expense'}
              </button>
            </div>

            {/* Recent expenses */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700">Recent Expenses</h3>
              </div>
              {loading ? (
                <div className="px-6 py-8 text-center text-gray-500 text-sm">Loading...</div>
              ) : expenses.length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-500 text-sm">No expenses logged yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-left">
                      <tr>
                        <th className="px-4 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 font-medium">Category</th>
                        <th className="px-4 py-3 font-medium">Details</th>
                        <th className="px-4 py-3 font-medium text-right">Amount</th>
                        <th className="px-4 py-3 font-medium w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {expenses.slice(0, 20).map(e => (
                        <tr key={e.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(e.date)}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                              e.category === 'driver_advance' ? 'bg-orange-100 text-orange-800' :
                              e.category === 'fuel' ? 'bg-yellow-100 text-yellow-800' :
                              e.category === 'penalty' ? 'bg-red-100 text-red-800' :
                              e.category === 'driver_salary' ? 'bg-blue-100 text-blue-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>{CATEGORY_LABELS[e.category] || e.category}</span>
                          </td>
                          <td className="px-4 py-3 text-gray-600 text-xs">
                            {e.driverName || ''}{e.driverName && e.vehicleNo ? ' · ' : ''}{e.vehicleNo || ''}{e.note ? ` — ${e.note}` : ''}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">{formatCurrency(e.amount)}</td>
                          <td className="px-4 py-3">
                            <button onClick={() => handleDelete(e.id)} className="text-gray-400 hover:text-red-600 text-xs">Del</button>
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

        {/* ── MONTHLY VIEW TAB ─────────────────────────── */}
        {activeTab === 'monthly' && (
          <div className="space-y-6">
            {/* Month selector */}
            <div className="flex items-center gap-3">
              <select value={viewMonth} onChange={e => setViewMonth(parseInt(e.target.value))}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
              </select>
              <input type="number" value={viewYear} onChange={e => setViewYear(parseInt(e.target.value))}
                min={2024} max={2030}
                className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {CATEGORIES.map(c => (
                <div key={c.value} className="bg-white rounded-lg shadow-sm border border-gray-200 p-3">
                  <p className="text-xs text-gray-500">{c.label}</p>
                  <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(monthlyTotals[c.value] || 0)}</p>
                </div>
              ))}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3">
                <p className="text-xs text-gray-500">EMI (auto)</p>
                <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(totalEmi)}</p>
              </div>
            </div>

            {/* Grand total */}
            <div className="bg-blue-50 rounded-lg border border-blue-200 p-4 flex justify-between items-center">
              <span className="font-medium text-blue-900">Total Expenses — {MONTHS[viewMonth]} {viewYear}</span>
              <span className="text-xl font-bold text-blue-900">{formatCurrency(monthlyTotals.total)}</span>
            </div>

            {/* EMI breakdown */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700">EMI Breakdown (auto from vehicle data)</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Vehicle</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Ownership</th>
                      <th className="px-4 py-3 font-medium text-right">Monthly EMI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {emiData.map(v => (
                      <tr key={v.vehicleNo} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{v.vehicleNo}</td>
                        <td className="px-4 py-3 text-gray-500">{v.vehicleType}</td>
                        <td className="px-4 py-3 text-gray-500">{v.ownership}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(v.emi)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                    <tr className="font-semibold text-gray-900">
                      <td className="px-4 py-3" colSpan={3}>Total EMI</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(totalEmi)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Monthly expense list */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700">{monthlyExpenses.length} expenses in {MONTHS[viewMonth]} {viewYear}</h3>
              </div>
              {monthlyExpenses.length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-500 text-sm">No expenses logged for this month.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-left">
                      <tr>
                        <th className="px-4 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 font-medium">Category</th>
                        <th className="px-4 py-3 font-medium">Details</th>
                        <th className="px-4 py-3 font-medium text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {monthlyExpenses.map(e => (
                        <tr key={e.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(e.date)}</td>
                          <td className="px-4 py-3 text-gray-600">{CATEGORY_LABELS[e.category] || e.category}</td>
                          <td className="px-4 py-3 text-gray-600 text-xs">
                            {e.driverName || ''}{e.vehicleNo ? ` · ${e.vehicleNo}` : ''}{e.note ? ` — ${e.note}` : ''}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(e.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── SETTLEMENT TAB ───────────────────────────── */}
        {activeTab === 'settlement' && (
          <div className="space-y-6">
            {/* Month selector */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600 font-medium">Settlement for:</span>
              <select value={viewMonth} onChange={e => setViewMonth(parseInt(e.target.value))}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
              </select>
              <input type="number" value={viewYear} onChange={e => setViewYear(parseInt(e.target.value))}
                min={2024} max={2030}
                className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>

            {driverSettlement.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-6 py-12 text-center text-gray-500 text-sm">
                No driver salary or advance data for {MONTHS[viewMonth]} {viewYear}. Log driver salaries and advances in the Log Expense tab first.
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-700">Driver Settlement — {MONTHS[viewMonth]} {viewYear}</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-left">
                      <tr>
                        <th className="px-4 py-3 font-medium">Driver</th>
                        <th className="px-4 py-3 font-medium text-right">Monthly Salary</th>
                        <th className="px-4 py-3 font-medium text-right">Total Advances</th>
                        <th className="px-4 py-3 font-medium text-right">Net Payable</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {driverSettlement.map(d => (
                        <tr key={d.name} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{d.name}</td>
                          <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(d.salary)}</td>
                          <td className="px-4 py-3 text-right text-orange-600">{d.advances > 0 ? `- ${formatCurrency(d.advances)}` : '—'}</td>
                          <td className={`px-4 py-3 text-right font-bold ${d.netPayable < 0 ? 'text-red-600' : 'text-green-700'}`}>
                            {formatCurrency(d.netPayable)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                      <tr className="font-semibold text-gray-900">
                        <td className="px-4 py-3">Total</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(driverSettlement.reduce((s, d) => s + d.salary, 0))}</td>
                        <td className="px-4 py-3 text-right text-orange-600">- {formatCurrency(driverSettlement.reduce((s, d) => s + d.advances, 0))}</td>
                        <td className="px-4 py-3 text-right font-bold text-green-700">{formatCurrency(driverSettlement.reduce((s, d) => s + d.netPayable, 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
