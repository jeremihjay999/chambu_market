import { NextRequest, NextResponse } from 'next/server'
import { connectTenantDB } from '@/lib/db-tenant'
import { getModels } from '@/lib/tenant/get-models'
import { getAdminModels } from '@/lib/admin-models'
import { verifyAdminSession } from '../../../auth/route'
import { checkEmailExistsAcrossTenants } from '@/lib/auth/check-email-exists'
import { upsertEmailIndex } from '@/lib/email-index'

/**
 * Ensures the URI has exactly one database name segment after the authority.
 * Fixes double-slash URIs like mongodb+srv://host//dbname → mongodb+srv://host/dbname
 */
function repairMongoUri(uri: string): string {
  if (!uri) return uri
  const qIdx = uri.indexOf('?')
  const hostPart = qIdx >= 0 ? uri.slice(0, qIdx) : uri
  const queryPart = qIdx >= 0 ? uri.slice(qIdx) : ''

  const schemeEnd = hostPart.indexOf('//') + 2
  const pathStart = hostPart.indexOf('/', schemeEnd)
  if (pathStart < 0) return uri  // no path at all — nothing to repair

  const authority = hostPart.slice(0, pathStart)
  // Collect the path and collapse any double slashes, strip leading slash
  const rawPath = hostPart.slice(pathStart).replace(/^\/+/, '')
  // If path is empty after stripping, nothing to fix
  if (!rawPath) return uri

  // Keep only the last segment (the actual db name), drop any extra path components
  const dbName = rawPath.split('/').filter(Boolean).pop() || rawPath
  return `${authority}/${dbName}${queryPart}`
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await verifyAdminSession(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { email, password, shopName } = await request.json()
    if (!email || !password) {
      return NextResponse.json({ error: 'email and password are required' }, { status: 400 })
    }

    const { id } = await params

    const { Tenant } = await getAdminModels()
    const tenant = await Tenant.findById(id).lean() as { mongoUri: string; shopName?: string } | null
    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

    // Check if email already exists across all tenants
    const existingAccount = await checkEmailExistsAcrossTenants(email)
    if (existingAccount) {
      return NextResponse.json({ 
        error: 'An account with this email already exists in another tenant. Please use a different email.' 
      }, { status: 409 })
    }

    console.log('[provision] Connecting to tenant DB:', tenant.mongoUri)
    const safeUri = repairMongoUri(tenant.mongoUri)
    if (safeUri !== tenant.mongoUri) {
      console.warn('[provision] Repaired malformed mongoUri:', tenant.mongoUri, '->', safeUri)
      await Tenant.findByIdAndUpdate(id, { $set: { mongoUri: safeUri } })
    }
    const conn = await connectTenantDB(safeUri)
    const { User } = getModels(conn)

    const user = new User({
      email,
      password,
      shopName: shopName || (tenant as any).shopName || 'My Shop',
      role: 'admin',
    })
    await user.save()

    // Update email index for fast login
    await upsertEmailIndex({
      email,
      tenantId: id,
      userType: 'user',
      userId: user._id.toString(),
      isActive: true
    })

    return NextResponse.json({ ok: true, userId: user._id })
  } catch (error: any) {
    console.error('[provision POST]', error?.message, error)
    return NextResponse.json({ error: error?.message || 'Failed to provision tenant' }, { status: 500 })
  }
}
