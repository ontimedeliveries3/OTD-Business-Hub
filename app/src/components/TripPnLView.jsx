import { useMemo } from 'react'
import { computeTripProfit, TRIP_EXPENSE_CATEGORIES } from '../lib/trips'

const formatCurrency = (amt) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amt)

const formatDate = (dateStr) => {
  if (!dateStr) return '\u2014'
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

export default function TripPnLView({ trips, vehicles, nonRunningDays = [] }) {
  // Build vehicle lookup
  const vehicleMap = useMemo(() => {
    const map = new Map()
    vehicles.forEach(v => map.set(v.number, v))
    return map
  }, [vehicles])

  // Compute P&L for each trip
  const tripsPnL = useMemo(() => {
    return trips.map(t => {
      const vehicle = vehicleMap.get(t.vehicle_no)
      const pnl = computeTripProfit(t, vehicle)
      return { ...t, pnl, vehicle }
    })
  }, [trips, vehicleMap])

  // Non-running day entries with daily fixed cost
  const nrdEntries = useMemo(() => {
    return nonRunningDays.map(nrd => {
      const vehicle = vehicleMap.get(nrd.vehicle_no)
      const dailyFixed = vehicle?.daily_fixed_cost || 0
      return { ...nrd, dailyFixed, vehicle, _isNonRunning: true }
    })
  }, [nonRunningDays, vehicleMap])

  // Summary stats
  const summary = useMemo(() => {
    let totalRevenue = 0
    let totalDirectExpenses = 0
    let totalDailyFixed = 0

    tripsPnL.forEach(t => {
      totalRevenue += t.pnl.revenue
      totalDirectExpenses += t.pnl.directExpenses
      totalDailyFixed += t.pnl.dailyFixed
    })

    // Add non-running days fixed cost
    nrdEntries.forEach(n => {
      totalDailyFixed += n.dailyFixed
    })

    const totalCost = totalDirectExpenses + totalDailyFixed
    const totalProfit = totalRevenue - totalCost
    const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

    return { totalRevenue, totalDirectExpenses, totalDailyFixed, totalCost, totalProfit, margin }
  }, [tripsPnL, nrdEntries])

  // Combine trips and non-running days, sort by date desc
  const allEntries = useMemo(() => {
    const combined = [
      ...tripsPnL.map(t => ({ type: 'trip', date: t.date, data: t })),
      ...nrdEntries.map(n => ({ type: 'nrd', date: n.date, data: n })),
    ]
    combined.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    return combined
  }, [tripsPnL, nrdEntries])

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-xs text-gray-500">Revenue</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(summary.totalRevenue)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-xs text-gray-500">Direct Costs</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(summary.totalDirectExpenses)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-xs text-gray-500">Fixed Costs</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(summary.totalDailyFixed)}</p>
        </div>
        <div className={`bg-white rounded-lg shadow-sm border p-4 ${summary.totalProfit >= 0 ? 'border-green-200' : 'border-red-200'}`}>
          <p className="text-xs text-gray-500">Profit</p>
          <p className={`text-xl font-bold mt-1 ${summary.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(summary.totalProfit)}
            <span className="text-xs font-normal text-gray-400 ml-1">
              ({summary.margin >= 0 ? '+' : ''}{summary.margin.toFixed(0)}%)
            </span>
          </p>
        </div>
      </div>

      {/* Entries count */}
      <p className="text-sm text-gray-500">
        {trips.length} trip{trips.length !== 1 ? 's' : ''}
        {nrdEntries.length > 0 && ` + ${nrdEntries.length} idle day${nrdEntries.length !== 1 ? 's' : ''}`}
      </p>

      {/* Per-trip P&L cards */}
      {allEntries.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-gray-500">
          No trips in this period. Log trips to see P&L.
        </div>
      ) : (
        <div className="space-y-3">
          {allEntries.map((entry, i) => {
            if (entry.type === 'nrd') {
              const n = entry.data
              return (
                <div key={`nrd-${n.id || i}`} className="bg-white rounded-lg shadow-sm border border-red-200 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{formatDate(n.date)}</span>
                      <span className="text-xs text-gray-500">{n.vehicle_no}</span>
                      {n.vehicle && <span className="text-xs text-gray-400">{n.vehicle.size}</span>}
                    </div>
                    <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded font-medium">Idle</span>
                  </div>
                  <p className="text-xs text-gray-500 mb-2">{n.reason || 'No load'}{n.note ? ` \u2014 ${n.note}` : ''}</p>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Daily fixed cost</span>
                    <span className="font-medium text-red-600">-{formatCurrency(n.dailyFixed)}</span>
                  </div>
                </div>
              )
            }

            const t = entry.data
            const { pnl } = t
            const hasExpenses = t.expenses_total > 0

            return (
              <div key={t.id || i} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">{formatDate(t.date)}</span>
                    <span className="text-xs text-gray-500">{t.vehicle_no}</span>
                    {t.vehicle_size && <span className="text-xs text-gray-400">{t.vehicle_size}</span>}
                  </div>
                  <span className={`text-sm font-bold ${pnl.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {pnl.profit >= 0 ? '+' : ''}{formatCurrency(pnl.profit)}
                  </span>
                </div>

                {/* Route */}
                {(t.origin || t.destination) && (
                  <p className="text-xs text-gray-500 mb-2">
                    {t.origin || '?'} &rarr; {t.destination || '?'}
                    {t.client_name && <span className="ml-2 text-gray-400">&middot; {t.client_name}</span>}
                  </p>
                )}

                {/* P&L breakdown */}
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Revenue</span>
                    <span className="text-gray-900 font-medium">{pnl.revenue > 0 ? formatCurrency(pnl.revenue) : '\u2014'}</span>
                  </div>

                  {hasExpenses && (
                    <>
                      {TRIP_EXPENSE_CATEGORIES.map(cat => {
                        const val = t.expenses?.[cat.value]
                        if (!val || val === 0) return null
                        return (
                          <div key={cat.value} className="flex justify-between">
                            <span className="text-gray-400 text-xs">{cat.label}</span>
                            <span className="text-gray-600 text-xs">-{formatCurrency(val)}</span>
                          </div>
                        )
                      })}
                    </>
                  )}

                  {pnl.dailyFixed > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400 text-xs">Daily fixed cost</span>
                      <span className="text-gray-600 text-xs">-{formatCurrency(pnl.dailyFixed)}</span>
                    </div>
                  )}

                  {!hasExpenses && pnl.dailyFixed === 0 && (
                    <p className="text-xs text-gray-400 italic">No expenses logged</p>
                  )}

                  {/* Profit bar */}
                  {pnl.revenue > 0 && (
                    <div className="pt-1">
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${pnl.margin >= 0 ? 'bg-green-400' : 'bg-red-400'}`}
                          style={{ width: `${Math.min(Math.abs(pnl.margin), 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-400 text-right mt-0.5">
                        {pnl.margin >= 0 ? '+' : ''}{pnl.margin.toFixed(1)}% margin
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
