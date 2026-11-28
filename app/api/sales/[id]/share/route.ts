import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getTenantDB } from '@/lib/tenant/get-db'
import { getAuthPayload } from '@/lib/jwt'
import { getAdminModels } from '@/lib/admin-models'

// POST /api/sales/[id]/share
// Generates a public receipt token for a sale and registers it in the admin DB
// so the unauthenticated /r/[token] PDF route can resolve the tenant connection.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = await getAuthPayload()
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { models } = await getTenantDB(request)
    const ownerId =
      payload.type === 'staff' && payload.adminId ? payload.adminId : payload.userId
    const { id } = await params

    const sale = await models.Sale.findOne({ _id: id, userId: ownerId })
    if (!sale) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    }

    // Generate once; reuse on subsequent calls
    if (!sale.receiptToken) {
      sale.receiptToken = crypto.randomBytes(18).toString('base64url')
      await sale.save()
    }

    // Register token → tenant DB mapping in admin DB
    const { SaleShare } = await getAdminModels()
    await SaleShare.findOneAndUpdate(
      { shareToken: sale.receiptToken },
      {
        $set: {
          userId:           ownerId.toString(),
          saleId:           id,
          mongoUri:         payload.mongoUri         || '',
          mongoUriFallback: payload.mongoUriFallback || '',
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    )

    return NextResponse.json({ receiptToken: sale.receiptToken })
  } catch (error: any) {
    console.error('[sales/share]', error)
    return NextResponse.json(
      { error: 'Failed to generate receipt link', details: error.message },
      { status: 500 }
    )
  }
}
