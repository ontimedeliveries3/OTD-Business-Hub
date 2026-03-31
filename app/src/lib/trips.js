export const todayISO = () => new Date().toISOString().split('T')[0]

// ── Trip expense categories (entered per trip) ─────────────────────────────

export const TRIP_EXPENSE_CATEGORIES = [
  { value: 'diesel',         label: 'Diesel' },
  { value: 'fastag',         label: 'FASTag' },
  { value: 'toll',           label: 'Toll/Nagarpalika' },
  { value: 'maintenance',    label: 'Maintenance' },
]

// ── Empty trip template ─────────────────────────────────────────────────────

export const emptyTrip = () => ({
  date: todayISO(),
  vehicle_no: '',
  vehicle_size: '',
  driver_name: '',
  origin: '',
  destination: '',
  client_id: '',
  amount: '',
  trip_type: '',
  trip_id: '',
  remarks: '',
  sfec_request_id: '',
  expenses: {
    diesel: '',
    fastag: '',
    toll: '',
    maintenance: '',
  },
  expenses_total: 0,
})

// ── Compute expenses total from expenses map ────────────────────────────────

export function computeExpensesTotal(expenses) {
  if (!expenses) return 0
  return Object.values(expenses).reduce((sum, v) => sum + (parseFloat(v) || 0), 0)
}

// ── Compute trip P&L ────────────────────────────────────────────────────────

export function computeTripProfit(trip, vehicle) {
  const revenue = parseFloat(trip.amount) || 0
  const directExpenses = trip.expenses_total || 0
  const dailyFixed = vehicle?.daily_fixed_cost || 0

  const totalCost = directExpenses + dailyFixed
  const profit = revenue - totalCost
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0

  return { revenue, directExpenses, dailyFixed, totalCost, profit, margin }
}

// ── Non-running day reasons ─────────────────────────────────────────────────

export const NON_RUNNING_REASONS = [
  { value: 'no_load', label: 'No Load' },
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'driver_leave', label: 'Driver Leave' },
  { value: 'other', label: 'Other' },
]
