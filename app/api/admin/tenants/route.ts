import { NextRequest, NextResponse } from 'next/server'
import { getAdminModels } from '@/lib/admin-models'
import { verifyAdminSession } from '../auth/route'
import { normaliseFeatures, DEFAULT_MODULE_FEATURES } from '@/lib/modules'

export async function GET(request: NextRequest) {
  if (!await verifyAdminSession(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { Tenant } = await getAdminModels()
    const tenants = await Tenant.find().sort({ createdAt: -1 }).lean()
    return NextResponse.json({ tenants })
  } catch (err) {
    console.error('[admin/tenants GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  if (!await verifyAdminSession(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  
  const { subdomain: rawSubdomain, clusterId, shopName, features } = await request.json()

  // Accept explicit subdomain or derive from shop name
  const subdomain = (rawSubdomain || shopName || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30)

  if (!subdomain || !clusterId) return NextResponse.json({ error: 'shopName and clusterId are required' }, { status: 400 })

  const { Tenant, Cluster } = await getAdminModels()

  const existing = await Tenant.findOne({ subdomain })
  if (existing) return NextResponse.json({ error: 'Subdomain already taken' }, { status: 409 })

  const cluster = await Cluster.findById(clusterId)
  if (!cluster) return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })
  if (!cluster.isActive) return NextResponse.json({ error: 'Cluster is inactive' }, { status: 400 })
  if (cluster.tenantCount >= cluster.maxTenants) {
    return NextResponse.json({ error: `Cluster is full (${cluster.tenantCount}/${cluster.maxTenants})` }, { status: 400 })
  }

  // Inserts the db name (subdomain) into a base URI before any query string.
  // Handles SRV URIs (mongodb+srv://host) and standard URIs (mongodb://host:port).
  // Strips any existing database path so the subdomain becomes the database name.
  function buildUri(base: string): string {
    if (!base) return ''
    const trimmed = base.trim()

    // Split off the query string first
    const qIdx = trimmed.indexOf('?')
    const hostPart = qIdx >= 0 ? trimmed.slice(0, qIdx) : trimmed
    const queryPart = qIdx >= 0 ? trimmed.slice(qIdx) : ''   // includes the '?'

    // For SRV URIs: mongodb+srv://user:pass@host[/optionalDb]
    // For standard: mongodb://user:pass@host:port[/optionalDb]
    // We want to keep everything up to (and including) the authority (host[:port]),
    // drop any existing path segment, then append /subdomain.
    //
    // Strategy: find the authority end by locating the third '/' (after the scheme's '//').
    const schemeEnd = hostPart.indexOf('//') + 2          // skip 'mongodb://' or 'mongodb+srv://'
    const pathStart = hostPart.indexOf('/', schemeEnd)    // first '/' after the authority

    // Keep only the authority portion (no trailing slash, no existing db name)
    const authority = pathStart >= 0 ? hostPart.slice(0, pathStart) : hostPart

    return `${authority}/${subdomain}${queryPart}`
  }

  // Normalise legacy field names (older clusters may have been saved as baseUriSrv / baseUri)
  const clusterUri1 = cluster.uri1 || (cluster as any).baseUriSrv || (cluster as any).baseUri || ''
  const clusterUri2 = cluster.uri2 || ((cluster as any).baseUriSrv && (cluster as any).baseUri ? (cluster as any).baseUri : '') || ''

  // If the cluster was using legacy field names, migrate them in-place so this never repeats
  if (!cluster.uri1 && clusterUri1) {
    cluster.uri1 = clusterUri1
    if (clusterUri2) cluster.uri2 = clusterUri2
  }

  // mongoUri from uri1, mongoUriFallback from uri2 (if present and different)
  const mongoUri         = buildUri(clusterUri1)
  const mongoUriFallback = clusterUri2 ? buildUri(clusterUri2) : ''

  if (!mongoUri) return NextResponse.json({ error: 'Cluster has no URI configured' }, { status: 400 })

  const normalisedFeatures = normaliseFeatures(features || DEFAULT_MODULE_FEATURES)
  const tenant = new Tenant({ subdomain, mongoUri, mongoUriFallback, shopName, features: normalisedFeatures, isActive: true, clusterId })
  await tenant.save()

  // Increment cluster tenant count
  cluster.tenantCount += 1
  await cluster.save()

  return NextResponse.json({ tenant }, { status: 201 })
}
