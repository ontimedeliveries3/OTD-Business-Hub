import { useState } from 'react'
import { emptyBid, ORIGINS, VEHICLE_SIZES, SKIP_REASONS, BID_STATUSES } from '../lib/bids'

export default function BidForm({
  initialValues,
  onSave,
  autoResetOnSave = false,
}) {
  const [form, setForm] = useState(initialValues || emptyBid())
  const [errors, setErrors] = useState({})

  const updateField = (field, value) => {
    const updated = { ...form, [field]: value }

    // When status changes, clear conditional fields
    if (field === 'status') {
      if (value === 'skipped') {
        updated.bidAmount = ''
        updated.allocationPrice = ''
      } else if (value === 'lost') {
        updated.allocationPrice = ''
        updated.skipReason = ''
      } else if (value === 'won') {
        updated.skipReason = ''
      }
    }

    setForm(updated)
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: null }))
  }

  const validate = () => {
    const errs = {}
    if (!form.requestId.trim()) errs.requestId = 'Required'
    if (!form.origin) errs.origin = 'Required'
    if (!form.vehicleSize) errs.vehicleSize = 'Required'
    if (!form.status) errs.status = 'Required'

    if ((form.status === 'won' || form.status === 'lost') && (!form.bidAmount || parseFloat(form.bidAmount) <= 0)) {
      errs.bidAmount = 'Required'
    }
    if (form.status === 'won' && (!form.allocationPrice || parseFloat(form.allocationPrice) <= 0)) {
      errs.allocationPrice = 'Required'
    }
    if (form.status === 'skipped' && !form.skipReason) {
      errs.skipReason = 'Required'
    }

    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSave = () => {
    if (!validate()) return

    // Convert touch points string to array
    const touchPointsArray = form.touchPoints
      ? form.touchPoints.split(',').map(s => s.trim()).filter(Boolean)
      : []

    const bidData = {
      requestId: form.requestId.trim().toUpperCase(),
      client: 'Shadowfax',
      origin: form.origin,
      destination: form.destination || form.origin,
      touchPoints: touchPointsArray,
      vehicleSize: form.vehicleSize,
      tat: form.tat ? parseInt(form.tat, 10) : null,
      placementTime: form.placementTime || '',
      bidDeadline: form.bidDeadline || '',
      status: form.status,
      bidAmount: (form.status === 'won' || form.status === 'lost')
        ? parseFloat(form.bidAmount) || 0 : null,
      allocationPrice: form.status === 'won'
        ? parseFloat(form.allocationPrice) || 0 : null,
      skipReason: form.status === 'skipped' ? form.skipReason : null,
      requestDate: form.placementTime || new Date().toISOString().split('T')[0],
    }

    onSave?.(bidData)

    if (autoResetOnSave) {
      setForm({
        ...emptyBid(),
        origin: form.origin, // remember origin for next entry
      })
      setErrors({})
    }
  }

  const fieldClass = (field) =>
    `w-full px-3 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
      errors[field] ? 'border-red-400 bg-red-50' : 'border-gray-300'
    }`

  const labelClass = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 sm:p-6 pb-24 sm:pb-6">
      <div className="space-y-4">
        {/* Row 1: Request ID */}
        <div>
          <label className={labelClass}>Request ID</label>
          <input
            type="text"
            placeholder="e.g. SFEC26032182542"
            value={form.requestId}
            onChange={(e) => updateField('requestId', e.target.value)}
            className={fieldClass('requestId')}
            autoComplete="off"
          />
        </div>

        {/* Row 2: Origin + Destination */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Origin</label>
            <select
              value={form.origin}
              onChange={(e) => updateField('origin', e.target.value)}
              className={fieldClass('origin')}
            >
              <option value="">Select origin...</option>
              {ORIGINS.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Destination</label>
            <select
              value={form.destination}
              onChange={(e) => updateField('destination', e.target.value)}
              className={fieldClass('destination')}
            >
              <option value="">Select destination...</option>
              {ORIGINS.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 3: Vehicle Size */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Vehicle Size</label>
            <select
              value={form.vehicleSize}
              onChange={(e) => updateField('vehicleSize', e.target.value)}
              className={fieldClass('vehicleSize')}
            >
              <option value="">Select size...</option>
              {VEHICLE_SIZES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 3: Touch Points */}
        <div>
          <label className={labelClass}>
            Touch Points <span className="text-gray-400 font-normal">(comma-separated)</span>
          </label>
          <input
            type="text"
            placeholder="e.g. Adityapur DC, Jamshedpur DC, RNCKhunti DC"
            value={form.touchPoints}
            onChange={(e) => updateField('touchPoints', e.target.value)}
            className={fieldClass('touchPoints')}
          />
        </div>

        {/* Row 4: TAT + Placement Date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>
              TAT <span className="text-gray-400 font-normal">(hours, optional)</span>
            </label>
            <input
              type="number"
              inputMode="numeric"
              placeholder="e.g. 12"
              value={form.tat}
              onChange={(e) => updateField('tat', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className={labelClass}>Placement Date</label>
            <input
              type="date"
              value={form.placementTime}
              onChange={(e) => updateField('placementTime', e.target.value)}
              className={fieldClass('placementTime')}
            />
          </div>
        </div>

        {/* Row 5: Status */}
        <div>
          <label className={labelClass}>Status</label>
          <div className="flex gap-2">
            {BID_STATUSES.map(s => (
              <button
                key={s.value}
                type="button"
                onClick={() => updateField('status', s.value)}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                  form.status === s.value
                    ? s.value === 'won'
                      ? 'bg-green-600 text-white border-green-600'
                      : s.value === 'lost'
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-gray-600 text-white border-gray-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {errors.status && <p className="text-xs text-red-500 mt-1">Select a status</p>}
        </div>

        {/* Conditional: Bid Amount (Won or Lost) */}
        {(form.status === 'won' || form.status === 'lost') && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Bid Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">&#8377;</span>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="Your bid"
                  value={form.bidAmount}
                  onChange={(e) => updateField('bidAmount', e.target.value)}
                  className={`${fieldClass('bidAmount')} pl-7`}
                />
              </div>
            </div>

            {/* Allocation Price (Won only) */}
            {form.status === 'won' && (
              <div>
                <label className={labelClass}>Allocation Price</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">&#8377;</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="Allocation price"
                    value={form.allocationPrice}
                    onChange={(e) => updateField('allocationPrice', e.target.value)}
                    className={`${fieldClass('allocationPrice')} pl-7`}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Conditional: Skip Reason (Skipped only) */}
        {form.status === 'skipped' && (
          <div>
            <label className={labelClass}>Skip Reason</label>
            <select
              value={form.skipReason}
              onChange={(e) => updateField('skipReason', e.target.value)}
              className={fieldClass('skipReason')}
            >
              <option value="">Select reason...</option>
              {SKIP_REASONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Save button - sticky on mobile */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 sm:static sm:p-0 sm:bg-transparent sm:border-0 sm:pt-2 z-10">
          <button
            onClick={handleSave}
            className="w-full sm:w-auto px-6 py-3 sm:py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
          >
            Save Bid
          </button>
        </div>
      </div>
    </div>
  )
}
