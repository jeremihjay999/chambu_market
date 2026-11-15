/**
 * Sets lowStockThreshold: 10 on all products that don't have it.
 * Run after migration to fix products copied from chambu-pos.
 *
 * Run with: npx tsx scripts/fix-low-stock-threshold.ts --subdomain=allstarbikeshop
 * Dry run:  npx tsx scripts/fix-low-stock-threshold.ts --subdomain=allstarbikeshop --dry-run
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

const SUBDOMAIN = getArg('subdomain')
const DRY_RUN   = process.argv.includes('--dry-run')
const THRESHOLD = parseInt(getArg('threshold') || '10')

async function main() {
  if (!SUBDOMAIN) {
    console.error('❌ --subdomain is required')
    process.exit(1)
  }

  const adminConn = await mongoose.createConnection(process.env.MONGODB_URI!, {
    family: 4, serverSelectionTimeoutMS: 10000,
  }).asPromise()

  const tenant = await adminConn.collection('tenants').findOne({
    subdomain: SUBDOMAIN.toLowerCase(),
  }) as any
  await adminConn.close()

  if (!tenant) {
    console.error(`❌ Tenant "${SUBDOMAIN}" not found`)
    process.exit(1)
  }

  const conn = await mongoose.createConnection(tenant.mongoUri, {
    family: 4, serverSelectionTimeoutMS: 10000,
  }).asPromise()

  const owner = await conn.collection('users').findOne({ role: 'admin' }) as any

  // Count products missing the field
  const missing = await conn.collection('products').countDocuments({
    userId:            owner._id,
    lowStockThreshold: { $exists: false },
  })

  console.log(`\nProducts missing lowStockThreshold : ${missing}`)
  console.log(`Will set to                        : ${THRESHOLD}`)

  if (missing === 0) {
    console.log('\n✓ Nothing to do — all products already have a threshold set')
    await conn.close()
    return
  }

  if (!DRY_RUN) {
    const result = await conn.collection('products').updateMany(
      { userId: owner._id, lowStockThreshold: { $exists: false } },
      { $set: { lowStockThreshold: THRESHOLD } }
    )
    console.log(`\n✓ Updated ${result.modifiedCount} products → lowStockThreshold: ${THRESHOLD}`)
  } else {
    console.log(`\n[DRY RUN] Would update ${missing} products → lowStockThreshold: ${THRESHOLD}`)
  }

  await conn.close()
  console.log('\n✅ Done. Restocking page should now show low stock items.\n')
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
