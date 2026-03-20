export default function LoadingSpinner({ message = 'Loading...' }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-3">
      <div className="w-8 h-8 border-3 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
      <p className="text-gray-500 text-sm">{message}</p>
    </div>
  )
}
