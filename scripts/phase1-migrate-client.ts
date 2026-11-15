/**
 * Phase 1 Migration: chambu-pos → pos
 * =====================================
 * Copies one chambu-pos client's data from the source database (test)
 * into the new tenant database on the same cluster.
 *
 * The correct source owner is identified by matching the destination
 * owner's email against the source database — this handles the case
 * where multiple businesses shared the same source database.
 *
 * Usage:
 *   npx tsx scripts/phase1-migrate-client.ts --subdomain=allstarbikeshop
 *   npx tsx scripts/phase1-migrate-client.ts --subdomain=allstarbikeshop --dry-run
 *
 * What it copies:
 *   1.  Creates default Branch
 *   2.  Categories
 *   3.  Suppliers
 *   4.  Products + ProductInventory (one per product)
 *   5.  Sales + branchId stamped
 *   6.  Expenses + branchId stamped
 *   7.  Staff + branchId stamped + email index seeded
 *   8.  Customers + creditBalance computed + ledger[] reconstructed
 *   9.  Rentals
 *
 * Skips:
 *   users              — already provisioned via admin panel
 *   reports            — generated snapshots, not worth copying
 *   customer_transactions — used to compute balances, stays in source
 *   inventory_movements   — pos uses stock_ledger instead
 *
 * Run cleanup-tenant.ts first if the destination already has wrong data.
 */

import mongoose from 'mongoose'
import * as dotenv from 'dotenv'
import dns from 'dns'
dns.setDefaultResultOrder('ipv4first')
dotenv.config()

// ── Arg parsing ───────────────────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`
  const arg = process.argv.find(a => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : undefined
}

const SUBDOMAIN = getArg('subdomain')
const SOURCE_DB = getArg('source') || 'test'
const DRY_RUN   = process.argv.includes('--dry-run')

// ── Logging ───────────────────────────────────────────────────────────────────

