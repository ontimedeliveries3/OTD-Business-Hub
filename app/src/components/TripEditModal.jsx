import { useState } from 'react'
import TripForm from './TripForm'

export default function TripEditModal({ trip, clients, vehicles = [], locations = [], onSave, onClose, saving = false, suggestions = {} }) {
  const [error, setError] = useState(null)

  const handleSave = async (tripData) => {
    try {
      setError(null)
      await onSave(trip.id, tripData)
    } catch (err) {
      setError('Failed to save: ' + err.message)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl max-w-lg mx-4 w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Edit Trip</h3>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}
          <TripForm
            clients={clients}
            vehicles={vehicles}
            locations={locations}
            initialValues={{
              date: trip.date || '',
              vehicle_no: trip.vehicle_no || '',
              vehicle_size: trip.vehicle_size || '',
              driver_name: trip.driver_name || '',
              origin: trip.origin || '',
              destination: trip.destination || '',
              client_id: trip.client_id || '',
              amount: trip.amount || '',
              remarks: trip.remarks || '',
            }}
            onSave={handleSave}
            suggestions={suggestions}
          />
        </div>
      </div>
    </div>
  )
}
