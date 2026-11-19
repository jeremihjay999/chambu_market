import { NextRequest, NextResponse } from 'next/server'
import { getAdminModels } from '@/lib/admin-models'
import { verifyAdminSession } from '../../../auth/route'

// POST /api/admin/clusters/[id]/members
// Body: { tenantId } — links an existing tenant to this cluster.
// Rebuilds the tenant's mongoUri from the cluster's baseUri so the
// database name stays as the tenant's subdomain.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await verifyAdminSession(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { tenantId } = await request.json()
  if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })

  const { Cluster, Tenant } = await getAdminModels()

  const cluster = await Cluster.findById(id)
  if (!cluster) return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })
  if (!cluster.isActive) return NextResponse.json({ error: 'Cluster is inactive' }, { status: 400 })
  if (cluster.tenantCount >= cluster.maxTenants) {
    return NextResponse.json({ error: `Cluster is full (${cluster.tenantCount}/${cluster.maxTenants})` }, { status: 400 })
  }

  const tenant = await Tenant.findById(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  if (tenant.clusterId?.toString() === id) {
    return NextResponse.json({ error: 'Tenant is already a member of this cluster' }, { status: 409 })
  }

  // If tenant was previously in another cluster, decrement that cluster's count
  if (tenant.clusterId) {
    await Cluster.findByIdAndUpdate(tenant.clusterId, { $inc: { tenantCount: -1 } })
  }

  // Rebuild both URIs from the new cluster's uri1/uri2 + tenant subdomain as db name
  function buildUri(base: string): string {
    if (!base) return ''
    const [hostPart, ...queryParts] = base.trim().replace(/\/$/, '').split('?')
    return queryParts.length > 0
      ? `${hostPart}/${tenant.subdomain}?${queryParts.join('?')}`
      : `${hostPart}/${tenant.subdomain}`
  }

  const newUri         = buildUri(cluster.uri1)
  const newUriFallback = cluster.uri2 ? buildUri(cluster.uri2) : ''

  if (!newUri) return NextResponse.json({ error: 'Cluster has no URI configured' }, { status: 400 })

  tenant.clusterId        = cluster._id
  tenant.mongoUri         = newUri
  tenant.mongoUriFallback = newUriFallback
  await tenant.save()

  cluster.tenantCount += 1
  await cluster.save()

  return NextResponse.json({ ok: true, tenant })
}
