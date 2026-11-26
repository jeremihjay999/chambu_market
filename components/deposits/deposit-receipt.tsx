'use client'

import { useRef, useImperativeHandle, forwardRef } from 'react'
import { resolveMediaUrl } from '@/lib/media-url'

// ── Printable deposit receipt ────────────────────────────────────────────────
// Distinct from a sale receipt so a prepayment can never be confused for goods
// sold. Opens a popup window for printing (same pattern as the sales Receipt
// component) — avoids the fragile CSS-injection technique that could bleed
// through Dialog overlays and other positioned ancestors.

export interface DepositReceiptData {
  _id: string
  receiptNo: string
  amount: number
  balance: number
  method: string
  methodLabel: string
  customerName: string
  customerPhone: string
  cashierName?: string
  paymentReference?: string
  mpesaCode?: string
  note?: string
  createdAt: string
  // Shop info — mirrors the sales receipt header
  shopName?: string
  shopLogo?: string
  shopPhone?: string
  shopEmail?: string
  shopAddress?: string
  paperSize?: '58mm' | '80mm'
}

export interface DepositReceiptRef {
  print: () => void
}

const formatCurrency = (n: number) =>
  `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

const formatTime = (d: string) =>
  new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export const DepositReceipt = forwardRef<DepositReceiptRef, { deposit: DepositReceiptData }>(
  ({ deposit }, ref) => {
    const receiptRef = useRef<HTMLDivElement>(null)

    const paperSize = deposit.paperSize || '58mm'
    const pageCSS = paperSize === '80mm'
      ? `@page { size: 80mm auto; margin: 4mm; }`
      : `@page { size: 58mm auto; margin: 3mm; }`
    const bodyWidth = paperSize === '80mm' ? '72mm' : '52mm'
    const baseFont = paperSize === '80mm' ? '11px' : '10px'

    const styles = `
      @media print { ${pageCSS} body { margin: 0; padding: 0; } }
      body { font-family: Arial, Helvetica, sans-serif; max-width: ${bodyWidth}; margin: 0 auto; padding: 4px; font-size: ${baseFont}; line-height: 1.4; color: #111; }
      .header { text-align: center; border-bottom: 1px dashed #999; padding-bottom: 6px; margin-bottom: 6px; }
      .logo { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; margin: 0 auto 4px; display: block; }
      .company-name { font-size: 13px; font-weight: bold; }
      .company-details { font-size: 10px; color: #555; line-height: 1.3; }
      .doc-type { font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin-top: 5px; }
      .doc-sub { font-size: 9px; color: #666; margin-top: 2px; }
      .section { border-top: 1px dashed #bbb; padding-top: 5px; margin-top: 6px; }
      .kv { display: flex; justify-content: space-between; margin: 1px 0; }
      .kv .lbl { color: #666; }
      .kv .val { font-weight: 600; text-align: right; max-width: 60%; }
      .total-block { border-top: 2px solid #333; padding-top: 3px; margin-top: 6px; }
      .total-block .kv .lbl { font-weight: bold; }
      .total-block .kv .val { font-size: 12px; font-weight: bold; }
      .balance-line { margin-top: 3px; }
      .balance-line .val { color: #0c6b4e; }
      .footer { border-top: 1px dashed #999; padding-top: 6px; margin-top: 8px; text-align: center; font-size: 9px; color: #555; }
      .footer p { margin: 2px 0; }
      .served-by { font-style: italic; margin-top: 4px; }
    `

    const handlePrint = () => {
      if (!receiptRef.current) return
      const printWindow = window.open('', '', 'width=800,height=600')
      if (!printWindow) return
      printWindow.document.write(`
        <html>
          <head>
            <title>Deposit Receipt - ${deposit.receiptNo}</title>
            <style>${styles}</style>
          </head>
          <body>${receiptRef.current.innerHTML}</body>
        </html>
      `)
      printWindow.document.close()
      printWindow.focus()
      printWindow.onafterprint = () => printWindow.close()
      setTimeout(() => printWindow.print(), 250)
    }

    useImperativeHandle(ref, () => ({ print: handlePrint }))

    return (
      <div ref={receiptRef} style={{ display: 'none' }}>
        {/* Header */}
        <div className="header">
          {deposit.shopLogo && (
            <img src={resolveMediaUrl(deposit.shopLogo)} alt={deposit.shopName || 'Shop'} className="logo" />
          )}
          {deposit.shopName && <div className="company-name">{deposit.shopName}</div>}
          <div className="company-details">
            {deposit.shopPhone && <div>{deposit.shopPhone}</div>}
            {deposit.shopEmail && <div>{deposit.shopEmail}</div>}
            {deposit.shopAddress && <div>{deposit.shopAddress}</div>}
          </div>
          <div className="doc-type">Deposit Receipt</div>
          <div className="doc-sub">Customer Prepayment — Store Credit</div>
        </div>

        {/* Receipt meta */}
        <div className="section">
          <div className="kv"><span className="lbl">Receipt No.</span><span className="val">{deposit.receiptNo}</span></div>
          <div className="kv"><span className="lbl">Date</span><span className="val">{formatDate(deposit.createdAt)}</span></div>
          <div className="kv"><span className="lbl">Time</span><span className="val">{formatTime(deposit.createdAt)}</span></div>
        </div>

        {/* Customer */}
        <div className="section">
          <div className="kv"><span className="lbl">Customer</span><span className="val">{deposit.customerName}</span></div>
          {deposit.customerPhone && (
            <div className="kv"><span className="lbl">Phone</span><span className="val">{deposit.customerPhone}</span></div>
          )}
        </div>

        {/* Payment */}
        <div className="section">
          <div className="kv"><span className="lbl">Payment Method</span><span className="val">{deposit.methodLabel}</span></div>
          {deposit.paymentReference && (
            <div className="kv"><span className="lbl">Reference</span><span className="val">{deposit.paymentReference}</span></div>
          )}
          {deposit.mpesaCode && (
            <div className="kv"><span className="lbl">M-Pesa Code</span><span className="val">{deposit.mpesaCode}</span></div>
          )}
        </div>

        {/* Amount — heavy divider like sales receipt TOTAL */}
        <div className="total-block">
          <div className="kv"><span className="lbl">Amount Received</span><span className="val">{formatCurrency(deposit.amount)}</span></div>
          <div className="kv balance-line"><span className="lbl">Store Credit Balance</span><span className="val">{formatCurrency(deposit.balance)}</span></div>
        </div>

        {/* Note */}
        {deposit.note && (
          <div className="section">
            <div className="kv"><span className="lbl">Note</span><span className="val">{deposit.note}</span></div>
          </div>
        )}

        {/* Footer */}
        <div className="footer">
          <p>This is a prepayment. Goods have NOT been issued.</p>
          <p>Customer may shop against this balance later, in part or in full.</p>
          <p>Refunds of unused balance available on request.</p>
          {deposit.cashierName && (
            <p className="served-by">Received by: {deposit.cashierName}</p>
          )}
        </div>
      </div>
    )
  }
)

DepositReceipt.displayName = 'DepositReceipt'
