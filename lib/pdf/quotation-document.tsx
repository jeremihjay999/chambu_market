import React from 'react'
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from '@react-pdf/renderer'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QuotationItem {
  productName: string
  quantity: number
  unitPrice: number
  discount?: number
  lineTotal: number
  checked?: boolean
  removed?: boolean
}

export interface QuotationPdfData {
  quotationNumber: string
  customerName: string
  customerPhone?: string
  customerEmail?: string
  items: QuotationItem[]
  subtotal: number
  discount: number
  total: number
  paid: number
  remaining: number
  validUntil: string   // ISO string
  createdAt: string    // ISO string
  notes?: string
  shop: {
    shopName: string
    logo?: string        // resolved absolute URL or base64
    phone?: string
    email?: string
    address?: string
    website?: string
    quotationTerms?: string
    mpesaPaybill?: string
    mpesaAccountNumber?: string
    bankDetails?: string
    branchName?: string
  }
}

// ── Page dimensions: 80mm wide, auto height ──────────────────────────────────
// Height is omitted so react-pdf sizes the page to its content exactly.
// A 3-item receipt produces a short PDF; a 20-item quotation produces a taller
// one. No wasted paper, no empty scroll in the browser viewer.
// 1pt ≈ 0.3528mm → 80mm ≈ 226.77pt

const W = 226.77

// ── Colour palette ────────────────────────────────────────────────────────────
const C = {
  black:  '#111111',
  dark:   '#333333',
  mid:    '#555555',
  light:  '#888888',
  pale:   '#cccccc',
  white:  '#ffffff',
  accent: '#1a1a1a',
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    width: W,
    backgroundColor: C.white,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 20,
    fontFamily: 'Helvetica',
  },

  // Header
  headerCenter: { alignItems: 'center', marginBottom: 6, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: C.pale, borderStyle: 'dashed' },
  logo: { width: 44, height: 44, borderRadius: 22, marginBottom: 4 },
  shopName: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.black, textAlign: 'center' },
  shopContact: { fontSize: 7, color: C.light, textAlign: 'center', marginTop: 1, lineHeight: 1.4 },
  docType: { fontSize: 9, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 1, marginTop: 4, textAlign: 'center', color: C.accent },

  // Section divider
  section: { borderTopWidth: 1, borderTopColor: C.pale, borderStyle: 'dashed', paddingTop: 5, marginTop: 6 },

  // Key-value row
  kv: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1 },
  lbl: { fontSize: 7, color: C.light },
  val: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.dark, textAlign: 'right', maxWidth: '65%' },

  // Item rows
  itemBlock: { marginVertical: 3 },
  itemName: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.black },
  itemNameRemoved: { fontSize: 8, color: C.light, textDecoration: 'line-through' },
  itemNamePaid: { fontSize: 8, color: C.light },
  itemMeta: { fontSize: 7, color: C.mid, marginTop: 1 },
  itemTotalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 1 },
  itemTotal: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.dark },
  itemTotalRemoved: { fontSize: 7, color: C.pale, textDecoration: 'line-through' },
  removedBadge: { fontSize: 6, color: '#cc0000', marginLeft: 4 },
  paidBadge: { fontSize: 6, color: '#166534', marginLeft: 4 },

  // Totals block
  totalsSection: { borderTopWidth: 1, borderTopColor: C.pale, borderStyle: 'dashed', paddingTop: 5, marginTop: 6 },
  totalFinalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingTop: 4, borderTopWidth: 2, borderTopColor: C.dark },
  totalFinalLbl: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.black },
  totalFinalVal: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.black },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  balanceLbl: { fontSize: 7, color: C.mid },
  paidVal: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#166534' },
  remainingVal: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#991b1b' },

  // Payment / notes blocks
  blockSection: { borderTopWidth: 1, borderTopColor: C.pale, borderStyle: 'dashed', paddingTop: 5, marginTop: 6 },
  blockTitle: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.dark, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
  blockText: { fontSize: 7, color: C.mid, lineHeight: 1.5 },

  // Footer
  footer: { borderTopWidth: 1, borderTopColor: C.pale, borderStyle: 'dashed', paddingTop: 6, marginTop: 10, alignItems: 'center' },
  footerText: { fontSize: 7, color: C.light, textAlign: 'center', marginTop: 1 },
  poweredBy: { fontSize: 6, color: C.pale, marginTop: 4 },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

