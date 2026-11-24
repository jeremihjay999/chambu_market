import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getAdminModels } from '@/lib/admin-models'
import { connectTenantDB } from '@/lib/db-tenant'
import { isMongoOfflineError } from '@/lib/tenant/get-db'
import { connectDB } from '@/lib/db'
import { getModels } from '@/lib/tenant/get-models'

// Compute Paid / Remaining / Total from item checklist state.
// Total = sum of active (non-removed) line totals − cart discount.
// Paid = sum of checked (and non-removed) line totals.
function computeTotals(items: any[], cartDiscount: number) {
  const lineOf = (i: any) =>
    i.lineTotal ?? i.quantity * i.unitPrice - (i.discount || 0)
  const active = (items || []).filter((i: any) => !i.removed)
  const subtotal = active.reduce((s, i) => s + lineOf(i), 0)
  const total = Math.max(0, subtotal - (cartDiscount || 0))
  const paid = active.filter((i: any) => i.checked).reduce((s, i) => s + lineOf(i), 0)
  const remaining = Math.max(0, total - paid)
  return { subtotal, total, paid, remaining }
}

// Public, unauthenticated quotation view used by the /q/[token] share page.
// Returns only public-facing fields — no cost prices, no other customers,
// no internal ids.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const { QuotationShare } = await getAdminModels()
    const share = (await QuotationShare.findOne({ shareToken: token }).lean()) as any
    if (!share) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Resolve the tenant connection. Empty mongoUri => default MONGODB_URI DB.
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

    // Shop branding + public payment info from the owner user's settings.
    const user = (await models.User.findById(quotation.userId).lean()) as any
    const s: any = user?.settings || {}
    const general = s.general || s.shop || {}
    const payment = s.payment || {}
    const shop = {
      shopName: general.shopName || user?.shopName || '',
      logo: general.logo || '',
      phone: general.phone || user?.phone || '',
      email: general.email || user?.email || '',
      address: general.address || '',
      quotationTerms: s.quotationTerms || '',
      mpesaPaybill: payment.mpesaPaybill || s.mpesaPaybill || '',
      mpesaAccountNumber: payment.mpesaAccountNumber || s.mpesaAccountNumber || '',
      bankDetails: s.bankDetails || '',
      website: s.website || '',
    }

    const { subtotal, total, paid, remaining } = computeTotals(
      quotation.items,
      quotation.discount
    )

    return NextResponse.json({
      quotation: {
        quotationNumber: quotation.quotationNumber,
        customerName: quotation.customerName,
        items: (quotation.items || []).map((i: any) => ({
          productName: i.productName,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          discount: i.discount || 0,
          lineTotal: i.lineTotal ?? i.quantity * i.unitPrice - (i.discount || 0),
          checked: !!i.checked,
          removed: !!i.removed,
        })),
        subtotal,
        discount: quotation.discount || 0,
        total,
        paid,
        remaining,
        validUntil: quotation.validUntil,
        createdAt: quotation.createdAt,
        notes: quotation.notes || '',
        shop,
      },
    })
  } catch (error: any) {
    console.error('Public quotation error:', error)
    return NextResponse.json({ error: 'Failed to load quotation' }, { status: 500 })
  }
}
