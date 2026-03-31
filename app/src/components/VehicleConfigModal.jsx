import { useState } from 'react'
import { doc, writeBatch } from 'firebase/firestore'
import { db } from '../lib/firebase'

const formatCurrency = (amt) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amt)

export default function VehicleConfigModal({ vehicles, onClose, onSaved }) {
  const [edits, setEdits] = useState(() => {
    const map = {}
    vehicles.forEach(v => {
      map[v.number] = {
        driver_salary: v.driver_salary ?? '',
      }
    })
    return map
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const updateField = (vehicleNo, field, value) => {
    setEdits(prev => ({
      ...prev,
      [vehicleNo]: { ...prev[vehicleNo], [field]: value },
    }))
  }

  const getDailyFixed = (vehicle) => {
    const emi = vehicle.emi || 0
    const salary = parseFloat(edits[vehicle.number]?.driver_salary) || 0
    return Math.round((emi + salary) / 30)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const batch = writeBatch(db)
      for (const v of vehicles) {
        const salary = parseFloat(edits[v.number]?.driver_salary) || 0
        const dailyFixed = Math.round((( v.emi || 0) + salary) / 30)
        batch.update(doc(db, 'vehicles', v.number), {
          driver_salary: salary,
          daily_fixed_cost: dailyFixed,
        })
      }
      await batch.commit()

      // Return updated vehicles
      const updated = vehicles.map(v => ({
        ...v,
        driver_salary: parseFloat(edits[v.number]?.driver_salary) || 0,
        daily_fixed_cost: Math.round(((v.emi || 0) + (parseFloat(edits[v.number]?.driver_salary) || 0)) / 30),
      }))
      onSaved?.(updated)
      onClose()
    } catch (err) {
      console.error('Failed to save vehicle config:', err)
      setError('Failed to save: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-8">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Vehicle Fixed Costs</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-3 p-2.5 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {vehicles.map(v => {
            const daily = getDailyFixed(v)
            return (
              <div key={v.number} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{v.number}</p>
                    <p className="text-xs text-gray-500">{v.size} &middot; {v.ownership}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Daily cost</p>
                    <p className="text-sm font-semibold text-gray-900">{formatCurrency(daily)}/day</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">EMI/month</label>
                    <p className="px-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-700">
                      {v.emi ? formatCurrency(v.emi) : '—'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Driver Salary/month</label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">&#8377;</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder="0"
                        value={edits[v.number]?.driver_salary ?? ''}
                        onChange={(e) => updateField(v.number, 'driver_salary', e.target.value)}
                        className="w-full pl-6 pr-2 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="p-4 border-t border-gray-200 flex gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save All'}
          </button>
        </div>
      </div>
    </div>
  )
}
