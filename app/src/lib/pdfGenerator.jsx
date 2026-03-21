import React from 'react'
import { pdf, Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'

// ─── Styles ───
const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 8,
    padding: 30,
    paddingBottom: 20,
  },
  // Outer border wrapping everything
  outerBorder: {
    border: '1pt solid #000',
    flex: 1,
    flexDirection: 'column',
  },

  // ─── Header ───
  taxInvoiceBar: {
    backgroundColor: '#d9d9d9',
    borderBottom: '1pt solid #000',
    padding: 3,
    alignItems: 'center',
  },
  taxInvoiceText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
  },
  companyBanner: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 2,
  },
  companyName: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 18,
    marginBottom: 6,
  },
  companyAddr: {
    fontSize: 8,
    marginBottom: 1,
  },
  contactRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 60,
    marginTop: 8,
    marginBottom: 4,
  },
  gstinPanRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderTop: '0.5pt solid #000',
    borderBottom: '1pt solid #000',
  },
  gstinPanText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
  },

  // ─── Customer + Meta section ───
  customerMetaRow: {
    flexDirection: 'row',
    borderBottom: '1pt solid #000',
  },
  customerCol: {
    flex: 1,
    borderRight: '0.5pt solid #000',
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  metaCol: {
    width: 190,
    paddingHorizontal: 6,
    paddingVertical: 5,
    justifyContent: 'space-between',
  },
  metaRow: {
    flexDirection: 'row',
  },
  metaLabel: {
    width: 80,
    fontSize: 8,
    color: '#555',
  },
  metaValue: {
    flex: 1,
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
  },
  customerLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    marginBottom: 2,
  },
  customerName: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
    marginBottom: 3,
  },
  customerDetail: {
    fontSize: 8,
    marginBottom: 2,
  },
  customerGstin: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    marginBottom: 2,
  },

  // ─── Line Items Table ───
  table: {
    flex: 1,
    flexDirection: 'column',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#d9d9d9',
    borderBottom: '1pt solid #000',
    minHeight: 16,
    alignItems: 'center',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottom: '0.3pt solid #000',
    minHeight: 16,
    alignItems: 'center',
  },
  tableRowEmpty: {
    flexDirection: 'row',
    flex: 1,
  },
  // Column widths
  colSlno: { width: 30, borderRight: '0.5pt solid #000', paddingHorizontal: 3, paddingVertical: 2, textAlign: 'center' },
  colParticulars: { flex: 1, borderRight: '0.5pt solid #000', paddingHorizontal: 4, paddingVertical: 2 },
  colHsn: { width: 80, borderRight: '0.5pt solid #000', paddingHorizontal: 4, paddingVertical: 2, textAlign: 'center' },
  colQty: { width: 60, borderRight: '0.5pt solid #000', paddingHorizontal: 4, paddingVertical: 2, textAlign: 'center' },
  colRate: { width: 55, borderRight: '0.5pt solid #000', paddingHorizontal: 4, paddingVertical: 2, textAlign: 'center' },
  colAmount: { width: 70, paddingHorizontal: 4, paddingVertical: 2, textAlign: 'right' },
  thText: { fontFamily: 'Helvetica-Bold', fontSize: 7.5 },
  tdText: { fontSize: 8 },

  // ─── Totals ───
  totalsSection: {
    borderTop: '1pt solid #000',
  },
  totalsRow: {
    flexDirection: 'row',
    borderBottom: '0.5pt solid #000',
    minHeight: 18,
    alignItems: 'center',
  },
  totalsLastRow: {
    flexDirection: 'row',
    borderBottom: '1pt solid #000',
    borderTop: '1pt solid #000',
    minHeight: 20,
    alignItems: 'center',
  },
  totalsLabel: {
    flex: 1,
    paddingHorizontal: 8,
  },
  totalsAmount: {
    width: 70,
    borderLeft: '0.5pt solid #000',
    paddingHorizontal: 4,
    textAlign: 'right',
    paddingVertical: 2,
  },

  // ─── Footer ───
  footer: {
    flexDirection: 'row',
    minHeight: 110,
  },
  bankSection: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  bankTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    marginBottom: 6,
  },
  bankRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  bankLabel: {
    width: 55,
    fontSize: 8,
    textAlign: 'right',
  },
  bankColon: {
    width: 15,
    fontSize: 8,
    textAlign: 'center',
  },
  bankValue: {
    flex: 1,
    fontSize: 8,
  },
  signatureSection: {
    width: 190,
    borderLeft: '0.5pt solid #000',
    paddingHorizontal: 4,
    paddingVertical: 3,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sigHeader: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
  },
  sigFooter: {
    alignItems: 'center',
  },
  sigName: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
  },
  sigImage: {
    width: 182,
    height: 100,
    objectFit: 'contain',
  },
})

