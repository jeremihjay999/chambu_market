import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getAdminModels } from '@/lib/admin-models'
import { connectTenantDB } from '@/lib/db-tenant'
import { isMongoOfflineError } from '@/lib/tenant/get-db'
import { connectDB } from '@/lib/db'
import { getModels } from '@/lib/tenant/get-models'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { QuotationDocument } from '@/lib/pdf/quotation-document'
import { resolveMediaUrl } from '@/lib/media-url'

// Compute paid / remaining from item checklist state — mirrors the existing
// public API route logic exactly so numbers are consistent.
function computeTotals(items: any[], cartDiscount: number) {
  const lineOf = (i: any) =>
    i.lineTotal ?? i.quantity * i.unitPrice - (i.discount || 0)
  const active   = (items || []).filter((i: any) => !i.removed)
  const subtotal = active.reduce((s: number, i: any) => s + lineOf(i), 0)
  const total    = Math.max(0, subtotal - (cartDiscount || 0))
  const paid     = active
    .filter((i: any) => i.checked)
    .reduce((s: number, i: any) => s + lineOf(i), 0)
  const remaining = Math.max(0, total - paid)
  return { subtotal, total, paid, remaining }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    // ── Resolve share token → quotation ──────────────────────────────────────
    const { QuotationShare } = await getAdminModels()
    const share = (await QuotationShare.findOne({ shareToken: token }).lean()) as any
    if (!share) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // ── Tenant DB connection ──────────────────────────────────────────────────
    let conn: mongoose.Connection
    if (share.mongoUri) {
      try {
        conn = await connectTenantDB(share.mongoUri)
      } catch (err) {
        if (isMongoOfflineError(err) && share.mongoUriFallback) {
          conn = await connectTenantDB(share.mongoUriFallback)
        } else {
          throw err
        }
      }
    } else {
      await connectDB()
      conn = mongoose.connection
    }

    const models = getModels(conn)
    const quotation = (await models.Quotation.findById(share.quotationId).lean()) as any
    if (!quotation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // ── Shop branding + payment info ──────────────────────────────────────────
    const user    = (await models.User.findById(quotation.userId).lean()) as any
    const s: any  = user?.settings || {}
    const general = s.general || s.shop || {}
    const payment = s.payment || {}

    const shop = {
      shopName:           general.shopName || user?.shopName || '',
      logo:               general.logo ? resolveMediaUrl(general.logo) : '',
      phone:              general.phone  || user?.phone  || '',
      email:              general.email  || user?.email  || '',
      address:            general.address || '',
      website:            s.website || '',
      quotationTerms:     s.quotationTerms || '',
      mpesaPaybill:       payment.mpesaPaybill       || s.mpesaPaybill       || '',
      mpesaAccountNumber: payment.mpesaAccountNumber || s.mpesaAccountNumber || '',
      bankDetails:        s.bankDetails || '',
    }

    const { subtotal, total, paid, remaining } = computeTotals(
      quotation.items,
      quotation.discount
    )

    const pdfData = {
      quotationNumber: quotation.quotationNumber,
      customerName:    quotation.customerName,
      customerPhone:   quotation.customerPhone  || '',
      customerEmail:   quotation.customerEmail  || '',
      items: (quotation.items || []).map((i: any) => ({
        productName: i.productName,
        quantity:    i.quantity,
        unitPrice:   i.unitPrice,
        discount:    i.discount  || 0,
        lineTotal:   i.lineTotal ?? i.quantity * i.unitPrice - (i.discount || 0),
        checked:     !!i.checked,
        removed:     !!i.removed,
      })),
      subtotal,
      discount:  quotation.discount || 0,
      total,
      paid,
      remaining,
      validUntil: quotation.validUntil,
      createdAt:  quotation.createdAt,
      notes:      quotation.notes || '',
      shop,
    }

    // ── Render PDF ────────────────────────────────────────────────────────────
    const buffer = await renderToBuffer(
      React.createElement(QuotationDocument, { data: pdfData })
    )

    const filename = `Quotation-${quotation.quotationNumber}.pdf`

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        // inline → browser renders in its native PDF viewer (download button in corner)
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length':      String(buffer.byteLength),
        // Allow browsers to cache for 5 minutes; quotation content rarely changes
        // between rapid successive opens from the same WhatsApp message.
        'Cache-Control':       'public, max-age=300',
      },
    })
  } catch (error: any) {
    console.error('[/q/[token] PDF]', error)
    return NextResponse.json(
      { error: 'Failed to generate quotation PDF' },
      { status: 500 }
    )
  }
}
