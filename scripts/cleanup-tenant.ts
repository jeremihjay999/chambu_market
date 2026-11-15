/**
 * Cleans a tenant database by dropping all collections except users.
 * Use this before re-running the migration script on a tenant that
 * already has wrong or partial data.
 *
 * What it drops:
 *   branches, categories, suppliers, products, product_inventory,
 *   sales, expenses, staff, customers, rentals
 *
 * What it keeps:
 *   users — the provisioned owner account must stay
 *   user_email_index entries for staff are also cleaned from admin DB
 *   (owner email index entry is kept)
 *
 * Usage:
 *   npx tsx scripts/cleanup-tenant.ts --subdomain=allstarbikeshop
 *   npx tsx scripts/cleanup-tenant.ts --subdomain=allstarbikeshop --dry-run
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

const COLLECTIONS_TO_DROP = [
  'branches',
  'categories',
  'suppliers',
  'products',
  'product_inventory',
  'sales',
  'expenses',
  'staff',
  'customers',
  'rentals',
]

async function main() {
  console.log('\n========================================')
  console.log('  Tenant Cleanup')
  if (DRY_RUN) console.log('  MODE: DRY RUN — no changes will be made')
  console.log('========================================\n')

  if (!SUBDOMAIN) {
    console.error('❌ --subdomain is required. Example: --subdomain=allstarbikeshop')
    process.exit(1)
  }

  const ADMIN_URI = process.env.MONGODB_URI
  if (!ADMIN_URI) {
    console.error('❌ MONGODB_URI not set in .env')
    process.exit(1)
  }

  // ── Connect to admin DB ────────────────────────────────────────────────────

  const adminConn = await mongoose.createConnection(ADMIN_URI, {
    family: 4, serverSelectionTimeoutMS: 10000,
  }).asPromise()

  const tenant = await adminConn.collection('tenants').findOne({
    subdomain: SUBDOMAIN.toLowerCase(),
  }) as any

  if (!tenant) {
    console.error(`❌ Tenant "${SUBDOMAIN}" not found in admin DB`)
    process.exit(1)
  }

  console.log(`  Tenant   : ${tenant.shopName}`)
  console.log(`  Database : .../${SUBDOMAIN}\n`)

  // ── Connect to tenant DB ───────────────────────────────────────────────────

  const tenantConn = await mongoose.createConnection(tenant.mongoUri, {
    family: 4, serverSelectionTimeoutMS: 10000,
  }).asPromise()

  // ── Drop collections ───────────────────────────────────────────────────────

  console.log('Dropping collections:')

  for (const name of COLLECTIONS_TO_DROP) {
    const exists = await tenantConn.db
      .listCollections({ name })
      .toArray()

    if (exists.length === 0) {
      console.log(`  ⏭  ${name.padEnd(20)} (does not exist)`)
      continue
    }

    const count = await tenantConn.collection(name).countDocuments()

    if (!DRY_RUN) {
      await tenantConn.collection(name).drop()
      console.log(`  ✓ ${name.padEnd(20)} dropped (${count} documents removed)`)
    } else {
      console.log(`  [DRY RUN] Would drop ${name} (${count} documents)`)
    }
  }

  // ── Clean staff email index entries from admin DB ──────────────────────────
  // Keep the owner's email index entry — only remove staff entries
  // since staff will be re-seeded by the migration script

  const owner = await tenantConn.collection('users').findOne({ role: 'admin' }) as any

  if (owner) {
    const staffIndexQuery = {
      tenantId: tenant._id,
      userType: 'staff',
    }

    const staffIndexCount = await adminConn
      .collection('user_email_index')
      .countDocuments(staffIndexQuery)

    if (staffIndexCount > 0) {
      if (!DRY_RUN) {
        await adminConn.collection('user_email_index').deleteMany(staffIndexQuery)
        console.log(`\n  ✓ Removed ${staffIndexCount} staff email index entries from admin DB`)
      } else {
        console.log(`\n  [DRY RUN] Would remove ${staffIndexCount} staff email index entries`)
      }
    } else {
      console.log(`\n  ⏭  No staff email index entries to remove`)
    }

    console.log(`\n  ✓ Kept owner account : ${owner.email}`)
    console.log(`  ✓ Kept owner email index entry`)
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log('\n========================================')
  console.log(DRY_RUN ? '  DRY RUN COMPLETE' : '  ✅ CLEANUP COMPLETE')
  console.log('========================================')
  if (!DRY_RUN) {
    console.log(`\n  "${SUBDOMAIN}" is clean and ready for migration.`)
    console.log('  Run next:')
    console.log('  npx tsx scripts/phase1-migrate-client.ts --subdomain=' + SUBDOMAIN)
  }
  console.log('========================================\n')

  await adminConn.close()
  await tenantConn.close()
}

main().catch(err => {
  console.error('\n❌ Cleanup failed:', err)
  process.exit(1)
})
