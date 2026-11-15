/**
 * Identifies users by ObjectId in the source (test) database.
 * Run with: npx tsx scripts/identify-users.ts --subdomain=allstarbikeshop
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

const USER_IDS = [
  '69c260c2ea86b7ba8c31a3be',
  '69c19cc1c82f0c7ec15a8153',
]

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

  if (!tenant) {
    console.error(`❌ Tenant "${SUBDOMAIN}" not found`)
    process.exit(1)
  }

  const sourceUri = tenant.mongoUri.replace(`/${SUBDOMAIN}?`, `/${SOURCE_DB}?`)
  await adminConn.close()

  const conn = await mongoose.createConnection(sourceUri, {
    family: 4, serverSelectionTimeoutMS: 10000,
  }).asPromise()

  console.log('\n── Checking users collection ──────────────────────────')
  for (const id of USER_IDS) {
    const user = await conn.collection('users').findOne({
      _id: new mongoose.Types.ObjectId(id),
    }) as any
    if (user) {
      console.log(`\n  Found in users:`)
      console.log(`    _id      : ${user._id}`)
      console.log(`    email    : ${user.email}`)
      console.log(`    shopName : ${user.shopName}`)
      console.log(`    role     : ${user.role}`)
      console.log(`    created  : ${user.createdAt}`)
    }
  }

  console.log('\n── Checking staff collection ──────────────────────────')
  for (const id of USER_IDS) {
    const staff = await conn.collection('staff').findOne({
      _id: new mongoose.Types.ObjectId(id),
    }) as any
    if (staff) {
      console.log(`\n  Found in staff:`)
      console.log(`    _id      : ${staff._id}`)
      console.log(`    name     : ${staff.name}`)
      console.log(`    email    : ${staff.email}`)
      console.log(`    role     : ${staff.role}`)
      console.log(`    active   : ${staff.active}`)
    }
  }

  console.log('\n── Product count per userId ────────────────────────────')
  for (const id of USER_IDS) {
    const count = await conn.collection('products').countDocuments({
      userId: new mongoose.Types.ObjectId(id),
    })
    console.log(`  userId ${id} → ${count} products`)
  }

  await conn.close()
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
