import { NextRequest, NextResponse } from 'next/server'
import { getAdminModels } from '@/lib/admin-models'
import { verifyAdminSession } from '../../auth/route'

// Temporary debug endpoint — remove after diagnosis
export async function GET(request: NextRequest) {
  if (!await verifyAdminSession(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { Tenant, Cluster } = await getAdminModels()
  const tenants = await Tenant.find({}).select('subdomain mongoUri clusterId').lean()
  const clusters = await Cluster.find({}).select('name baseUri baseUriSrv tenantCount').lean()
  return NextResponse.json({ tenants, clusters })
}
