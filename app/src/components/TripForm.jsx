import { useState, useMemo } from 'react'
import { emptyTrip } from '../lib/trips'

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

  // Filter locations by selected client (shared pool for origin & destination)
  const clientLocations = useMemo(() => {
    if (!form.client_id) return locations
    return locations.filter(l => l.client_id === form.client_id)
  }, [locations, form.client_id])

  const updateField = (field, value) => {
    let updated = { ...form, [field]: value }

    // When client changes, clear origin/destination if they don't belong to the new client
    if (field === 'client_id' && value) {
      const newClientLocs = locations.filter(l => l.client_id === value).map(l => l.name)
      if (form.origin && !newClientLocs.includes(form.origin)) {
        updated.origin = ''
      }
      if (form.destination && !newClientLocs.includes(form.destination)) {
        updated.destination = ''
      }
    }

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

  const validate = () => {
    const errs = {}
    if (!form.date) errs.date = 'Required'
    if (!form.client_id) errs.client_id = 'Required'
    if (!form.vehicle_no.trim()) errs.vehicle_no = 'Required'
    if (!form.amount || parseFloat(form.amount) <= 0) errs.amount = 'Required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSave = () => {
    if (!validate()) return

    const client = clients.find(c => c.id === form.client_id)
    const tripData = {
      date: form.date,
      vehicle_no: form.vehicle_no.trim().toUpperCase(),
      vehicle_size: form.vehicle_size,
      driver_name: form.driver_name.trim(),
      origin: form.origin,
      destination: form.destination,
      client_id: form.client_id,
      client_name: client?.name || form.client_id,
      amount: parseFloat(form.amount) || 0,
      remarks: form.remarks.trim(),
      sfec_request_id: form.sfec_request_id || '',
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
    }
  }

  const fieldClass = (field) =>
    `w-full px-3 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
      errors[field] ? 'border-red-400 bg-red-50' : 'border-gray-300'
    }`

  const labelClass = compact ? 'sr-only' : 'block text-sm font-medium text-gray-700 mb-1'

  // Datalist IDs (unique per instance)
  const listId = (name) => `dl-${name}-${rowNumber || 'main'}`

  // Render datalists (only driver now — origin/destination are selects)
  const datalists = (
    <>
      {suggestions.driver_name?.length > 0 && (
        <datalist id={listId('driver')}>
          {suggestions.driver_name.map(v => <option key={v} value={v} />)}
        </datalist>
      )}
    </>
  )

  // Origin/destination select helper
  const locationSelect = (field, placeholder) => (
    <select
      value={form[field]}
      onChange={(e) => updateField(field, e.target.value)}
      className={fieldClass(field)}
    >
      <option value="">
        {!form.client_id ? 'Select client first...' : placeholder}
      </option>
      {clientLocations.map(l => (
        <option key={l.id || l.name} value={l.name}>{l.name}</option>
      ))}
    </select>
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
            <input
              type="date"
              value={form.date}
              onChange={(e) => updateField('date', e.target.value)}
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
            {locationSelect('origin', 'Origin...')}
          </div>
          <div>
            <label className={labelClass}>Destination</label>
            {locationSelect('destination', 'Destination...')}
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
            <input
              type="date"
              value={form.date}
              onChange={(e) => updateField('date', e.target.value)}
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
            <label className={labelClass}>Vehicle Number</label>
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

        {/* Row 3: Origin + Destination */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Origin</label>
            {locationSelect('origin', 'Select origin...')}
          </div>
          <div>
            <label className={labelClass}>Destination</label>
            {locationSelect('destination', 'Select destination...')}
          </div>
        </div>

        {/* Row 4: Driver + Trip Type */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Driver Name <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="text"
              placeholder="e.g. Subhash"
              value={form.driver_name}
              onChange={(e) => updateField('driver_name', e.target.value)}
              list={listId('driver')}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Row 5: Amount */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Amount</label>
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
          <div className="flex items-end">
            {!showRemarks && (
              <button
                type="button"
                onClick={() => setShowRemarks(true)}
                className="text-sm text-blue-600 hover:text-blue-800 py-2.5"
              >
                + Add remarks
              </button>
            )}
          </div>
        </div>

        {/* Remarks (collapsed by default) */}
        {showRemarks && (
          <div>
            <label className={labelClass}>Remarks <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="text"
              placeholder="e.g. late departure, short shipment"
              value={form.remarks}
              onChange={(e) => updateField('remarks', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
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