// ─── Helpers ───

function formatCurrency(amt) {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amt || 0)
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
}

// ─── Components ───

function Header({ company }) {
  return (
    <View>
      <View style={s.taxInvoiceBar}>
        <Text style={s.taxInvoiceText}>TAX - INVOICE</Text>
      </View>
      <View style={s.companyBanner}>
        <Text style={s.companyName}>ONTIME DELIVERIES</Text>
        <Text style={s.companyAddr}>FLAT NO - 3/1, MITTAL RESIDENCY, NEAR CARMEL SCHOOL</Text>
        <Text style={s.companyAddr}>SONARI, JAMSHEDPUR, EAST SINGHBHUM, JHARKHAND-831011</Text>
        <View style={s.contactRow}>
          <Text style={{ fontSize: 8 }}>CON : {company.phone || '9608186440'}</Text>
          <Text style={{ fontSize: 8 }}>EMAIL ID : {company.email || 'ontimedeliveries3@gmail.com'}</Text>
        </View>
      </View>
      <View style={s.gstinPanRow}>
        <Text style={s.gstinPanText}>GSTIN NO : {company.gstin || '20HMBPS6520P1ZQ'}</Text>
        <Text style={s.gstinPanText}>PAN : {company.pan || 'HMBPS6520P'}</Text>
      </View>
    </View>
  )
}

function CustomerMeta({ invoice }) {
  const isStandard = invoice.customer_section_style !== 'meesho'

  return (
    <View style={s.customerMetaRow}>
      {/* Left: Customer details */}
      <View style={s.customerCol}>
        {isStandard ? (
          <>
            <Text style={s.customerLabel}>Customer Name :</Text>
            <Text style={s.customerName}>{invoice.client_name}</Text>
            <Text style={s.customerDetail}>Address : {invoice.client_address}</Text>
            <Text style={s.customerDetail}>State : {(invoice.client_state || '').toUpperCase()}</Text>
            <Text style={s.customerDetail}>STATE CODE : {invoice.client_state_code}</Text>
            <Text style={s.customerDetail}>PLACE OF SUPPLY : {(invoice.place_of_supply || '').toUpperCase()}</Text>
            <Text style={s.customerGstin}>GSTIN : {invoice.client_gstin}</Text>
          </>
        ) : (
          <>
            <Text style={s.customerLabel}>To,</Text>
            <Text style={s.customerName}>{invoice.client_name}</Text>
            <Text style={s.customerDetail}>{invoice.client_address}</Text>
            <Text style={s.customerDetail}>STATE CODE : {invoice.client_state_code}</Text>
            <Text style={s.customerGstin}>GST No : {invoice.client_gstin}</Text>
            <Text style={s.customerDetail}>PLACE OF SUPPLY : {(invoice.place_of_supply || '').toUpperCase()}</Text>
          </>
        )}
      </View>

      {/* Right: Invoice metadata */}
      <View style={s.metaCol}>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Invoice No.</Text>
          <Text style={s.metaValue}>{invoice.invoice_number}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Invoice Date :</Text>
          <Text style={s.metaValue}>{formatDate(invoice.invoice_date)}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>{invoice.client_id_label} :</Text>
          <Text style={s.metaValue}>{invoice.client_id_value}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>PERIOD :</Text>
          <Text style={s.metaValue}>{invoice.billing_period}</Text>
        </View>
      </View>
    </View>
  )
}

function LineItemsTable({ invoice }) {
  const items = invoice.line_items || []
  const qtyLabel = invoice.quantity_label || 'Qty'

  return (
    <View style={s.table}>
      {/* Table Header */}
      <View style={s.tableHeader}>
        <View style={s.colSlno}><Text style={s.thText}>S.No.</Text></View>
        <View style={s.colParticulars}><Text style={s.thText}>Particulars</Text></View>
        <View style={s.colHsn}><Text style={s.thText}>HSN/SAC CODE</Text></View>
        <View style={s.colQty}><Text style={s.thText}>{qtyLabel}</Text></View>
        <View style={s.colRate}><Text style={s.thText}>Rate</Text></View>
        <View style={s.colAmount}><Text style={s.thText}>Amount (RS)</Text></View>
      </View>

      {/* Data Rows */}
      {items.map((item, idx) => (
        <View key={idx} style={s.tableRow}>
          <View style={s.colSlno}><Text style={s.tdText}>{idx + 1}</Text></View>
          <View style={s.colParticulars}><Text style={s.tdText}>{item.particulars || ''}</Text></View>
          <View style={s.colHsn}><Text style={s.tdText}>{item.hsn_sac || ''}</Text></View>
          <View style={s.colQty}><Text style={s.tdText}>{item.quantity > 0 ? item.quantity : ''}</Text></View>
          <View style={s.colRate}><Text style={s.tdText}>{item.rate > 0 ? item.rate : ''}</Text></View>
          <View style={s.colAmount}><Text style={s.tdText}>{formatCurrency(item.amount)}</Text></View>
        </View>
      ))}

      {/* Empty space fills remaining area — pushes totals to bottom */}
      <View style={s.tableRowEmpty}>
        <View style={s.colSlno} />
        <View style={s.colParticulars} />
        <View style={s.colHsn} />
        <View style={s.colQty} />
        <View style={s.colRate} />
        <View style={s.colAmount} />
      </View>
    </View>
  )
}

