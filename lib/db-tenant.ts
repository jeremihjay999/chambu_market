import mongoose from 'mongoose'
import dns from 'dns'

dns.setDefaultResultOrder('ipv4first')

declare global {
  // eslint-disable-next-line no-var
  var _tenantConnections: Map<string, mongoose.Connection> | undefined
  // eslint-disable-next-line no-var
  var _tenantConnectionPromises: Map<string, Promise<mongoose.Connection>> | undefined
  // eslint-disable-next-line no-var
  var _tenantConnectionStats: Map<string, { hits: number; misses: number; lastUsed: number }> | undefined
}

function getPool(): Map<string, mongoose.Connection> {
  if (!global._tenantConnections) global._tenantConnections = new Map()
  return global._tenantConnections
}

function getPromisePool(): Map<string, Promise<mongoose.Connection>> {
  if (!global._tenantConnectionPromises) global._tenantConnectionPromises = new Map()
  return global._tenantConnectionPromises
}

function getStats(): Map<string, { hits: number; misses: number; lastUsed: number }> {
  if (!global._tenantConnectionStats) global._tenantConnectionStats = new Map()
  return global._tenantConnectionStats
}

// Max tenant connections cached per instance — prevents runaway connection growth
const MAX_CACHED_TENANTS = 10

/**
 * Repairs malformed MongoDB URIs that have a double slash before the database name.
 * e.g. mongodb://host:27017//dbname  →  mongodb://host:27017/dbname
 *      mongodb+srv://host//dbname    →  mongodb+srv://host/dbname
 * Also strips extra path segments if the base URI already contained a database path.
 */
function repairMongoUri(uri: string): string {
  if (!uri) return uri
  const qIdx = uri.indexOf('?')
  const hostPart = qIdx >= 0 ? uri.slice(0, qIdx) : uri
  const queryPart = qIdx >= 0 ? uri.slice(qIdx) : ''

  // Find where the authority ends (first '/' after the scheme's '//')
  const schemeEnd = hostPart.indexOf('//') + 2
  const pathStart = hostPart.indexOf('/', schemeEnd)
  if (pathStart < 0) return uri  // no path — nothing to repair

  const authority = hostPart.slice(0, pathStart)
  // Strip all leading slashes from the path and collapse multiple segments
  const rawPath = hostPart.slice(pathStart).replace(/^\/+/, '')
  if (!rawPath) return uri  // path was just slashes — nothing to repair

  // If there are multiple path segments, only the last is the db name
  const dbName = rawPath.split('/').filter(Boolean).pop() || rawPath
  const repaired = `${authority}/${dbName}${queryPart}`
  return repaired
}

export async function connectTenantDB(uri: string): Promise<mongoose.Connection> {
  // Repair double-slash URIs (e.g. mongodb://host//dbname → mongodb://host/dbname)
  // that may have been produced by legacy buildUri logic before the fix.
  const safeUri = repairMongoUri(uri)
  if (safeUri !== uri) {
    console.warn('[db-tenant] Repaired malformed URI:', uri.substring(0, 80), '->', safeUri.substring(0, 80))
  }
  uri = safeUri

  const startTime = Date.now()
  const pool = getPool()
  const promisePool = getPromisePool()
  const stats = getStats()

  // Check for existing completed connection
  const existing = pool.get(uri)
  if (existing?.readyState === 1) {
    // Cache hit
    const stat = stats.get(uri) || { hits: 0, misses: 0, lastUsed: 0 }
    stat.hits++
    stat.lastUsed = Date.now()
    stats.set(uri, stat)
    
    const duration = Date.now() - startTime
    console.log(`[db-tenant] ✓ Cache HIT for ${uri.substring(0, 50)}... (${duration}ms)`)
    return existing
  }

  // Check for in-flight connection promise (prevents race condition)
  const inFlightPromise = promisePool.get(uri)
  if (inFlightPromise) {
    console.log(`[db-tenant] ⏳ Waiting for in-flight connection to ${uri.substring(0, 50)}...`)
    const conn = await inFlightPromise
    const duration = Date.now() - startTime
    console.log(`[db-tenant] ✓ In-flight connection ready (${duration}ms)`)
    
    const stat = stats.get(uri) || { hits: 0, misses: 0, lastUsed: 0 }
    stat.hits++
    stat.lastUsed = Date.now()
    stats.set(uri, stat)
    
    return conn
  }

  // Cache miss - need to establish new connection
  const stat = stats.get(uri) || { hits: 0, misses: 0, lastUsed: 0 }
  stat.misses++
  stat.lastUsed = Date.now()
  stats.set(uri, stat)

  // Remove stale entry
  if (existing) {
    console.log(`[db-tenant] Removing stale connection for ${uri.substring(0, 50)}...`)
    pool.delete(uri)
    promisePool.delete(uri)
  }

  // Evict oldest entry if pool is full to avoid connection leak
  if (pool.size >= MAX_CACHED_TENANTS) {
    const oldestUri = pool.keys().next().value
    if (oldestUri) {
      console.log(`[db-tenant] ⚠️  Pool full (${pool.size}/${MAX_CACHED_TENANTS}), evicting: ${oldestUri.substring(0, 50)}...`)
      try { 
        await pool.get(oldestUri)?.close() 
      } catch (err) {
        console.error(`[db-tenant] Error closing evicted connection:`, err)
      }
      pool.delete(oldestUri)
      promisePool.delete(oldestUri)
      stats.delete(oldestUri)
    }
  }

  console.log(`[db-tenant] ✗ Cache MISS, establishing new connection to ${uri.substring(0, 50)}...`)
  const connStartTime = Date.now()
  
  // Create connection promise and cache it immediately to prevent race conditions
  const connectionPromise = mongoose.createConnection(uri, {
    family: 4,
    serverSelectionTimeoutMS: 3000,  // Fail fast — 3s is enough to detect offline
    socketTimeoutMS: 10000,
    connectTimeoutMS: 3000,
    maxPoolSize: 2,
    minPoolSize: 1,
  }).asPromise()

  // Cache the promise immediately so concurrent requests can reuse it
  promisePool.set(uri, connectionPromise)

  try {
    const conn = await connectionPromise

    const connDuration = Date.now() - connStartTime
    const totalDuration = Date.now() - startTime
    console.log(`[db-tenant] ✓ Connection established in ${connDuration}ms (total: ${totalDuration}ms)`)

    // Cache the completed connection
    pool.set(uri, conn)
    
    return conn
  } catch (error) {
    // Remove failed promise from cache
    promisePool.delete(uri)
    console.error(`[db-tenant] ✗ Connection failed for ${uri.substring(0, 50)}:`, error)
    throw error
  }
}

export function getTenantConnectionStats() {
  const stats = getStats()
  const pool = getPool()
  
  return {
    maxCachedTenants: MAX_CACHED_TENANTS,
    currentCached: pool.size,
    connections: Array.from(stats.entries()).map(([uri, stat]) => ({
      uri: uri.substring(0, 60) + '...',
      hits: stat.hits,
      misses: stat.misses,
      lastUsed: new Date(stat.lastUsed).toISOString(),
      hitRate: stat.hits + stat.misses > 0 ? (stat.hits / (stat.hits + stat.misses) * 100).toFixed(1) + '%' : 'N/A'
    }))
  }
}
