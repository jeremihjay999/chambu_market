import { NextRequest, NextResponse } from 'next/server'
import { getAdminModels } from '@/lib/admin-models'
import { verifyAdminSession } from '../../../../auth/route'

// DELETE /api/admin/clusters/[id]/members/[tenantId]
// Removes a tenant from the cluster (unlinks clusterId, decrements tenantCount).
// The tenant record is NOT deleted.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tenantId: string }> }
) {
  if (!await verifyAdminSession(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, tenantId } = await params

  const { Cluster, Tenant } = await getAdminModels()

  const cluster = await Cluster.findById(id)
  if (!cluster) return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })

  const tenant = await Tenant.findById(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  // Unlink
  tenant.clusterId = null
  await tenant.save()

  // Decrement count (floor at 0)
  cluster.tenantCount = Math.max(0, cluster.tenantCount - 1)
  await cluster.save()

  return NextResponse.json({ ok: true })
}