function Totals({ invoice }) {
  const igstLabel = `IGST @ ${(invoice.tax_rate * 100).toFixed(0)}%`

  return (
    <View style={s.totalsSection}>
      {/* Sub Total */}
      <View style={s.totalsRow}>
        <View style={s.totalsLabel}>
          <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 9 }}>SUB TOTAL</Text>
        </View>
        <View style={s.totalsAmount}>
          <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 9 }}>{formatCurrency(invoice.sub_total)}</Text>
        </View>
      </View>

      {/* IGST */}
      <View style={s.totalsRow}>
        <View style={s.totalsLabel}>
          <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 9 }}>{igstLabel}</Text>
        </View>
        <View style={s.totalsAmount}>
          <Text style={{ fontSize: 9 }}>{formatCurrency(invoice.igst_amount)}</Text>
        </View>
      </View>

      {/* RCM + Grand Total */}
      <View style={s.totalsLastRow}>
        <View style={[s.totalsLabel, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
          <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 8 }}>RCM STATUS : NOT APPLICABLE</Text>
          <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 10 }}>Total</Text>
        </View>
        <View style={s.totalsAmount}>
          <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 10 }}>{formatCurrency(invoice.grand_total)}</Text>
        </View>
      </View>
    </View>
  )
}

function Footer({ company, signatureUrl }) {
  return (
    <View style={s.footer}>
      {/* Bank Details */}
      <View style={s.bankSection}>
        <Text style={s.bankTitle}>Company&apos;s Bank Details</Text>
        <View style={s.bankRow}>
          <Text style={s.bankLabel}>Name</Text>
          <Text style={s.bankColon}>:</Text>
          <Text style={s.bankValue}>{company.name || 'ONTIME DELIVERIES'}</Text>
        </View>
        <View style={s.bankRow}>
          <Text style={s.bankLabel}>Bank</Text>
          <Text style={s.bankColon}>:</Text>
          <Text style={s.bankValue}>SBI, SONARI BRANCH, JAMSHEDPUR,{'\n'}JHARKHAND</Text>
        </View>
        <View style={s.bankRow}>
          <Text style={s.bankLabel}>A/C No</Text>
          <Text style={s.bankColon}>:</Text>
          <Text style={s.bankValue}>{company.bank_account || '42513324534'}</Text>
        </View>
        <View style={s.bankRow}>
          <Text style={s.bankLabel}>IFSC Code</Text>
          <Text style={s.bankColon}>:</Text>
          <Text style={s.bankValue}>{company.bank_ifsc || 'SBIN0006026'}</Text>
        </View>
      </View>

      {/* Signature */}
      <View style={s.signatureSection}>
        <Text style={s.sigHeader}>For ONTIME DELIVERIES</Text>
        {signatureUrl ? (
          <Image src={signatureUrl} style={s.sigImage} />
        ) : (
          <View style={{ height: 50 }} />
        )}
        <View style={s.sigFooter} />
      </View>
    </View>
  )
}

// ─── Main Document ───

function InvoiceDocument({ invoice, company, signatureUrl }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.outerBorder}>
          <Header company={company} />
          <CustomerMeta invoice={invoice} />
          <LineItemsTable invoice={invoice} />
          <Totals invoice={invoice} />
          <Footer company={company} signatureUrl={signatureUrl} />
        </View>
      </Page>
    </Document>
  )
}

// ─── Export ───

export async function generateInvoicePDF(invoice, company, signatureUrl) {
  const blob = await pdf(
    React.createElement(InvoiceDocument, { invoice, company, signatureUrl })
  ).toBlob()
  const arrayBuffer = await blob.arrayBuffer()
  return new Uint8Array(arrayBuffer)
}
