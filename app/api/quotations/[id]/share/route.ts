import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getTenantDB } from '@/lib/tenant/get-db'
import { getAuthPayload } from '@/lib/jwt'
import { getAdminModels } from '@/lib/admin-models'

// Generate (if needed) and return the public share token for a quotation.
// Also registers the token -> tenant-DB mapping in the admin DB so the
// unauthenticated public endpoint can find the quote.
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

    const quotation = await models.Quotation.findOne({ _id: id, userId: ownerId })
    if (!quotation) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 })
    }

    // Generate an unguessable token the first time the quote is shared.
    let generated = false
    if (!quotation.shareToken) {
      quotation.shareToken = crypto.randomBytes(18).toString('base64url')
      generated = true
    }
    // Mark the sent tick the first time it's shared.
    if (!quotation.sentAt) {
      quotation.sentAt = new Date()
      generated = true
    }
    if (generated) await quotation.save()

    // Register the share in the admin DB (public endpoint has no auth/JWT).
    const { QuotationShare } = await getAdminModels()
    await QuotationShare.findOneAndUpdate(
      { shareToken: quotation.shareToken },
      {
        $set: {
          userId: ownerId.toString(),
          quotationId: id,
          mongoUri: payload.mongoUri || '',
          mongoUriFallback: payload.mongoUriFallback || '',
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    )

    return NextResponse.json({ shareToken: quotation.shareToken })
  } catch (error: any) {
    console.error('Share quotation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate share link', details: error.message },
      { status: 500 }
    )
  }
}