const money = (n: number) =>
  `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

// ── KV row component ──────────────────────────────────────────────────────────

function KV({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.kv}>
      <Text style={s.lbl}>{label}</Text>
      <Text style={s.val}>{value}</Text>
    </View>
  )
}

// ── Main document ─────────────────────────────────────────────────────────────

export function QuotationDocument({ data }: { data: QuotationPdfData }) {
  const { shop, items } = data
  const hasDiscount = items.some(i => (i.discount || 0) > 0)
  const activeItems  = items.filter(i => !i.removed)
  const removedItems = items.filter(i => i.removed)

  return (
    <Document title={`Quotation ${data.quotationNumber}`} author={shop.shopName}>
      <Page size={{ width: W }} style={s.page}>

        {/* ── Header ── */}
        <View style={s.headerCenter}>
          {shop.logo ? (
            <Image src={shop.logo} style={s.logo} />
          ) : null}
          <Text style={s.shopName}>{shop.shopName}</Text>
          {shop.branchName ? <Text style={s.shopContact}>{shop.branchName}</Text> : null}
          <Text style={s.shopContact}>
            {[shop.phone, shop.email, shop.address].filter(Boolean).join('  ·  ')}
          </Text>
          <Text style={s.docType}>Quotation</Text>
        </View>

        {/* ── Meta ── */}
        <View style={s.section}>
          <KV label="Quotation No." value={data.quotationNumber} />
          <KV label="Date"          value={fmtDate(data.createdAt)} />
          <KV label="Time"          value={fmtTime(data.createdAt)} />
          <KV label="Valid Until"   value={fmtDate(data.validUntil)} />
        </View>

        {/* ── Customer ── */}
        <View style={s.section}>
          <KV label="Customer" value={data.customerName} />
          {data.customerPhone && <KV label="Phone" value={data.customerPhone} />}
          {data.customerEmail && <KV label="Email" value={data.customerEmail} />}
        </View>

        {/* ── Items ── */}
        <View style={s.section}>
          {activeItems.map((item, i) => {
            const isPaid    = !!item.checked
            const lineTotal = item.lineTotal ?? item.quantity * item.unitPrice - (item.discount || 0)
            const metaParts = [`${item.quantity} × ${money(item.unitPrice)}`]
            if ((item.discount || 0) > 0) metaParts.push(`disc -${money(item.discount!)}`)

            return (
              <View key={i} style={s.itemBlock}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={isPaid ? s.itemNamePaid : s.itemName}>
                    {item.productName}
                  </Text>
                  {isPaid && <Text style={s.paidBadge}>✓ paid</Text>}
                </View>
                <Text style={s.itemMeta}>{metaParts.join('  ')}</Text>
                <View style={s.itemTotalRow}>
                  <Text style={isPaid ? s.itemTotalRemoved : s.itemTotal}>
                    {money(lineTotal)}
                  </Text>
                </View>
              </View>
            )
          })}

          {/* Removed items — shown struck-through at the bottom */}
          {removedItems.length > 0 && (
            <>
              <View style={{ borderTopWidth: 1, borderTopColor: C.pale, borderStyle: 'dashed', marginTop: 4, paddingTop: 4 }}>
                <Text style={[s.lbl, { marginBottom: 3 }]}>REMOVED ITEMS</Text>
              </View>
              {removedItems.map((item, i) => {
                const lineTotal = item.lineTotal ?? item.quantity * item.unitPrice - (item.discount || 0)
                return (
                  <View key={i} style={s.itemBlock}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={s.itemNameRemoved}>{item.productName}</Text>
                      <Text style={s.removedBadge}>removed</Text>
                    </View>
                    <Text style={[s.itemMeta, { textDecoration: 'line-through' }]}>
                      {item.quantity} × {money(item.unitPrice)}
                    </Text>
                  </View>
                )
              })}
            </>
          )}
        </View>

        {/* ── Totals ── */}
        <View style={s.totalsSection}>
          <KV label="Subtotal" value={money(data.subtotal)} />
          {data.discount > 0 && <KV label="Discount" value={`- ${money(data.discount)}`} />}
          <View style={s.totalFinalRow}>
            <Text style={s.totalFinalLbl}>TOTAL</Text>
            <Text style={s.totalFinalVal}>{money(data.total)}</Text>
          </View>
          {data.paid > 0 && (
            <View style={s.balanceRow}>
              <Text style={s.balanceLbl}>Paid</Text>
              <Text style={s.paidVal}>{money(data.paid)}</Text>
            </View>
          )}
          {data.remaining > 0 && (
            <View style={s.balanceRow}>
              <Text style={s.balanceLbl}>Balance Due</Text>
              <Text style={s.remainingVal}>{money(data.remaining)}</Text>
            </View>
          )}
          {data.remaining === 0 && data.total > 0 && (
            <View style={s.balanceRow}>
              <Text style={s.balanceLbl}>Status</Text>
              <Text style={s.paidVal}>✓ Fully Paid</Text>
            </View>
          )}
        </View>

        {/* ── Payment instructions ── */}
        {(shop.mpesaPaybill || shop.bankDetails) && (
          <View style={s.blockSection}>
            <Text style={s.blockTitle}>How to Pay</Text>
            {shop.mpesaPaybill && (
              <>
                <KV label="M-PESA Paybill"  value={shop.mpesaPaybill} />
                {shop.mpesaAccountNumber && (
                  <KV label="Account No." value={shop.mpesaAccountNumber} />
                )}
              </>
            )}
            {shop.bankDetails && (
              <Text style={[s.blockText, { marginTop: 3 }]}>{shop.bankDetails}</Text>
            )}
            {shop.phone && (
              <KV label="Call / WhatsApp" value={shop.phone} />
            )}
          </View>
        )}

        {/* ── Notes ── */}
        {data.notes ? (
          <View style={s.blockSection}>
            <Text style={s.blockTitle}>Notes</Text>
            <Text style={s.blockText}>{data.notes}</Text>
          </View>
        ) : null}

        {/* ── Terms ── */}
        {shop.quotationTerms ? (
          <View style={s.blockSection}>
            <Text style={s.blockTitle}>Terms &amp; Conditions</Text>
            <Text style={s.blockText}>{shop.quotationTerms}</Text>
          </View>
        ) : null}

        {/* ── Footer ── */}
        <View style={s.footer}>
          <Text style={s.footerText}>Thank you for your business!</Text>
          {shop.website && <Text style={s.footerText}>{shop.website}</Text>}
          <Text style={s.poweredBy}>Powered by Chambu Digital</Text>
        </View>

      </Page>
    </Document>
  )
}
