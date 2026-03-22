import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { useAuth } from './contexts/useAuth'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import CreateInvoicePage from './pages/CreateInvoicePage'
import InvoiceRegisterPage from './pages/InvoiceRegisterPage'
import MISPage from './pages/MISPage'
import TripsPage from './pages/TripsPage'
import BidsPage from './pages/BidsPage'
import OfflineBanner from './components/OfflineBanner'
import LoadingSpinner from './components/LoadingSpinner'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return <LoadingSpinner message="Authenticating..." />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}

function App() {
  return (
    <AuthProvider>
      <OfflineBanner />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/invoices/new"
          element={
            <ProtectedRoute>
              <CreateInvoicePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/invoices/:id/edit"
          element={
            <ProtectedRoute>
              <CreateInvoicePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/invoices"
          element={
            <ProtectedRoute>
              <InvoiceRegisterPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mis"
          element={
            <ProtectedRoute>
              <MISPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trips"
          element={
            <ProtectedRoute>
              <TripsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/bids"
          element={
            <ProtectedRoute>
              <BidsPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
