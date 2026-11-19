import { NextRequest, NextResponse } from 'next/server'
import { getAdminModels } from '@/lib/admin-models'
import { verifyAdminSession } from '../auth/route'

export async function GET(request: NextRequest) {
  if (!await verifyAdminSession(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { Cluster, Tenant } = await getAdminModels()
    const clusters = await Cluster.find().sort({ createdAt: 1 }).lean() as any[]

    // Attach live member counts
    const enriched = await Promise.all(clusters.map(async (c) => {
      // Normalise legacy field names
      const uri1 = c.uri1 || c.baseUriSrv || c.baseUri || ''
      const uri2 = c.uri2 || (c.baseUriSrv && c.baseUri ? c.baseUri : '')

      const orConditions: any[] = [{ clusterId: c._id }]
      for (const uri of [uri1, uri2]) {
        if (!uri) continue
        const base = uri.split('?')[0].replace(/\/$/, '')
        if (!base) continue
        const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        orConditions.push({ mongoUri: { $regex: `^${escaped}` } })
      }
      const liveCount = await Tenant.countDocuments({ $or: orConditions })
      if (c.tenantCount !== liveCount) {
        Cluster.findByIdAndUpdate(c._id, { $set: { tenantCount: liveCount } }).exec().catch(() => {})
      }
      return { ...c, uri1, uri2, tenantCount: liveCount }
    }))

    return NextResponse.json({ clusters: enriched })
  } catch (err) {
    console.error('[admin/clusters GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  if (!await verifyAdminSession(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { Cluster } = await getAdminModels()
    const { name, uri1, uri2, maxTenants } = await request.json()

    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
    if (!uri1) return NextResponse.json({ error: 'uri1 is required' }, { status: 400 })
    if (uri2 && uri2.trim() === uri1.trim()) {
      return NextResponse.json({ error: 'uri1 and uri2 must be different' }, { status: 400 })
    }

    const cluster = new Cluster({
      name,
      uri1: uri1.trim(),
      uri2: uri2 ? uri2.trim() : '',
      maxTenants: maxTenants || 5,
    })
    await cluster.save()
    return NextResponse.json({ cluster }, { status: 201 })
  } catch (err) {
    console.error('[admin/clusters POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
