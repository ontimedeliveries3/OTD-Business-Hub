import { useState, useMemo } from 'react'
import { emptyTrip, TRIP_EXPENSE_CATEGORIES, computeExpensesTotal } from '../lib/trips'
import DateInput from './DateInput'

export default function TripForm({
  clients = [],
  vehicles = [],
  locations = [],
  initialValues,
  onSave,
  onChange,
  compact = false,
  onRemove,
  showRemove = false,
  autoResetOnSave = false,
  rowNumber,
  suggestions = {},
}) {
  const [form, setForm] = useState(initialValues || emptyTrip())
  const [errors, setErrors] = useState({})
  const [showRemarks, setShowRemarks] = useState(!!(initialValues?.remarks))
  const [showExpenses, setShowExpenses] = useState(() => {
    if (!initialValues?.expenses) return false
    return Object.values(initialValues.expenses).some(v => v && parseFloat(v) > 0)
  })

  // Derive unique vehicle sizes from vehicles list
  const vehicleSizes = useMemo(() => {
    const sizes = [...new Set(vehicles.map(v => v.size))]
    sizes.sort()
    return sizes
  }, [vehicles])

  // Filter vehicle numbers by selected size
  const filteredVehicles = useMemo(() => {
    if (!form.vehicle_size) return vehicles
    return vehicles.filter(v => v.size === form.vehicle_size)
  }, [vehicles, form.vehicle_size])

  const updateField = (field, value) => {
    let updated = { ...form, [field]: value }

    // When vehicle size changes, clear vehicle_no if it doesn't match
    if (field === 'vehicle_size' && form.vehicle_no) {
      const match = vehicles.find(v => v.number === form.vehicle_no)
      if (match && match.size !== value) {
        updated.vehicle_no = ''
      }
    }

    // When vehicle number is selected, auto-fill vehicle size
    if (field === 'vehicle_no' && value) {
      const match = vehicles.find(v => v.number === value.toUpperCase())
      if (match) {
        updated.vehicle_size = match.size
      }
    }

    setForm(updated)
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: null }))
    if (onChange) onChange(updated)
  }

  const updateExpense = (key, value) => {
    const updated = { ...form, expenses: { ...form.expenses, [key]: value } }
    setForm(updated)
    if (onChange) onChange(updated)
  }

  const validate = () => {
    const errs = {}
    if (!form.vehicle_no.trim()) errs.vehicle_no = 'Required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSave = () => {
    if (!validate()) return

    const client = clients.find(c => c.id === form.client_id)
    const expenses = {}
    for (const cat of TRIP_EXPENSE_CATEGORIES) {
      expenses[cat.value] = parseFloat(form.expenses?.[cat.value]) || 0
    }
    const expenses_total = computeExpensesTotal(expenses)

    const tripData = {
      date: form.date,
      vehicle_no: form.vehicle_no.trim().toUpperCase(),
      vehicle_size: form.vehicle_size,
      driver_name: form.driver_name.trim(),
      origin: form.origin.trim(),
      destination: form.destination.trim(),
      client_id: form.client_id,
      client_name: client?.name || form.client_id || '',
      amount: parseFloat(form.amount) || 0,
      trip_type: form.trip_type || '',
      trip_id: (form.trip_id || '').trim(),
      remarks: form.remarks.trim(),
      sfec_request_id: form.sfec_request_id || '',
      expenses,
      expenses_total,
    }

    onSave?.(tripData)

    if (autoResetOnSave) {
      setForm({
        ...emptyTrip(),
        date: tripData.date,
        client_id: form.client_id,
        vehicle_size: form.vehicle_size,
      })
      setErrors({})
      setShowRemarks(false)
      setShowExpenses(false)
    }
  }

  const fieldClass = (field) =>
    `w-full px-3 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
      errors[field] ? 'border-red-400 bg-red-50' : 'border-gray-300'
    }`

  const labelClass = compact ? 'sr-only' : 'block text-sm font-medium text-gray-700 mb-1'

  // Datalist IDs (unique per instance)
  const listId = (name) => `dl-${name}-${rowNumber || 'main'}`

  // Render datalists for autocomplete
  const datalists = (
    <>
      {suggestions.driver_name?.length > 0 && (
        <datalist id={listId('driver')}>
          {suggestions.driver_name.map(v => <option key={v} value={v} />)}
        </datalist>
      )}
      {suggestions.origins?.length > 0 && (
        <datalist id={listId('origin')}>
          {suggestions.origins.map(v => <option key={v} value={v} />)}
        </datalist>
      )}
      {suggestions.destinations?.length > 0 && (
        <datalist id={listId('destination')}>
          {suggestions.destinations.map(v => <option key={v} value={v} />)}
        </datalist>
      )}
    </>
  )

  // Compact mode: card wrapper for bulk entry
  if (compact) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 relative">
        {datalists}
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-gray-400">Trip {rowNumber}</span>
          {showRemove && (
            <button
              onClick={onRemove}
              className="text-gray-400 hover:text-red-500 text-lg leading-none px-1"
              title="Remove"
            >
              &times;
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className={labelClass}>Date</label>
            <DateInput
              value={form.date}
              onChange={(v) => updateField('date', v)}
              className={fieldClass('date')}
            />
          </div>
          <div>
            <label className={labelClass}>Client</label>
            <select
              value={form.client_id}
              onChange={(e) => updateField('client_id', e.target.value)}
              className={fieldClass('client_id')}
            >
              <option value="">Client...</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name || c.id}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Vehicle Size</label>
            <select
              value={form.vehicle_size}
              onChange={(e) => updateField('vehicle_size', e.target.value)}
              className={fieldClass('vehicle_size')}
            >
              <option value="">Size...</option>
              {vehicleSizes.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Vehicle</label>
            <select
              value={form.vehicle_no}
              onChange={(e) => updateField('vehicle_no', e.target.value)}
              className={fieldClass('vehicle_no')}
            >
              <option value="">Vehicle...</option>
              {filteredVehicles.map(v => (
                <option key={v.number} value={v.number}>{v.number}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Origin</label>
            <input
              type="text"
              placeholder="Origin..."
              value={form.origin}
              onChange={(e) => updateField('origin', e.target.value)}
              list={listId('origin')}
              className={fieldClass('origin')}
            />
          </div>
          <div>
            <label className={labelClass}>Destination</label>
            <input
              type="text"
              placeholder="Destination..."
              value={form.destination}
              onChange={(e) => updateField('destination', e.target.value)}
              list={listId('destination')}
              className={fieldClass('destination')}
            />
          </div>
          <div>
            <label className={labelClass}>Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">&#8377;</span>
              <input
                type="number"
                inputMode="numeric"
                placeholder="Amount"
                value={form.amount}
                onChange={(e) => updateField('amount', e.target.value)}
                className={`${fieldClass('amount')} pl-7`}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Full mode: single trip entry form
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 sm:p-6 pb-24 sm:pb-6">
      {datalists}
      <div className="space-y-4">
        {/* Row 1: Date + Client */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Date</label>
            <DateInput
              value={form.date}
              onChange={(v) => updateField('date', v)}
              className={fieldClass('date')}
            />
          </div>
          <div>
            <label className={labelClass}>Client</label>
            <select
              value={form.client_id}
              onChange={(e) => updateField('client_id', e.target.value)}
              className={fieldClass('client_id')}
            >
              <option value="">Select client...</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name || c.id}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 2: Vehicle Size + Vehicle Number */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Vehicle Size</label>
            <select
              value={form.vehicle_size}
              onChange={(e) => updateField('vehicle_size', e.target.value)}
              className={fieldClass('vehicle_size')}
            >
              <option value="">Select size...</option>
              {vehicleSizes.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Vehicle Number <span className="text-red-500">*</span></label>
            <select
              value={form.vehicle_no}
              onChange={(e) => updateField('vehicle_no', e.target.value)}
              className={fieldClass('vehicle_no')}
            >
              <option value="">
                {form.vehicle_size
                  ? `Select ${form.vehicle_size} vehicle...`
                  : 'Select vehicle...'}
              </option>
              {filteredVehicles.map(v => (
                <option key={v.number} value={v.number}>
                  {v.number}{!form.vehicle_size ? ` (${v.size})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 3: Origin + Destination (text fields with autocomplete) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Origin</label>
            <input
              type="text"
              placeholder="e.g. Patna DC"
              value={form.origin}
              onChange={(e) => updateField('origin', e.target.value)}
              list={listId('origin')}
              className={fieldClass('origin')}
            />
          </div>
          <div>
            <label className={labelClass}>Destination</label>
            <input
              type="text"
              placeholder="e.g. Ranchi DC"
              value={form.destination}
              onChange={(e) => updateField('destination', e.target.value)}
              list={listId('destination')}
              className={fieldClass('destination')}
            />
          </div>
        </div>

        {/* Row 4: Driver + Trip Type */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Driver Name</label>
            <input
              type="text"
              placeholder="e.g. Subhash"
              value={form.driver_name}
              onChange={(e) => updateField('driver_name', e.target.value)}
              list={listId('driver')}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className={labelClass}>Trip Type</label>
            <select
              value={form.trip_type || ''}
              onChange={(e) => updateField('trip_type', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select type...</option>
              <option value="adhoc">Adhoc</option>
              <option value="regular">Regular</option>
            </select>
          </div>
        </div>

        {/* Row 5: Trip ID */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Trip ID</label>
            <input
              type="text"
              placeholder="e.g. SFEC123 or any reference"
              value={form.trip_id || ''}
              onChange={(e) => updateField('trip_id', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Row 6: Amount + Add remarks/expenses toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Amount (Revenue)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">&#8377;</span>
              <input
                type="number"
                inputMode="numeric"
                placeholder="Freight / Cost"
                value={form.amount}
                onChange={(e) => updateField('amount', e.target.value)}
                className={`${fieldClass('amount')} pl-7`}
              />
            </div>
          </div>
          <div className="flex items-end gap-3 pb-0.5">
            {!showRemarks && (
              <button
                type="button"
                onClick={() => setShowRemarks(true)}
                className="text-sm text-blue-600 hover:text-blue-800 py-2.5"
              >
                + Remarks
              </button>
            )}
            {!showExpenses && (
              <button
                type="button"
                onClick={() => setShowExpenses(true)}
                className="text-sm text-blue-600 hover:text-blue-800 py-2.5"
              >
                + Trip expenses
              </button>
            )}
          </div>
        </div>

        {/* Remarks (collapsed by default) */}
        {showRemarks && (
          <div>
            <label className={labelClass}>Remarks</label>
            <input
              type="text"
              placeholder="e.g. late departure, short shipment"
              value={form.remarks}
              onChange={(e) => updateField('remarks', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        )}

        {/* Trip Expenses (collapsed by default) */}
        {showExpenses && (
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-gray-700">Trip Expenses</p>
              <button
                type="button"
                onClick={() => setShowExpenses(false)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Hide
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {TRIP_EXPENSE_CATEGORIES.map(cat => (
                <div key={cat.value}>
                  <label className="block text-xs text-gray-500 mb-1">{cat.label}</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">&#8377;</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="0"
                      value={form.expenses?.[cat.value] || ''}
                      onChange={(e) => updateExpense(cat.value, e.target.value)}
                      className="w-full pl-6 pr-2 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              ))}
            </div>
            {/* Expenses total */}
            {(() => {
              const total = computeExpensesTotal(form.expenses)
              return total > 0 ? (
                <p className="text-xs text-gray-500 mt-2 text-right">
                  Total: <span className="font-medium text-gray-700">&#8377;{total.toLocaleString('en-IN')}</span>
                </p>
              ) : null
            })()}
          </div>
        )}

        {/* Save button - sticky on mobile */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 sm:static sm:p-0 sm:bg-transparent sm:border-0 sm:pt-2 z-10">
          <button
            onClick={handleSave}
            className="w-full sm:w-auto px-6 py-3 sm:py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
          >
            Save Trip
          </button>
        </div>
      </div>
    </div>
  )
}