const header = (title: string) => {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  ${title}`)
  console.log('─'.repeat(60))
}
const ok   = (msg: string) => console.log(`  ✓ ${msg}`)
const skip = (msg: string) => console.log(`  ⏭  ${msg}`)
const warn = (msg: string) => console.log(`  ⚠  ${msg}`)
const info = (msg: string) => console.log(`  ℹ  ${msg}`)
const dry  = (msg: string) => { if (DRY_RUN) console.log(`  [DRY RUN] ${msg}`) }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n========================================')
  console.log('  Phase 1 Migration: chambu-pos → pos')
  if (DRY_RUN) console.log('  MODE: DRY RUN — no writes will be made')
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

  console.log('Connecting to admin DB...')
  const adminConn = await mongoose.createConnection(ADMIN_URI, {
    family: 4, serverSelectionTimeoutMS: 10000,
  }).asPromise()
  ok('Admin DB connected')

  const Tenants        = adminConn.collection('tenants')
  const UserEmailIndex = adminConn.collection('user_email_index')

  const tenant = await Tenants.findOne({
    subdomain: SUBDOMAIN.toLowerCase(),
  }) as any

  if (!tenant) {
    console.error(`\n❌ Tenant "${SUBDOMAIN}" not found. Register it via the admin panel first.`)
    process.exit(1)
  }

  const tenantId = tenant._id
  const destUri  = tenant.mongoUri as string
  const sourceUri = destUri.replace(`/${SUBDOMAIN}?`, `/${SOURCE_DB}?`)

  ok(`Tenant: ${tenant.shopName}`)
  info(`Destination : .../${SUBDOMAIN}`)
  info(`Source      : .../${SOURCE_DB}`)

  // ── Connect to both databases ──────────────────────────────────────────────

  console.log('\nConnecting to source and destination databases...')
  const [sourceConn, destConn] = await Promise.all([
    mongoose.createConnection(sourceUri, { family: 4, serverSelectionTimeoutMS: 10000 }).asPromise(),
    mongoose.createConnection(destUri,   { family: 4, serverSelectionTimeoutMS: 10000 }).asPromise(),
  ])
  ok('Source DB connected')
  ok('Destination DB connected')

  // ── Raw collection handles ─────────────────────────────────────────────────

  const src = {
    users:                sourceConn.collection('users'),
    staff:                sourceConn.collection('staff'),
    products:             sourceConn.collection('products'),
    sales:                sourceConn.collection('sales'),
    customers:            sourceConn.collection('customers'),
    customerTransactions: sourceConn.collection('customer_transactions'),
    expenses:             sourceConn.collection('expenses'),
    categories:           sourceConn.collection('categories'),
    suppliers:            sourceConn.collection('suppliers'),
    rentals:              sourceConn.collection('rentals'),
  }

  const dst = {
    branches:         destConn.collection('branches'),
    users:            destConn.collection('users'),
    staff:            destConn.collection('staff'),
    products:         destConn.collection('products'),
    productInventory: destConn.collection('product_inventory'),
    sales:            destConn.collection('sales'),
    customers:        destConn.collection('customers'),
    expenses:         destConn.collection('expenses'),
    categories:       destConn.collection('categories'),
    suppliers:        destConn.collection('suppliers'),
    rentals:          destConn.collection('rentals'),
  }

  // ── Identify owners ────────────────────────────────────────────────────────
  // Find the destination owner first (provisioned via admin panel).
  // Then match by email in the source database to get the correct source owner.
  // This handles the case where multiple businesses shared one source database.

  const dstOwner = await dst.users.findOne({ role: 'admin' }) as any
  if (!dstOwner) {
    console.error('\n❌ No admin user in destination DB. Was the tenant provisioned via admin panel?')
    process.exit(1)
  }

  const srcOwner = await src.users.findOne({ email: dstOwner.email }) as any
  if (!srcOwner) {
    console.error(`\n❌ Could not find source owner matching email: ${dstOwner.email}`)
    console.error('   Check that the owner email registered in the admin panel matches the chambu-pos account.')
    process.exit(1)
  }

  const srcOwnerId = srcOwner._id
  const dstOwnerId = dstOwner._id

  ok(`Source owner  : ${srcOwner.email} (${srcOwnerId})`)
  ok(`Dest owner    : ${dstOwner.email} (${dstOwnerId})`)

  // Quick sanity check — show what we expect to copy
  const [prodCount, salesCount, custCount, staffCount] = await Promise.all([
    src.products.countDocuments({ userId: srcOwnerId }),
    src.sales.countDocuments({ userId: srcOwnerId }),
    src.customers.countDocuments({ userId: srcOwnerId }),
    src.staff.countDocuments({ userId: srcOwnerId, active: true }),
  ])

  info(`Expecting to copy: ${prodCount} products, ${salesCount} sales, ${custCount} customers, ${staffCount} staff`)

  // ── STEP 1: Create default Branch ─────────────────────────────────────────

  header('Step 1: Create Default Branch')

  const existingBranch = await dst.branches.findOne({ userId: dstOwnerId }) as any
  let defaultBranchId: mongoose.Types.ObjectId

  if (existingBranch) {
    skip(`Branch already exists: "${existingBranch.name}" (${existingBranch._id})`)
    defaultBranchId = existingBranch._id
  } else {
    defaultBranchId = new mongoose.Types.ObjectId()

    if (!DRY_RUN) {
      await dst.branches.insertOne({
        _id:             defaultBranchId,
        userId:          dstOwnerId,
        name:            'Main Branch',
        code:            'MAIN',
        address:         '',
        phone:           srcOwner.phone || '',
        phones:          [],
        emails:          [],
        status:          'active',
        isDefault:       true,
        pricingType:     'retail',
        allowModeToggle: true,
        createdAt:       new Date(),
        updatedAt:       new Date(),
      })
      ok(`Branch created: "Main Branch" → _id: ${defaultBranchId}`)
    } else {
      dry(`Create branch "Main Branch" → _id: ${defaultBranchId}`)
      ok(`Branch would be created`)
    }
  }

  // ── STEP 2: Copy Categories ────────────────────────────────────────────────

  header('Step 2: Copy Categories')

  const categories = await src.categories.find({ userId: srcOwnerId }).toArray()
  let catCopied = 0, catSkipped = 0

  for (const doc of categories) {
    const exists = await dst.categories.findOne({ _id: doc._id })
    if (exists) { catSkipped++; continue }
    if (!DRY_RUN) await dst.categories.insertOne({ ...doc, userId: dstOwnerId })
    catCopied++
  }

  ok(`${catCopied} copied, ${catSkipped} already existed`)

  // ── STEP 3: Copy Suppliers ────────────────────────────────────────────────

  header('Step 3: Copy Suppliers')

  const suppliers = await src.suppliers.find({ userId: srcOwnerId }).toArray()
  let supCopied = 0, supSkipped = 0

  for (const doc of suppliers) {
    const exists = await dst.suppliers.findOne({ _id: doc._id })
    if (exists) { supSkipped++; continue }
    if (!DRY_RUN) await dst.suppliers.insertOne({ ...doc, userId: dstOwnerId })
    supCopied++
  }

  ok(`${supCopied} copied, ${supSkipped} already existed`)

  // ── STEP 4: Copy Products + ProductInventory ──────────────────────────────

  header('Step 4: Copy Products + Create ProductInventory')

  const products = await src.products.find({ userId: srcOwnerId }).toArray()
  let prodCopied = 0, prodSkipped = 0, invCreated = 0, invSkipped = 0

  for (const doc of products) {
    const existsProd = await dst.products.findOne({ _id: doc._id })
    if (!existsProd) {
      if (!DRY_RUN) await dst.products.insertOne({
        ...doc,
        userId: dstOwnerId,
        // chambu-pos does not have lowStockThreshold — set default so
        // restocking and low-stock alerts work correctly in pos
        lowStockThreshold: doc.lowStockThreshold ?? 10,
      })
      prodCopied++
    } else {
      prodSkipped++
    }

    const existsInv = await dst.productInventory.findOne({
      productId: doc._id,
      branchId:  defaultBranchId,
      userId:    dstOwnerId,
    })

    if (!existsInv) {
      const stock = typeof doc.stock === 'number' ? doc.stock : 0
      if (!DRY_RUN) {
        await dst.productInventory.insertOne({
          userId:      dstOwnerId,
          branchId:    defaultBranchId,
          productId:   doc._id,
          stock,
          reserved:    0,
          lastUpdated: new Date(),
          createdAt:   new Date(),
        })
      }
      invCreated++
    } else {
      invSkipped++
    }
  }

  ok(`Products: ${prodCopied} copied, ${prodSkipped} already existed`)
  ok(`ProductInventory: ${invCreated} created, ${invSkipped} already existed`)

  // ── STEP 5: Copy Sales ────────────────────────────────────────────────────

  header('Step 5: Copy Sales')

  const sales = await src.sales.find({ userId: srcOwnerId }).toArray()
  let salesCopied = 0, salesSkipped = 0

  for (const doc of sales) {
    const exists = await dst.sales.findOne({ _id: doc._id })
    if (exists) { salesSkipped++; continue }
    if (!DRY_RUN) {
      await dst.sales.insertOne({
        ...doc,
        userId:   dstOwnerId,
        branchId: defaultBranchId,
      })
    }
    salesCopied++
  }

  ok(`${salesCopied} copied, ${salesSkipped} already existed`)

  // ── STEP 6: Copy Expenses ─────────────────────────────────────────────────

  header('Step 6: Copy Expenses')

  const expenses = await src.expenses.find({ userId: srcOwnerId }).toArray()
  let expCopied = 0, expSkipped = 0

  for (const doc of expenses) {
    const exists = await dst.expenses.findOne({ _id: doc._id })
    if (exists) { expSkipped++; continue }
    if (!DRY_RUN) {
      await dst.expenses.insertOne({
        ...doc,
        userId:   dstOwnerId,
        branchId: defaultBranchId,
      })
    }
    expCopied++
  }

  ok(`${expCopied} copied, ${expSkipped} already existed`)

  // ── STEP 7: Copy Staff + seed email index ─────────────────────────────────

  header('Step 7: Copy Staff + Seed Email Index')
  info('Permissions kept in old format — will be transformed at cutover (Phase 3)')

  const staffList = await src.staff.find({ userId: srcOwnerId, active: true }).toArray()
  let staffCopied = 0, staffSkipped = 0, indexSeeded = 0, indexSkipped = 0

  for (const doc of staffList) {
    // Skip staff whose email matches the owner — that's a staff account
    // created for the owner themselves, already handled by provision
    if (doc.email === dstOwner.email) {
      skip(`Skipping staff account matching owner email: ${doc.email}`)
      continue
    }

    const exists = await dst.staff.findOne({ _id: doc._id })
    if (!exists) {
      if (!DRY_RUN) {
        await dst.staff.insertOne({
          ...doc,
          userId:            dstOwnerId,
          branchId:          defaultBranchId,
          managerOfBranches: [],
        })
      }
      staffCopied++
    } else {
      staffSkipped++
    }

    // Seed email index
    const indexExists = await UserEmailIndex.findOne({
      email:    doc.email.toLowerCase(),
      tenantId: tenantId,
      userType: 'staff',
    })

    if (!indexExists) {
      if (!DRY_RUN) {
        await UserEmailIndex.insertOne({
          email:     doc.email.toLowerCase(),
          tenantId:  tenantId,
          userType:  'staff',
          userId:    doc._id.toString(),
          isActive:  true,
          lastSync:  new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }
      indexSeeded++
    } else {
      indexSkipped++
    }
  }

  ok(`Staff: ${staffCopied} copied, ${staffSkipped} already existed`)
  ok(`Email index: ${indexSeeded} seeded, ${indexSkipped} already existed`)

  // ── STEP 8: Copy Customers + compute balances ─────────────────────────────

  header('Step 8: Copy Customers + Compute Credit Balances')

  const customers = await src.customers.find({ userId: srcOwnerId }).toArray()
  let custCopied = 0, custSkipped = 0, custWithBalance = 0

  for (const doc of customers) {
    const exists = await dst.customers.findOne({ _id: doc._id })
    if (exists) { custSkipped++; continue }

    // Aggregate transactions for this customer
    // chambu-pos: negative = debt (sale on credit), positive = payment
    // pos ledger: amount positive = debt added, negative = debt reduced
    // pos creditBalance: positive = customer owes us
    const transactions = await src.customerTransactions
      .find({ customerId: doc._id, userId: srcOwnerId })
      .sort({ createdAt: 1 })
      .toArray()

    let runningBalance = 0
    const ledger: any[] = []

    for (const tx of transactions) {
      const typeMap: Record<string, string> = {
        sale:       'purchase',
        payment:    'payment',
        adjustment: 'adjustment',
      }

      // Negate: chambu-pos sale = negative, pos purchase = positive
      const ledgerAmount = -(tx.amount)
      runningBalance += ledgerAmount

      ledger.push({
        _id:             new mongoose.Types.ObjectId(),
        date:            tx.createdAt || new Date(),
        type:            typeMap[tx.type] || 'adjustment',
        amount:          ledgerAmount,
        balance:         runningBalance,
        saleId:          tx.referenceId || null,
        note:            tx.description || '',
        collectedBy:     null,
        collectedByType: undefined,
        branchId:        defaultBranchId,
      })
    }

    if (runningBalance !== 0) custWithBalance++

    if (!DRY_RUN) {
      await dst.customers.insertOne({
        ...doc,
        userId:         dstOwnerId,
        creditBalance:  runningBalance,
        depositBalance: 0,
        ledger,
      })
    }
    custCopied++
  }

  ok(`${custCopied} copied, ${custSkipped} already existed`)
  if (custWithBalance > 0) ok(`${custWithBalance} customers have non-zero credit balance`)

  // ── STEP 9: Copy Rentals ──────────────────────────────────────────────────

  header('Step 9: Copy Rentals')

  const rentals = await src.rentals.find({ userId: srcOwnerId }).toArray()
  let rentCopied = 0, rentSkipped = 0

  for (const doc of rentals) {
    const exists = await dst.rentals.findOne({ _id: doc._id })
    if (exists) { rentSkipped++; continue }
    if (!DRY_RUN) await dst.rentals.insertOne({ ...doc, userId: dstOwnerId })
    rentCopied++
  }

  ok(`${rentCopied} copied, ${rentSkipped} already existed`)

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log('\n========================================')
  console.log(DRY_RUN ? '  DRY RUN COMPLETE — no changes were made' : '  ✅ PHASE 1 COMPLETE')
  console.log('========================================')
  console.log(`  Tenant     : ${tenant.shopName}`)
  console.log(`  Branch ID  : ${defaultBranchId}`)
  console.log(`  Categories : ${catCopied}`)
  console.log(`  Suppliers  : ${supCopied}`)
  console.log(`  Products   : ${prodCopied} (+ ${invCreated} inventory records)`)
  console.log(`  Sales      : ${salesCopied}`)
  console.log(`  Expenses   : ${expCopied}`)
  console.log(`  Staff      : ${staffCopied} (+ ${indexSeeded} email index entries)`)
  console.log(`  Customers  : ${custCopied} (${custWithBalance} with balance)`)
  console.log(`  Rentals    : ${rentCopied}`)
  if (!DRY_RUN) {
    console.log('\n  Source database (test) is untouched.')
    console.log('  chambu-pos is still fully operational.')
    console.log('  Next: Phase 2 — log into pos and verify.')
  }
  console.log('========================================\n')

  await adminConn.close()
  await sourceConn.close()
  await destConn.close()
}

main().catch(err => {
  console.error('\n❌ Migration failed:', err)
  process.exit(1)
})
