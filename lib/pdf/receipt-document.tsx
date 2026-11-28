import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReceiptItem {
  productName: string
  brand?: string
  model?: string
  variant?: string
  quantity: number
  price: number
  discount: number
  total: number
}

export interface PaymentEntry {
  method: string
  amount: number
  mpesaCode?: string
  customMethodName?: string
}

export interface ReceiptPdfData {
  orderNumber: string
  date: string            // ISO string
  customerName?: string
  customerPhone?: string
  items: ReceiptItem[]
  subtotal: number
  discount: number
  total: number
  payments?: PaymentEntry[]
  paymentMethod?: string
  cashPaid?: number
  debtCreated?: number
  depositBalance?: number
  depositDrawn?: number
  customerBalance?: number
  cashierName?: string
  branchName?: string
  shop: {
    shopName: string
    logo?: string
    phone?: string
    email?: string
    address?: string
    mpesaPaybill?: string
    mpesaAccountNumber?: string
    termsEnabled?: boolean
    termsText?: string
  }
}

// ── Page dimensions: 80mm wide, auto height ──────────────────────────────────
const W = 226.77

const C = {
  black: '#111111',
  dark:  '#333333',
  mid:   '#555555',
  light: '#888888',
  pale:  '#cccccc',
  white: '#ffffff',
  green: '#166534',
  red:   '#991b1b',
  amber: '#78350f',
  blue:  '#0c2d6b',
}

const s = StyleSheet.create({
  page: {
    width: W,
    backgroundColor: C.white,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 20,
    fontFamily: 'Helvetica',
  },
  headerCenter: { alignItems: 'center', marginBottom: 6, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: C.pale, borderStyle: 'dashed' },
  logo: { width: 44, height: 44, borderRadius: 22, marginBottom: 4 },
  shopName: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.black, textAlign: 'center' },
  branchName: { fontSize: 9, color: C.mid, textAlign: 'center', marginTop: 1 },
  shopContact: { fontSize: 7, color: C.light, textAlign: 'center', marginTop: 1, lineHeight: 1.4 },
  docType: { fontSize: 9, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 1, marginTop: 4, textAlign: 'center' },
  section: { borderTopWidth: 1, borderTopColor: C.pale, borderStyle: 'dashed', paddingTop: 5, marginTop: 6 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1 },
  lbl: { fontSize: 7, color: C.light },
  val: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.dark, textAlign: 'right', maxWidth: '65%' },
  itemBlock: { marginVertical: 2 },
  itemName: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.black },
  itemSub: { fontSize: 7, color: C.mid, marginTop: 1 },
  itemMeta: { fontSize: 7, color: C.mid, marginTop: 1 },
  itemTotalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 1 },
  itemTotal: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.dark },
  totalsSection: { borderTopWidth: 1, borderTopColor: C.pale, borderStyle: 'dashed', paddingTop: 5, marginTop: 6 },
  totalFinalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingTop: 4, borderTopWidth: 2, borderTopColor: C.dark },
  totalFinalLbl: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.black },
  totalFinalVal: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.black },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  balanceLbl: { fontSize: 7, color: C.mid },
  balanceVal: { fontSize: 7, fontFamily: 'Helvetica-Bold' },
  blockSection: { borderTopWidth: 1, borderTopColor: C.pale, borderStyle: 'dashed', paddingTop: 5, marginTop: 6 },
  blockTitle: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.dark, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
  blockText: { fontSize: 7, color: C.mid, lineHeight: 1.5 },
  footer: { borderTopWidth: 1, borderTopColor: C.pale, borderStyle: 'dashed', paddingTop: 6, marginTop: 10, alignItems: 'center' },
  footerText: { fontSize: 7, color: C.light, textAlign: 'center', marginTop: 1 },
  poweredBy: { fontSize: 6, color: C.pale, marginTop: 4 },
  noticeDebt: { backgroundColor: '#fef08a', borderWidth: 1, borderColor: '#facc15', borderStyle: 'dashed', borderRadius: 3, padding: 4, marginTop: 4, alignItems: 'center' },
  noticeCredit: { backgroundColor: '#dcfce7', borderWidth: 1, borderColor: '#86efac', borderStyle: 'dashed', borderRadius: 3, padding: 4, marginTop: 4, alignItems: 'center' },
  noticeText: { fontSize: 7, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
})

