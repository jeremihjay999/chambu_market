/**
 * Lists all users in the source database and shows how many records
 * each one owns across every collection.
 *
 * Run with: npx tsx scripts/discover-source-users.ts --subdomain=allstarbikeshop
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
const SOURCE_DB = getArg('source') || 'test'

async function main() {
  if (!SUBDOMAIN) {
    console.error('❌ --subdomain is required. Example: --subdomain=allstarbikeshop')
    process.exit(1)
  }

  const adminConn = await mongoose.createConnection(process.env.MONGODB_URI!, {
    family: 4, serverSelectionTimeoutMS: 10000,
  }).asPromise()

  const tenant = await adminConn.collection('tenants').findOne({
    subdomain: SUBDOMAIN.toLowerCase(),
  }) as any

  if (!tenant) {
    console.error(`❌ Tenant "${SUBDOMAIN}" not found`)
    process.exit(1)
  }

  const sourceUri = tenant.mongoUri.replace(`/${SUBDOMAIN}?`, `/${SOURCE_DB}?`)
  await adminConn.close()

  const conn = await mongoose.createConnection(sourceUri, {
    family: 4, serverSelectionTimeoutMS: 10000,
  }).asPromise()

  // ── List all users ─────────────────────────────────────────────────────────

  const users = await conn.collection('users').find({}).toArray() as any[]
  const staff = await conn.collection('staff').find({}).toArray() as any[]

  console.log('\n========================================')
  console.log('  Source Database User Audit')
  console.log(`  Database: ${SOURCE_DB}`)
  console.log('========================================')

  console.log(`\n── Users (owners) ─────────────────────── ${users.length} found`)
  for (const u of users) {
    console.log(`\n  _id      : ${u._id}`)
    console.log(`  email    : ${u.email}`)
    console.log(`  shopName : ${u.shopName}`)
    console.log(`  role     : ${u.role}`)
    console.log(`  created  : ${u.createdAt}`)
  }

  console.log(`\n── Staff (employees) ──────────────────── ${staff.length} found`)
  for (const s of staff) {
    console.log(`\n  _id      : ${s._id}`)
    console.log(`  name     : ${s.name}`)
    console.log(`  email    : ${s.email}`)
    console.log(`  role     : ${s.role}`)
    console.log(`  userId   : ${s.userId}  ← owner this staff belongs to`)
    console.log(`  active   : ${s.active}`)
  }

  // ── Count records per userId across all collections ────────────────────────

  const collections = [
    'products',
    'sales',
    'customers',
    'customer_transactions',
    'expenses',
    'categories',
    'rentals',
    'inventory_movements',
  ]

  // Gather all unique userIds appearing across collections
  const allUserIds = new Set<string>()
  for (const u of users) allUserIds.add(u._id.toString())
  for (const s of staff) allUserIds.add(s.userId?.toString())

  // Also scan collections for any userId not in users/staff
  for (const colName of collections) {
    const distinct = await conn.collection(colName).distinct('userId')
    for (const id of distinct) {
      if (id) allUserIds.add(id.toString())
    }
  }

  console.log('\n── Records per userId across collections ──────────────────────────────────')
  console.log(`\n  ${'userId'.padEnd(28)} ${'products'.padEnd(10)} ${'sales'.padEnd(8)} ${'customers'.padEnd(10)} ${'expenses'.padEnd(10)} ${'categories'.padEnd(12)} ${'rentals'.padEnd(8)}`)
  console.log(`  ${'─'.repeat(100)}`)

  for (const userId of allUserIds) {
    if (!userId || userId === 'undefined') continue
    const objId = new mongoose.Types.ObjectId(userId)

    const counts = await Promise.all(
      collections.map(col => conn.collection(col).countDocuments({ userId: objId }))
    )

    const [products, sales, customers, customerTx, expenses, categories, rentals, invMovements] = counts

    // Label the userId if we know who it is
    const matchedUser  = users.find(u => u._id.toString() === userId)
    const matchedStaff = staff.find(s => s._id.toString() === userId)
    const label = matchedUser
      ? `(owner: ${matchedUser.email})`
      : matchedStaff
      ? `(staff: ${matchedStaff.name})`
      : '(unknown)'

    console.log(`\n  ${userId}  ${label}`)
    console.log(`    products          : ${products}`)
    console.log(`    sales             : ${sales}`)
    console.log(`    customers         : ${customers}`)
    console.log(`    customer_tx       : ${customerTx}`)
    console.log(`    expenses          : ${expenses}`)
    console.log(`    categories        : ${categories}`)
    console.log(`    rentals           : ${rentals}`)
    console.log(`    inventory_movements: ${invMovements}`)
  }

  console.log('\n========================================\n')

  await conn.close()
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
