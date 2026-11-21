import { NextRequest, NextResponse } from 'next/server'
import { getAdminModels } from '@/lib/admin-models'
import { connectTenantDB } from '@/lib/db-tenant'
import { getModels } from '@/lib/tenant/get-models'
import { verifyAdminSession } from '../../../auth/route'
import { checkEmailExistsAcrossTenants } from '@/lib/auth/check-email-exists'

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
  if (pathStart < 0) return uri

  const authority = hostPart.slice(0, pathStart)
  const rawPath = hostPart.slice(pathStart).replace(/^\/+/, '')
  if (!rawPath) return uri

  const dbName = rawPath.split('/').filter(Boolean).pop() || rawPath
  return `${authority}/${dbName}${queryPart}`
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await verifyAdminSession(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { email, password, shopName } = await request.json()
  const { id } = await params

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  try {
    const { Tenant } = await getAdminModels()
    const tenant = await Tenant.findById(id).lean() as { mongoUri: string; shopName?: string } | null
    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

    console.log('[update-owner] Connecting to tenant DB:', tenant.mongoUri)
    const safeUri = repairMongoUri(tenant.mongoUri)
    if (safeUri !== tenant.mongoUri) {
      console.warn('[update-owner] Repaired malformed mongoUri:', tenant.mongoUri, '->', safeUri)
      await Tenant.findByIdAndUpdate(id, { $set: { mongoUri: safeUri } })
    }
    const conn = await connectTenantDB(safeUri)
    const { User } = getModels(conn)

    // Find existing owner
    let owner = await User.findOne({ role: 'admin' })
    console.log('[update-owner] Existing owner:', owner ? owner.email : 'none')

    if (owner) {
      // Update existing owner
      if (email && email !== owner.email) {
        // Check if email already exists in this tenant
        const existingInTenant = await User.findOne({ email, _id: { $ne: owner._id } })
        if (existingInTenant) return NextResponse.json({ error: 'Email already in use in this tenant' }, { status: 409 })
        
        // Check if email already exists across all tenants
        const existingAccount = await checkEmailExistsAcrossTenants(email)
        if (existingAccount) {
          return NextResponse.json({ 
            error: 'An account with this email already exists in another tenant. Please use a different email.' 
          }, { status: 409 })
        }
        
        owner.email = email
      }
      if (password) owner.password = password
      await owner.save()
      console.log('[update-owner] Updated existing owner')
    } else {
      // No owner yet — create one
      if (!password) return NextResponse.json({ error: 'Password is required to create owner account' }, { status: 400 })
      
      // Check if email already exists across all tenants
      const existingAccount = await checkEmailExistsAcrossTenants(email)
      if (existingAccount) {
        return NextResponse.json({ 
          error: 'An account with this email already exists in another tenant. Please use a different email.' 
        }, { status: 409 })
      }
      
      owner = new User({
        email,
        password,
        shopName: shopName || (tenant as any).shopName || 'My Shop',
        role: 'admin',
      })
      await owner.save()
      console.log('[update-owner] Created new owner')
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('[update-owner POST] Full error:', error?.message, error)
    return NextResponse.json({ error: error?.message || 'Failed to update owner' }, { status: 500 })
  }
}