const money = (n: number) =>
  `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })

function KV({ label, value, valColor }: { label: string; value: string; valColor?: string }) {
  return (
    <View style={s.kv}>
      <Text style={s.lbl}>{label}</Text>
      <Text style={[s.val, valColor ? { color: valColor } : {}]}>{value}</Text>
    </View>
  )
}

function methodLabel(p: PaymentEntry): string {
  if (p.method === 'custom' && p.customMethodName) return p.customMethodName
  const map: Record<string, string> = {
    cash: 'Cash', mobile_money: 'M-Pesa', card: 'Card',
    credit: 'Credit', bank: 'Bank Transfer', deposit: 'Store Credit',
    mpesa_stk: 'M-Pesa STK', mpesa_manual: 'M-Pesa Manual',
  }
  return map[p.method] || p.method
}

export function ReceiptDocument({ data }: { data: ReceiptPdfData }) {
  const { shop, items } = data

  // Consolidate payments by method
  const paymentMap: Record<string, PaymentEntry> = {}
  if (data.payments?.length) {
    data.payments.forEach(p => {
      const key = p.method === 'custom' && p.customMethodName ? p.customMethodName : p.method
      if (paymentMap[key]) paymentMap[key].amount += p.amount
      else paymentMap[key] = { ...p }
    })
  }
  const consolidatedPayments = Object.values(paymentMap)
  const totalPaid = consolidatedPayments.reduce((s, p) => s + p.amount, 0)

  return (
    <Document title={`Receipt ${data.orderNumber}`} author={shop.shopName}>
      <Page size={{ width: W }} style={s.page}>

        {/* Header */}
        <View style={s.headerCenter}>
          {shop.logo ? <Image src={shop.logo} style={s.logo} /> : null}
          <Text style={s.shopName}>{shop.shopName}</Text>
          {data.branchName && <Text style={s.branchName}>{data.branchName}</Text>}
          <Text style={s.shopContact}>
            {[shop.phone, shop.email, shop.address].filter(Boolean).join('  ·  ')}
          </Text>
          <Text style={s.docType}>Sales Receipt</Text>
        </View>

        {/* Order meta */}
        <View style={s.section}>
          <KV label="Order No." value={data.orderNumber} />
          <KV label="Date"      value={fmtDate(data.date)} />
          <KV label="Time"      value={fmtTime(data.date)} />
        </View>

        {/* Customer */}
        <View style={s.section}>
          <KV label="Customer" value={data.customerName || 'Cash Sale'} />
          {data.customerPhone && <KV label="Phone" value={data.customerPhone} />}
          {data.customerBalance != null && data.customerBalance > 0 && (
            <KV label="Outstanding" value={money(data.customerBalance)} valColor={C.amber} />
          )}
        </View>

        {/* Items */}
        <View style={s.section}>
          {items.map((item, i) => {
            const desc = [item.brand, item.model, item.variant].filter(Boolean).join(' · ')
            return (
              <View key={i} style={s.itemBlock}>
                <Text style={s.itemName}>{item.productName}</Text>
                {desc ? <Text style={s.itemSub}>{desc}</Text> : null}
                <Text style={s.itemMeta}>
                  {item.quantity} × {money(item.price)}
                  {item.discount > 0 ? `  disc -${money(item.discount)}` : ''}
                </Text>
                <View style={s.itemTotalRow}>
                  <Text style={s.itemTotal}>{money(item.total)}</Text>
                </View>
              </View>
            )
          })}
        </View>

        {/* Totals */}
        <View style={s.totalsSection}>
          <KV label="Subtotal" value={money(data.subtotal)} />
          {data.discount > 0 && <KV label="Discount" value={`- ${money(data.discount)}`} />}
          <View style={s.totalFinalRow}>
            <Text style={s.totalFinalLbl}>TOTAL</Text>
            <Text style={s.totalFinalVal}>{money(data.total)}</Text>
          </View>
        </View>

        {/* Payment breakdown */}
        <View style={s.section}>
          {consolidatedPayments.length > 0 ? (
            <>
              {consolidatedPayments.map((p, i) => (
                <KV key={i} label={methodLabel(p)} value={money(p.amount)} />
              ))}
              {totalPaid > data.total && (
                <KV label="Change" value={money(totalPaid - data.total)} valColor={C.green} />
              )}
            </>
          ) : (
            <KV label="Payment" value={data.paymentMethod || ''} />
          )}
          {data.debtCreated != null && data.debtCreated > 0 && (
            <>
              <KV label="Cash Received" value={money(data.cashPaid ?? 0)} />
              <KV label="On Account"    value={money(data.debtCreated)} valColor={C.amber} />
            </>
          )}
        </View>

        {/* Store credit movement */}
        {data.depositDrawn != null && data.depositDrawn > 0 && data.depositBalance != null && (
          <View style={s.section}>
            <KV label="Previous Store Credit" value={money(data.depositBalance + data.depositDrawn)} />
            <KV label="Store Credit Used"     value={`- ${money(data.depositDrawn)}`} valColor={C.red} />
            <KV label="Store Credit Balance"  value={money(data.depositBalance)} valColor={C.blue} />
          </View>
        )}

        {/* Debt added notice */}
        {data.debtCreated != null && data.debtCreated > 0 && (
          <View style={s.noticeDebt}>
            <Text style={[s.noticeText, { color: C.amber }]}>
              {money(data.debtCreated)} added to your account
            </Text>
          </View>
        )}

        {/* M-Pesa paybill */}
        {shop.mpesaPaybill && (
          <View style={s.blockSection}>
            <KV label="M-PESA Paybill" value={shop.mpesaPaybill} />
            {shop.mpesaAccountNumber && (
              <KV label="Account No." value={shop.mpesaAccountNumber} />
            )}
          </View>
        )}

        {/* Terms */}
        {shop.termsEnabled && shop.termsText && (
          <View style={s.blockSection}>
            <Text style={s.blockTitle}>Terms &amp; Conditions</Text>
            <Text style={s.blockText}>{shop.termsText}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>Thank You For Shopping With Us!</Text>
          {data.cashierName && (
            <Text style={s.footerText}>Served by: {data.cashierName}</Text>
          )}
          <Text style={s.poweredBy}>Powered by Chambu Digital</Text>
        </View>

      </Page>
    </Document>
  )
}
