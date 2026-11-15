/**
 * Checks ProductInventory records for a tenant and compares against Product.stock
 * Run with: npx tsx scripts/check-inventory.ts --subdomain=allstarbikeshop
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

  const conn = await mongoose.createConnection(tenant.mongoUri, {
    family: 4, serverSelectionTimeoutMS: 10000,
  }).asPromise()

  const owner = await conn.collection('users').findOne({ role: 'admin' }) as any
  const ownerId = owner._id

  const branch = await conn.collection('branches').findOne({ userId: ownerId }) as any
  const branchId = branch?._id

  console.log(`\nOwner    : ${owner.email}`)
  console.log(`Branch   : ${branch?.name} (${branchId})`)

  const productCount    = await conn.collection('products').countDocuments({ userId: ownerId })
  const inventoryCount  = await conn.collection('product_inventory').countDocuments({ userId: ownerId, branchId })
  const lowStockInv     = await conn.collection('product_inventory').countDocuments({
    userId: ownerId,
    branchId,
    $expr: { $lt: ['$stock', 10] }
  })

  console.log(`\nProducts total         : ${productCount}`)
  console.log(`ProductInventory total : ${inventoryCount}`)
  console.log(`ProductInventory < 10  : ${lowStockInv}`)

  if (productCount !== inventoryCount) {
    console.log(`\n⚠️  MISMATCH: ${productCount - inventoryCount} products have no ProductInventory record`)
  } else {
    console.log(`\n✓ All products have a ProductInventory record`)
  }

  // Sample 5 inventory records to verify stock values
  console.log('\nSample ProductInventory records:')
  const samples = await conn.collection('product_inventory')
    .find({ userId: ownerId, branchId })
    .limit(5)
    .toArray() as any[]

  for (const inv of samples) {
    const product = await conn.collection('products').findOne({ _id: inv.productId }) as any
    console.log(`  ${(product?.productName || 'unknown').substring(0, 35).padEnd(35)} inv.stock=${inv.stock}  product.stock=${product?.stock}  threshold=${product?.lowStockThreshold}`)
  }

  // Check low stock using same logic as restocking route
  const inventories = await conn.collection('product_inventory')
    .find({ userId: ownerId, branchId })
    .toArray() as any[]

  const productIds = inventories.map(i => i.productId)
  const products = await conn.collection('products')
    .find({ userId: ownerId, _id: { $in: productIds } })
    .toArray() as any[]

  const productMap = new Map(products.map(p => [p._id.toString(), p]))
  const invMap     = new Map(inventories.map(i => [i.productId.toString(), i]))

  const lowStock = products.filter(p => {
    const stock     = invMap.get(p._id.toString())?.stock ?? 0
    const threshold = p.lowStockThreshold ?? 0
    return stock < threshold
  })

  console.log(`\nLow stock items (inv.stock < threshold): ${lowStock.length}`)
  lowStock.slice(0, 5).forEach(p => {
    const stock = invMap.get(p._id.toString())?.stock ?? 0
    console.log(`  ${p.productName.substring(0, 35).padEnd(35)} stock=${stock}  threshold=${p.lowStockThreshold}`)
  })

  await conn.close()
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
