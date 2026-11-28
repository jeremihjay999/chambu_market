import { getTenantDB } from '@/lib/tenant/get-db'
import { getAuthPayload } from '@/lib/jwt'
import { NextRequest, NextResponse } from 'next/server'
import { Types } from 'mongoose'

// GET /api/customers/[id]/deposits
//
// Query params:
//   ?activeOnly=true  (default)  → only active + partial
//   ?all=true                    → include used/refunded/void (history view)
//
// Each deposit is enriched with:
//   createdByName  — resolved full name of the staff/user who took the deposit
//   branchName     — resolved branch name where it was taken
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await getAuthPayload()
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { models, conn } = await getTenantDB(request)
    const ownerId =
      payload.type === 'staff' && payload.adminId ? payload.adminId : payload.userId
    const { id } = await params

    if (!Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid customer id' }, { status: 400 })
    }

    const url = new URL(request.url)
    const all = url.searchParams.get('all') === 'true'

    const query: any = {
      userId: ownerId,
      customerId: new Types.ObjectId(id),
    }
    if (!all) {
      query.status = { $in: ['active', 'partial'] }
      query.balance = { $gt: 0 }
    }

    const deposits = await models.Deposit.find(query).sort({ createdAt: 1 }).lean() as any[]

    if (deposits.length === 0) {
      return NextResponse.json({ deposits: [] })
    }

    // ── Resolve createdByName ─────────────────────────────────────────────────
    const creatorIds = [...new Set(
      deposits
        .filter(d => d.createdBy)
        .map(d => d.createdBy.toString())
    )]

    const creatorNameMap = new Map<string, string>()

    if (creatorIds.length > 0) {
      const oids = creatorIds.map(i => new Types.ObjectId(i))
      const [staffDocs, userDocs] = await Promise.all([
        conn.db.collection('staff').find({ _id: { $in: oids } })
          .project({ _id: 1, name: 1, firstName: 1, lastName: 1 }).toArray(),
        conn.db.collection('users').find({ _id: { $in: oids } })
          .project({ _id: 1, firstName: 1, lastName: 1, shopName: 1, email: 1 }).toArray(),
      ])
      for (const s of staffDocs as any[]) {
        const name = [s.firstName, s.lastName].filter(Boolean).join(' ') || s.name || s._id.toString()
        creatorNameMap.set(s._id.toString(), name)
      }
      for (const u of userDocs as any[]) {
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.shopName || u.email || u._id.toString()
        creatorNameMap.set(u._id.toString(), name)
      }
    }

    // ── Resolve branchName ────────────────────────────────────────────────────
    const branchIds = [...new Set(
      deposits
        .filter(d => d.branchId)
        .map(d => d.branchId.toString())
    )]

    const branchNameMap = new Map<string, string>()

    if (branchIds.length > 0) {
      const oids = branchIds.map(i => new Types.ObjectId(i))
      const branchDocs = await conn.db.collection('branches').find({ _id: { $in: oids } })
        .project({ _id: 1, name: 1 }).toArray()
      for (const b of branchDocs as any[]) {
        branchNameMap.set(b._id.toString(), b.name || b._id.toString())
      }
    }

    // ── Stamp resolved fields onto each deposit ───────────────────────────────
    const enriched = deposits.map(d => ({
      ...d,
      createdByName: d.createdBy ? (creatorNameMap.get(d.createdBy.toString()) || null) : null,
      branchName:    d.branchId  ? (branchNameMap.get(d.branchId.toString())   || null) : null,
    }))

    return NextResponse.json({ deposits: enriched })
  } catch (error) {
    console.error('[customers/[id]/deposits] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch customer deposits' }, { status: 500 })
  }
}
