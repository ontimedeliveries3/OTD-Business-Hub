import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, serverTimestamp, query, where } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../contexts/useAuth'
import LoadingSpinner from '../components/LoadingSpinner'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

function currentMonthYear() {
  const now = new Date()
  return { month: now.getMonth(), year: now.getFullYear() }
}

const emptyLineItem = () => ({
  particulars: '',
  hsn_sac: '996601',
  quantity: '',
  rate: '',
  amount: '',
})

export default function CreateInvoicePage() {
  const navigate = useNavigate()
  const { id: editId } = useParams()
  const { user } = useAuth()

  const [clients, setClients] = useState([])
  const [companyInfo, setCompanyInfo] = useState(null)
  const [signatureUrl, setSignatureUrl] = useState(null)
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedClient, setSelectedClient] = useState(null)
  const [invoiceDate, setInvoiceDate] = useState(todayISO())
  const [billingMonth, setBillingMonth] = useState(currentMonthYear().month)
  const [billingYear, setBillingYear] = useState(currentMonthYear().year)
  const [placeOfSupply, setPlaceOfSupply] = useState('')
  const [lineItems, setLineItems] = useState([emptyLineItem()])
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [uploadingSig, setUploadingSig] = useState(false)
  const [error, setError] = useState(null)
  const [loadingDraft, setLoadingDraft] = useState(false)
  const [currentFY, setCurrentFY] = useState(null)
  const [invoiceNumber, setInvoiceNumber] = useState('')

  // Load clients, company info, and signature
  useEffect(() => {
    async function load() {
      const [clientsSnap, companySnap, countersSnap] = await Promise.all([
        getDocs(collection(db, 'clients')),
        getDoc(doc(db, 'config', 'company_info')),
        getDoc(doc(db, 'config', 'counters')),
      ])
      const clientList = []
      clientsSnap.forEach((d) => clientList.push({ id: d.id, ...d.data() }))
      setClients(clientList)
      if (companySnap.exists()) {
        const info = companySnap.data()
        setCompanyInfo(info)
        if (info.signature_url) setSignatureUrl(info.signature_url)
      }
      if (countersSnap.exists()) {
        setCurrentFY(countersSnap.data().current_fy || '25-26')
      }
    }
    load()
  }, [])

  // Load draft if editing
  useEffect(() => {
    if (!editId) return
    async function loadDraft() {
      setLoadingDraft(true)
      const snap = await getDoc(doc(db, 'invoices', editId))
      if (snap.exists()) {
        const data = snap.data()
        setSelectedClientId(data.client_id || '')
        setInvoiceNumber(data.invoice_number || '')
        setInvoiceDate(data.invoice_date || todayISO())
        setBillingMonth(data.billing_month ?? currentMonthYear().month)
        setBillingYear(data.billing_year ?? currentMonthYear().year)
        setPlaceOfSupply(data.place_of_supply || '')
        setLineItems(data.line_items?.length ? data.line_items : [emptyLineItem()])
      }
      setLoadingDraft(false)
    }
    loadDraft()
  }, [editId])

  // Auto-fill client details when selected
  useEffect(() => {
    if (!selectedClientId) {
      setSelectedClient(null)
      return
    }
    const client = clients.find((c) => c.id === selectedClientId)
    if (client) {
      setSelectedClient(client)
      setPlaceOfSupply(client.state || '')
      // Update HSN/SAC on existing line items if they're default
      setLineItems((prev) =>
        prev.map((item) => ({
          ...item,
          hsn_sac: item.hsn_sac === '996601' || !item.hsn_sac ? client.default_hsn_sac || '996601' : item.hsn_sac,
        }))
      )
    }
  }, [selectedClientId, clients])

  // Line item handlers
  const updateLineItem = (index, field, value) => {
    setLineItems((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      // Auto-calculate amount if quantity and rate are filled
      const qty = parseFloat(updated[index].quantity) || 0
      const rate = parseFloat(updated[index].rate) || 0
      if (field === 'quantity' || field === 'rate') {
        if (qty > 0 && rate > 0) {
          updated[index].amount = (qty * rate).toString()
        }
      }
      return updated
    })
  }

  const addLineItem = () => setLineItems((prev) => [...prev, emptyLineItem()])

  const removeLineItem = (index) => {
    if (lineItems.length === 1) return
    setLineItems((prev) => prev.filter((_, i) => i !== index))
  }

  // Signature upload handler
  const handleSignatureUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (PNG, JPG, etc.)')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Signature image must be under 2MB')
      return
    }

    setUploadingSig(true)
    setError(null)
    try {
      const sigRef = ref(storage, 'assets/signature.png')
      await uploadBytes(sigRef, file, { contentType: file.type })
      const url = await getDownloadURL(sigRef)
      setSignatureUrl(url)

      // Save URL to company config
      await updateDoc(doc(db, 'config', 'company_info'), { signature_url: url })
    } catch (err) {
      setError('Failed to upload signature: ' + err.message)
    } finally {
      setUploadingSig(false)
    }
  }

  // Calculations
  const subTotal = lineItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0)
  const taxRate = selectedClient?.tax_rate || 0.18
  const igstAmount = Math.round(subTotal * taxRate * 100) / 100
  const grandTotal = Math.round((subTotal + igstAmount) * 100) / 100

  const formatCurrency = (amount) =>
    new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)

  // Build invoice data object
  const buildInvoiceData = (status) => ({
    client_id: selectedClientId,
    client_name: selectedClient?.name || '',
    client_gstin: selectedClient?.gstin || '',
    client_address: selectedClient?.address || '',
    client_state: selectedClient?.state || '',
    client_state_code: selectedClient?.state_code || '',
    client_id_label: selectedClient?.client_id_label || '',
    client_id_value: selectedClient?.client_id_value || '',
    customer_section_style: selectedClient?.customer_section_style || 'standard',
    quantity_label: selectedClient?.quantity_label || 'Qty',
    invoice_date: invoiceDate,
    billing_month: billingMonth,
    billing_year: billingYear,
    billing_period: `${MONTHS[billingMonth]} ${billingYear}`,
    place_of_supply: placeOfSupply,
    line_items: lineItems.map((item) => ({
      particulars: item.particulars,
      hsn_sac: item.hsn_sac,
      quantity: parseFloat(item.quantity) || 0,
      rate: parseFloat(item.rate) || 0,
      amount: parseFloat(item.amount) || 0,
    })),
    sub_total: subTotal,
    tax_rate: taxRate,
    igst_amount: igstAmount,
    grand_total: grandTotal,
    fiscal_year: currentFY || '25-26',
    status,
    updated_at: serverTimestamp(),
    updated_by: user.email,
  })

  // Save as Draft
  const handleSaveDraft = async () => {
    if (!selectedClientId) {
      setError('Please select a client.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const data = {
        ...buildInvoiceData('draft'),
        invoice_number: null,
        seq: null,
        pdf_url: null,
      }

      if (editId) {
        await setDoc(doc(db, 'invoices', editId), data, { merge: true })
      } else {
        data.created_at = serverTimestamp()
        data.created_by = user.email
        await addDoc(collection(db, 'invoices'), data)
      }
      navigate('/invoices')
    } catch (err) {
      setError('Failed to save draft: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  // Generate & Download
  const handleGenerate = async () => {
    if (!selectedClientId) {
      setError('Please select a client.')
      return
    }
    if (lineItems.every((item) => !item.particulars)) {
      setError('Please add at least one line item.')
      return
    }
    if (!invoiceNumber.trim()) {
      setError('Please enter an invoice number.')
      return
    }
    setGenerating(true)
    setError(null)
    try {
      // Check for duplicate invoice number
      const dupQuery = query(collection(db, 'invoices'), where('invoice_number', '==', invoiceNumber.trim()))
      const dupSnap = await getDocs(dupQuery)
      const isDuplicate = editId
        ? dupSnap.docs.some((d) => d.id !== editId)
        : !dupSnap.empty
      if (isDuplicate) {
        setError(`Invoice number "${invoiceNumber.trim()}" already exists. Please use a different number.`)
        setGenerating(false)
        return
      }

      // Build full invoice data with manually entered number
      const data = {
        ...buildInvoiceData('generated'),
        invoice_number: invoiceNumber.trim(),
      }

      // 3. Generate PDF (dynamic import — loads PDF libraries on first generate)
      const { generateInvoicePDF } = await import('../lib/pdfGenerator.jsx')
      const pdfBytes = await generateInvoicePDF(data, companyInfo, signatureUrl)

      // 4. Upload PDF to Firebase Storage
      const pdfFileName = `${invoiceNumber.replace(/\//g, '_')}.pdf`
      const pdfRef = ref(storage, `invoices/${pdfFileName}`)
      await uploadBytes(pdfRef, pdfBytes, { contentType: 'application/pdf' })
      const pdfUrl = await getDownloadURL(pdfRef)
      data.pdf_url = pdfUrl

      // 5. Save to Firestore
      if (editId) {
        data.created_at = serverTimestamp()
        data.created_by = user.email
        await setDoc(doc(db, 'invoices', editId), data)
      } else {
        data.created_at = serverTimestamp()
        data.created_by = user.email
        await addDoc(collection(db, 'invoices'), data)
      }

      // 6. Download PDF locally
      const blob = new Blob([pdfBytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = pdfFileName
      a.click()
      URL.revokeObjectURL(url)

      navigate('/invoices')
    } catch (err) {
      setError('Failed to generate invoice: ' + err.message)
    } finally {
      setGenerating(false)
    }
  }

  if (loadingDraft) {
    return <LoadingSpinner message="Loading draft..." />
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/invoices')} className="text-gray-500 hover:text-gray-700 py-1">
              &larr; Invoices
            </button>
            <h1 className="text-lg sm:text-xl font-bold text-gray-900">
              {editId ? 'Edit Invoice' : 'Create Invoice'}
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 space-y-6">
          {/* Invoice Number (manual entry) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Number</label>
            <input
              type="text"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="e.g. RS/060/25-26"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Row: Date + Client */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Date</label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
              <select
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select client...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Client details (auto-filled, read-only) */}
          {selectedClient && (
            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600 space-y-1">
              <p><span className="font-medium">GSTIN:</span> {selectedClient.gstin}</p>
              <p><span className="font-medium">Address:</span> {selectedClient.address}</p>
              <p><span className="font-medium">State:</span> {selectedClient.state} (Code: {selectedClient.state_code})</p>
              <p><span className="font-medium">{selectedClient.client_id_label}:</span> {selectedClient.client_id_value}</p>
            </div>
          )}

          {/* Row: Billing Period + Place of Supply */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Billing Month</label>
              <select
                value={billingMonth}
                onChange={(e) => setBillingMonth(parseInt(e.target.value))}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {MONTHS.map((m, i) => (
                  <option key={i} value={i}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Billing Year</label>
              <input
                type="number"
                value={billingYear}
                onChange={(e) => setBillingYear(parseInt(e.target.value))}
                min={2024}
                max={2030}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Place of Supply</label>
              <input
                type="text"
                value={placeOfSupply}
                onChange={(e) => setPlaceOfSupply(e.target.value)}
                placeholder="Auto-filled from client"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-gray-700">Line Items</label>
              <button
                onClick={addLineItem}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium py-1"
              >
                + Add Row
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium w-8">#</th>
                    <th className="px-3 py-2 text-left font-medium">Particulars</th>
                    <th className="px-3 py-2 text-left font-medium w-24 hidden sm:table-cell">HSN/SAC</th>
                    <th className="px-3 py-2 text-right font-medium w-20 sm:w-24">
                      {selectedClient?.quantity_label || 'Qty'}
                    </th>
                    <th className="px-3 py-2 text-right font-medium w-20 sm:w-24">Rate</th>
                    <th className="px-3 py-2 text-right font-medium w-24 sm:w-28">Amount</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item, index) => (
                    <tr key={index} className="border-b border-gray-100">
                      <td className="px-3 py-2 text-gray-400">{index + 1}</td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={item.particulars}
                          onChange={(e) => updateLineItem(index, 'particulars', e.target.value)}
                          placeholder="e.g. Purnia - Bhawanipur"
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-2 hidden sm:table-cell">
                        <input
                          type="text"
                          value={item.hsn_sac}
                          onChange={(e) => updateLineItem(index, 'hsn_sac', e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateLineItem(index, 'quantity', e.target.value)}
                          placeholder="0"
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-right focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={item.rate}
                          onChange={(e) => updateLineItem(index, 'rate', e.target.value)}
                          placeholder="0"
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-right focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={item.amount}
                          onChange={(e) => updateLineItem(index, 'amount', e.target.value)}
                          placeholder="0"
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-right focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {lineItems.length > 1 && (
                          <button
                            onClick={() => removeLineItem(index)}
                            className="text-red-400 hover:text-red-600 p-1"
                          >
                            x
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-full sm:w-72 space-y-2 text-sm">
              <div className="flex justify-between py-2 border-t border-gray-200">
                <span className="text-gray-600">Sub Total</span>
                <span className="font-medium">{formatCurrency(subTotal)}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-gray-600">IGST @ {(taxRate * 100).toFixed(0)}%</span>
                <span className="font-medium">{formatCurrency(igstAmount)}</span>
              </div>
              <div className="flex justify-between py-2 border-t-2 border-gray-900 text-base">
                <span className="font-bold">Grand Total</span>
                <span className="font-bold">{formatCurrency(grandTotal)}</span>
              </div>
            </div>
          </div>

          {/* Signature Upload */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-700">Signature</label>
                <p className="text-xs text-gray-400 mt-0.5">
                  {signatureUrl ? 'Signature will appear on generated PDFs' : 'Upload a signature image for your invoices'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {signatureUrl && (
                  <img src={signatureUrl} alt="Signature" className="h-10 border border-gray-200 rounded p-0.5" />
                )}
                <label className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium cursor-pointer">
                  {uploadingSig ? 'Uploading...' : signatureUrl ? 'Change' : 'Upload'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleSignatureUpload}
                    disabled={uploadingSig}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-gray-200">
            <button
              onClick={handleSaveDraft}
              disabled={saving || generating}
              className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 active:bg-gray-300 transition-colors font-medium disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save as Draft'}
            </button>
            <button
              onClick={handleGenerate}
              disabled={saving || generating}
              className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors font-medium disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Generate & Download'}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
