import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, doc, deleteDoc } from 'firebase/firestore'
import { ref, deleteObject } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../contexts/useAuth'
import * as XLSX from 'xlsx'

const FISCAL_YEARS = ['24-25', '25-26', '26-27']

export default function InvoiceRegisterPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(null) // invoice id being deleted
  const [deleteConfirm, setDeleteConfirm] = useState(null) // invoice to confirm delete
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  // Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [clientFilter, setClientFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [fyFilter, setFyFilter] = useState('25-26')

  // Fetch all invoices once
  useEffect(() => {
    async function fetchInvoices() {
      try {
        const snapshot = await getDocs(collection(db, 'invoices'))
        const list = []
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() })
        })
        // Sort by created_at descending (newest first)
        list.sort((a, b) => {
          const aTime = a.created_at?.toMillis?.() || 0
          const bTime = b.created_at?.toMillis?.() || 0
          return bTime - aTime
        })
        setInvoices(list)
      } catch (err) {
        console.error('Failed to fetch invoices:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchInvoices()
  }, [])

  // Get unique client names for filter dropdown
  const clientNames = useMemo(() => {
    const names = new Set()
    invoices.forEach((inv) => {
      if (inv.client_name) names.add(inv.client_name)
    })
    return [...names].sort()
  }, [invoices])

  // Client-side filtering
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      // Search by invoice number
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const invNum = (inv.invoice_number || '').toLowerCase()
        const particulars = (inv.line_items || []).map((li) => li.particulars?.toLowerCase() || '').join(' ')
        if (!invNum.includes(q) && !particulars.includes(q)) return false
      }

      // Client filter
      if (clientFilter !== 'all' && inv.client_name !== clientFilter) return false

      // Status filter
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false

      // FY filter
      if (fyFilter !== 'all' && inv.fiscal_year !== fyFilter) return false

      return true
    })
  }, [invoices, searchQuery, clientFilter, statusFilter, fyFilter])

  // Totals for filtered results
  const filteredTotals = useMemo(() => {
    let subTotal = 0
    let gst = 0
    let grandTotal = 0
    filteredInvoices.forEach((inv) => {
      if (inv.status !== 'draft') {
        subTotal += inv.sub_total || 0
        gst += inv.igst_amount || 0
        grandTotal += inv.grand_total || 0
      }
    })
    return { subTotal, gst, grandTotal }
  }, [filteredInvoices])

  const formatCurrency = (amount) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount)

  const formatDate = (dateStr) => {
    if (!dateStr) return '—'
    const [year, month, day] = dateStr.split('-')
    return `${day}/${month}/${year}`
  }

  // Delete invoice
  const handleDelete = async (inv) => {
    setDeleting(inv.id)
    try {
      // Delete PDF from Storage if exists
      if (inv.pdf_url && inv.invoice_number) {
        try {
          const pdfFileName = `${inv.invoice_number.replace(/\//g, '_')}.pdf`
          const pdfRef = ref(storage, `invoices/${pdfFileName}`)
          await deleteObject(pdfRef)
        } catch (storageErr) {
          // PDF may not exist in storage — continue with Firestore delete
          console.warn('Could not delete PDF from storage:', storageErr.message)
        }
      }

      // Delete from Firestore
      await deleteDoc(doc(db, 'invoices', inv.id))

      // Remove from local state
      setInvoices((prev) => prev.filter((i) => i.id !== inv.id))
      setDeleteConfirm(null)
    } catch (err) {
      console.error('Failed to delete invoice:', err)
      alert('Failed to delete invoice: ' + err.message)
    } finally {
      setDeleting(null)
    }
  }

  // Bulk delete all filtered invoices
  const handleBulkDelete = async () => {
    setBulkDeleting(true)
    try {
      for (const inv of filteredInvoices) {
        if (inv.pdf_url && inv.invoice_number) {
          try {
            const pdfFileName = `${inv.invoice_number.replace(/\//g, '_')}.pdf`
            const pdfRef = ref(storage, `invoices/${pdfFileName}`)
            await deleteObject(pdfRef)
          } catch (storageErr) {
            console.warn('Could not delete PDF:', storageErr.message)
          }
        }
        await deleteDoc(doc(db, 'invoices', inv.id))
      }
      const deletedIds = new Set(filteredInvoices.map((i) => i.id))
      setInvoices((prev) => prev.filter((i) => !deletedIds.has(i.id)))
      setBulkDeleteConfirm(false)
    } catch (err) {
      console.error('Bulk delete failed:', err)
      alert('Bulk delete failed: ' + err.message)
    } finally {
      setBulkDeleting(false)
    }
  }

  // Export to Excel
  const handleExport = () => {
    const data = filteredInvoices.map((inv) => ({
      'Invoice Number': inv.invoice_number || 'Draft',
      'Date': inv.invoice_date || '',
      'Client': inv.client_name || '',
      'Billing Period': inv.billing_period || '',
      'Sub Total': inv.sub_total || 0,
      'IGST': inv.igst_amount || 0,
      'Grand Total': inv.grand_total || 0,
      'Status': inv.status || '',
    }))

    const ws = XLSX.utils.json_to_sheet(data)

    // Set column widths
    ws['!cols'] = [
      { wch: 18 }, // Invoice Number
      { wch: 12 }, // Date
      { wch: 20 }, // Client
      { wch: 18 }, // Billing Period
      { wch: 12 }, // Sub Total
      { wch: 12 }, // IGST
      { wch: 14 }, // Grand Total
      { wch: 12 }, // Status
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Invoices')

    const fyLabel = fyFilter === 'all' ? 'All' : `FY${fyFilter}`
    XLSX.writeFile(wb, `OTD_Invoice_Register_${fyLabel}.xlsx`)
  }

  const handleRowClick = (inv) => {
    if (inv.status === 'draft') {
      navigate(`/invoice/${inv.id}/edit`)
    } else if (inv.pdf_url) {
      window.open(inv.pdf_url, '_blank')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700">
              &larr; Dashboard
            </button>
            <h1 className="text-xl font-bold text-gray-900">Invoice Register</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500 hidden sm:inline">{user.email}</span>
            <button
              onClick={logout}
              className="text-sm text-red-600 hover:text-red-800 font-medium"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4 w-full">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Invoice</h3>
              <p className="text-sm text-gray-600 mb-1">
                Are you sure you want to delete{' '}
                <span className="font-medium">{deleteConfirm.invoice_number || 'this draft'}</span>?
              </p>
              <p className="text-xs text-red-500 mb-4">This action cannot be undone.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium text-sm disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-sm disabled:opacity-50"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Delete Confirmation Modal */}
        {bulkDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4 w-full">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete All Filtered Invoices</h3>
              <p className="text-sm text-gray-600 mb-1">
                This will delete <span className="font-medium text-red-600">{filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? 's' : ''}</span> and their PDFs.
              </p>
              <p className="text-xs text-red-500 mb-4">This action cannot be undone.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setBulkDeleteConfirm(false)}
                  disabled={bulkDeleting}
                  className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium text-sm disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-sm disabled:opacity-50"
                >
                  {bulkDeleting ? 'Deleting...' : `Delete ${filteredInvoices.length}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Search */}
            <div className="lg:col-span-2">
              <input
                type="text"
                placeholder="Search invoice # or particulars..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Client */}
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">All Clients</option>
              {clientNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>

            {/* Status */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">All Status</option>
              <option value="draft">Draft</option>
              <option value="generated">Generated</option>
            </select>

            {/* Financial Year */}
            <select
              value={fyFilter}
              onChange={(e) => setFyFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">All FY</option>
              {FISCAL_YEARS.map((fy) => (
                <option key={fy} value={fy}>FY {fy}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Results header */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-gray-500">
            {filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? 's' : ''}
            {fyFilter !== 'all' && ` in FY ${fyFilter}`}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setBulkDeleteConfirm(true)}
              disabled={filteredInvoices.length === 0}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Delete All ({filteredInvoices.length})
            </button>
            <button
              onClick={handleExport}
              disabled={filteredInvoices.length === 0}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Export to Excel
            </button>
          </div>
        </div>

        {/* Invoice Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="px-6 py-12 text-center text-gray-500">Loading invoices...</div>
          ) : filteredInvoices.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500">
              No invoices match your filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Invoice #</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Client</th>
                    <th className="px-4 py-3 font-medium">Period</th>
                    <th className="px-4 py-3 font-medium text-right">Sub Total</th>
                    <th className="px-4 py-3 font-medium text-right">GST</th>
                    <th className="px-4 py-3 font-medium text-right">Grand Total</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredInvoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => handleRowClick(inv)}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                        {inv.invoice_number || 'Draft'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {formatDate(inv.invoice_date)}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{inv.client_name || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {inv.billing_period || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-900 text-right whitespace-nowrap">
                        {inv.sub_total ? formatCurrency(inv.sub_total) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-right whitespace-nowrap">
                        {inv.igst_amount ? formatCurrency(inv.igst_amount) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-900 font-medium text-right whitespace-nowrap">
                        {inv.grand_total ? formatCurrency(inv.grand_total) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                          inv.status === 'generated' ? 'bg-green-100 text-green-800' :
                          inv.status === 'draft' ? 'bg-yellow-100 text-yellow-800' :
                          inv.status === 'sent' ? 'bg-blue-100 text-blue-800' :
                          inv.status === 'paid' ? 'bg-purple-100 text-purple-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {inv.status || 'unknown'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeleteConfirm(inv)
                            }}
                            className="text-gray-400 hover:text-red-600 transition-colors p-1"
                            title="Delete invoice"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </td>
                    </tr>
                  ))}
                </tbody>

                {/* Totals footer */}
                <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                  <tr className="font-semibold text-gray-900">
                    <td className="px-4 py-3" colSpan={4}>
                      Total (generated only)
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {formatCurrency(filteredTotals.subTotal)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {formatCurrency(filteredTotals.gst)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {formatCurrency(filteredTotals.grandTotal)}
                    </td>
                    <td className="px-4 py-3" colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
