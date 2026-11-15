/**
 * Discovers what collections and document counts exist in the source database.
 * Derives the source URI from the tenant record in the admin DB.
 *
 * Usage: npx tsx scripts/discover-source-db.ts --subdomain=allstarbikeshop --source=test
 */
import mongoose from 'mongoose'
import * as dotenv from 'dotenv'
import dns from 'dns'
dns.setDefaultResultOrder('ipv4first')
dotenv.config()

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`
  const arg = process.argv.find(a => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : undefined
}

const SUBDOMAIN   = getArg('subdomain')
const SOURCE_NAME = getArg('source') || 'test'

async function main() {
  if (!SUBDOMAIN) {
    console.error('❌ --subdomain is required. Example: --subdomain=allstarbikeshop')
    process.exit(1)
  }

  const ADMIN_URI = process.env.MONGODB_URI
  if (!ADMIN_URI) {
    console.error('❌ MONGODB_URI not set in .env')
    process.exit(1)
  }

  // Connect to admin DB and find the tenant
  console.log('Connecting to admin DB...')
  const adminConn = await mongoose.createConnection(ADMIN_URI, {
    family: 4,
    serverSelectionTimeoutMS: 10000,
  }).asPromise()

  const tenant = await adminConn.collection('tenants').findOne({
    subdomain: SUBDOMAIN.toLowerCase(),
  }) as any

  if (!tenant) {
    console.error(`❌ Tenant "${SUBDOMAIN}" not found in admin DB`)
    process.exit(1)
  }

  console.log(`✓ Tenant found: ${tenant.shopName}`)
  console.log(`  Destination URI: ${tenant.mongoUri.substring(0, 60)}...`)

  // Derive source URI — replace the database name in the destination URI
  // e.g. .../allstarbikeshop?appName=... → .../test?appName=...
  const sourceUri = tenant.mongoUri.replace(`/${SUBDOMAIN}?`, `/${SOURCE_NAME}?`)
  console.log(`  Source URI:      ${sourceUri.substring(0, 60)}...`)

  await adminConn.close()

  // Connect to source DB
  console.log(`\nConnecting to source DB (${SOURCE_NAME})...`)
  const sourceConn = await mongoose.createConnection(sourceUri, {
    family: 4,
    serverSelectionTimeoutMS: 10000,
  }).asPromise()

  console.log('Connected. Listing collections:\n')

  const collections = await sourceConn.db.listCollections().toArray()

  for (const col of collections) {
    const count = await sourceConn.db.collection(col.name).countDocuments()
    console.log(`  ${col.name.padEnd(30)} ${count} documents`)
  }

  await sourceConn.close()
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
