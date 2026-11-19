import { NextRequest, NextResponse } from 'next/server'
import { getAdminModels } from '@/lib/admin-models'
import { verifyAdminSession } from '../../auth/route'

// Builds a tenant-specific URI by inserting subdomain as db name before the query string
function buildUri(base: string, subdomain: string): string {
  if (!base) return ''
  const [hostPart, ...queryParts] = base.trim().replace(/\/$/, '').split('?')
  return queryParts.length > 0
    ? `${hostPart}/${subdomain}?${queryParts.join('?')}`
    : `${hostPart}/${subdomain}`
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await verifyAdminSession(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { Cluster, Tenant } = await getAdminModels()

  const clusterRaw = await Cluster.findById(id).lean() as any
  if (!clusterRaw) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Normalise legacy field names to uri1/uri2
  const cluster = {
    ...clusterRaw,
    uri1: clusterRaw.uri1 || clusterRaw.baseUriSrv || clusterRaw.baseUri || '',
    uri2: clusterRaw.uri2 || (
      // If the old doc had both baseUriSrv and baseUri, the second one becomes uri2
      clusterRaw.baseUriSrv && clusterRaw.baseUri ? clusterRaw.baseUri : ''
    ),
  }

  // Build prefix conditions for both uri1 and uri2 plus explicit clusterId
  const orConditions: any[] = [{ clusterId: cluster._id }]
  for (const uriField of ['uri1', 'uri2'] as const) {
    const raw = (cluster[uriField] || '').trim()
    if (!raw) continue
    const base = raw.split('?')[0].replace(/\/$/, '')
    if (!base) continue
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    orConditions.push({ mongoUri: { $regex: `^${escaped}` } })
  }

  const members = await Tenant.find({ $or: orConditions })
    .select('_id subdomain shopName isActive createdAt clusterId mongoUri mongoUriFallback')
    .lean()

  console.log('[cluster GET] id:', id)
  console.log('[cluster GET] members found:', members.length)

  // Backfill: set clusterId, mongoUri (from uri1), mongoUriFallback (from uri2)
  const needsBackfill = members.filter((m: any) =>
    !m.clusterId ||
    m.clusterId.toString() !== id ||
    !m.mongoUriFallback
  )
  if (needsBackfill.length > 0) {
    await Promise.all(needsBackfill.map(async (m: any) => {
      const updates: any = { clusterId: cluster._id }
      if (cluster.uri1) updates.mongoUri         = buildUri(cluster.uri1, m.subdomain)
      if (cluster.uri2) updates.mongoUriFallback  = buildUri(cluster.uri2, m.subdomain)
      await Tenant.findByIdAndUpdate(m._id, { $set: updates }, { strict: false })
    }))
  }

  // Sync tenantCount
  if (cluster.tenantCount !== members.length) {
    await Cluster.findByIdAndUpdate(id, { $set: { tenantCount: members.length } })
    cluster.tenantCount = members.length
  }

  return NextResponse.json({ cluster, members })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await verifyAdminSession(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { Cluster, Tenant } = await getAdminModels()

  const body = await request.json()

  // If updating URIs, validate they are not duplicates
  if (body.uri1 !== undefined || body.uri2 !== undefined) {
    const existing = await Cluster.findById(id).lean() as any
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const newUri1 = (body.uri1 !== undefined ? body.uri1 : existing.uri1 || '').trim()
    const newUri2 = (body.uri2 !== undefined ? body.uri2 : existing.uri2 || '').trim()

    if (newUri1 && newUri2 && newUri1 === newUri2) {
      return NextResponse.json({ error: 'URI 1 and URI 2 must be different' }, { status: 400 })
    }

    body.uri1 = newUri1
    body.uri2 = newUri2

    // After saving, cascade updated URIs to all member tenants
    const cluster = await Cluster.findByIdAndUpdate(id, { $set: body }, { new: true, strict: false })
    if (!cluster) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Rebuild mongoUri and mongoUriFallback for all members
    const members = await Tenant.find({ clusterId: cluster._id }).select('_id subdomain').lean()
    if (members.length > 0) {
      await Promise.all(members.map(async (m: any) => {
        const updates: any = {}
        if (newUri1) updates.mongoUri        = buildUri(newUri1, m.subdomain)
        if (newUri2) updates.mongoUriFallback = buildUri(newUri2, m.subdomain)
        else         updates.mongoUriFallback = ''
        await Tenant.findByIdAndUpdate(m._id, { $set: updates }, { strict: false })
      }))
    }

    return NextResponse.json({ cluster })
  }

  // Non-URI update (e.g. isActive, maxTenants)
  const cluster = await Cluster.findByIdAndUpdate(id, { $set: body }, { new: true, strict: false })
  if (!cluster) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ cluster })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await verifyAdminSession(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { Cluster } = await getAdminModels()
  await Cluster.findByIdAndDelete(id)
  return NextResponse.json({ ok: true })
}
