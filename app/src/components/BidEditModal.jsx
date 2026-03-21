import { useState } from 'react'
import BidForm from './BidForm'

export default function BidEditModal({ bid, onSave, onClose, saving = false }) {
  const [error, setError] = useState(null)

  const handleSave = async (bidData) => {
    try {
      setError(null)
      await onSave(bid.id, bidData)
    } catch (err) {
      setError('Failed to save: ' + err.message)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl max-w-lg mx-4 w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Edit Bid</h3>
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
          <BidForm
            initialValues={{
              requestId: bid.requestId || '',
              client: bid.client || 'Shadowfax',
              origin: bid.origin || '',
              destination: bid.destination || '',
              touchPoints: Array.isArray(bid.touchPoints) ? bid.touchPoints.join(', ') : (bid.touchPoints || ''),
              vehicleSize: bid.vehicleSize || '',
              tat: bid.tat || '',
              placementTime: bid.placementTime || '',
              bidDeadline: bid.bidDeadline || '',
              status: bid.status || 'won',
              bidAmount: bid.bidAmount || '',
              allocationPrice: bid.allocationPrice || '',
              skipReason: bid.skipReason || '',
              requestDate: bid.requestDate || '',
            }}
            onSave={handleSave}
          />
        </div>
      </div>
    </div>
  )
}
