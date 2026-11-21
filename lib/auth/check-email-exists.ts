import { getAdminModels } from '@/lib/admin-models'
import { connectTenantDB } from '@/lib/db-tenant'
import { getModels } from '@/lib/tenant/get-models'

/**
 * Repairs double-slash URIs that may have been persisted from legacy buildUri logic.
 * mongodb://host//dbname → mongodb://host/dbname
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

/**
 * Check if an email exists across all active tenants
 * Returns the tenant ID and user type if found, null otherwise
 */
export async function checkEmailExistsAcrossTenants(
  email: string
): Promise<{ tenantId: string; userType: 'user' | 'staff' } | null> {
  const { Tenant } = await getAdminModels()
  const tenants = await Tenant.find({ isActive: true }).lean() as unknown as Array<{
    _id: any
    mongoUri: string
    features: Record<string, boolean>
    shopName: string
  }>

  for (const tenant of tenants) {
    try {
      // Repair any double-slash URIs persisted from legacy buildUri and patch DB in-place
      const safeUri = repairMongoUri(tenant.mongoUri)
      if (safeUri !== tenant.mongoUri) {
        console.warn('[checkEmailExistsAcrossTenants] Repairing URI for tenant', tenant._id.toString())
        Tenant.findByIdAndUpdate(tenant._id, { $set: { mongoUri: safeUri } }).exec().catch(() => {})
        tenant.mongoUri = safeUri
      }

      const conn = await connectTenantDB(tenant.mongoUri)
      const models = getModels(conn)

      // Check for owner
      const user = await models.User.findOne({ email })
      if (user) {
        return { tenantId: tenant._id.toString(), userType: 'user' }
      }

      // Check for staff
      const staff = await models.Staff.findOne({ email, active: true })
      if (staff) {
        return { tenantId: tenant._id.toString(), userType: 'staff' }
      }
    } catch (err) {
      console.error('[checkEmailExistsAcrossTenants] Error checking tenant:', tenant.mongoUri, err)
      continue
    }
  }

  return null
}

/**
 * Check if an email exists in a specific tenant
 */
export async function checkEmailExistsInTenant(
  email: string,
  mongoUri: string
): Promise<{ userType: 'user' | 'staff' } | null> {
  try {
    const conn = await connectTenantDB(mongoUri)
    const models = getModels(conn)

    // Check for owner
    const user = await models.User.findOne({ email })
    if (user) {
      return { userType: 'user' }
    }

    // Check for staff
    const staff = await models.Staff.findOne({ email, active: true })
    if (staff) {
      return { userType: 'staff' }
    }

    return null
  } catch (err) {
    console.error('[checkEmailExistsInTenant] Error:', err)
    return null
  }
}
