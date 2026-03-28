import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { useAuth } from './contexts/useAuth'
import LoginPage from './pages/LoginPage'
import OfflineBanner from './components/OfflineBanner'
import LoadingSpinner from './components/LoadingSpinner'

// Lazy-load heavy pages — each becomes its own JS chunk
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const CreateInvoicePage = lazy(() => import('./pages/CreateInvoicePage'))
const InvoiceRegisterPage = lazy(() => import('./pages/InvoiceRegisterPage'))
const MISPage = lazy(() => import('./pages/MISPage'))
const TripsPage = lazy(() => import('./pages/TripsPage'))
const BidsPage = lazy(() => import('./pages/BidsPage'))
const ExpensesPage = lazy(() => import('./pages/ExpensesPage'))

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
      <Suspense fallback={<LoadingSpinner message="Loading..." />}>
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
          <Route
            path="/expenses"
            element={
              <ProtectedRoute>
                <ExpensesPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  )
}

export default App
