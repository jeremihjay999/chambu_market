import { getTenantDB } from '@/lib/tenant/get-db'
import { getAuthPayload } from '@/lib/jwt'
import { getBranchContext } from '@/lib/branch-context'
import { NextRequest, NextResponse } from 'next/server'
import { Types } from 'mongoose'

/**
 * PATCH /api/customers/[id]/ledger/[entryId]
 *
 * Attaches an unallocated payment ledger entry (one with no saleId) to one or
 * more orders. Used by the "Unallocated Payments" tab on the customer detail page.
 *
 * Body:
 * {
 *   allocations: [{ saleId: string, amount: number }, ...]
 *   // Sum of allocations must equal the ledger entry's absolute amount (±1 cent).
 *   // Any remainder can be sent as excess → becomes store credit automatically.
 *   excess?: number   // overpayment amount to route to depositBalance
 * }
 *
 * What it does:
 * 1. Validates the ledger entry exists, belongs to this customer, has no saleId
 * 2. For each allocation: decrements sale.debt, updates sale.paymentStatus
 * 3. Stamps the first sale's saleId onto the ledger entry (primary attribution)
 * 4. If multiple sales: pushes additional synthetic payment ledger entries for
 *    the secondary attributions so the full picture is visible
 * 5. If excess: creates a Deposit document, increments depositBalance
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  try {
    const payload = await getAuthPayload()
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { models, conn } = await getTenantDB(request)
    const ownerId = payload.type === 'staff' && payload.adminId ? payload.adminId : payload.userId
    const branchContext = await getBranchContext(request)
    const { id, entryId } = await params

    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(entryId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const body = await request.json()
    const { allocations, excess } = body

    if (!allocations || !Array.isArray(allocations) || allocations.length === 0) {
      return NextResponse.json({ error: 'allocations array is required' }, { status: 400 })
    }
    for (const a of allocations) {
      if (!a.saleId || typeof a.amount !== 'number' || a.amount <= 0) {
        return NextResponse.json(
          { error: 'Each allocation needs a valid saleId and positive amount' },
          { status: 400 }
        )
      }
    }

    // ── Load customer ────────────────────────────────────────────────────────
    const customer = await models.Customer.findOne({ _id: id, userId: ownerId })
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    // ── Find the ledger entry ────────────────────────────────────────────────
    const ledger: any[] = customer.ledger || []
    const entryIndex = ledger.findIndex(
      (e: any) => e._id?.toString() === entryId
    )
    if (entryIndex === -1) {
      return NextResponse.json({ error: 'Ledger entry not found' }, { status: 404 })
    }

    const entry = ledger[entryIndex]

    if (entry.type !== 'payment') {
      return NextResponse.json(
        { error: 'Only payment entries can be attached to orders' },
        { status: 400 }
      )
    }
    if (entry.saleId) {
      return NextResponse.json(
        { error: 'This payment entry is already attributed to a sale' },
        { status: 400 }
      )
    }

    const entryAmount = Math.abs(entry.amount)  // ledger stores as negative
    const hasExcess   = typeof excess === 'number' && excess > 0.005
    const allocTotal  = allocations.reduce((s: number, a: any) => s + a.amount, 0)
    const excessAmt   = hasExcess ? excess : 0
    const totalUsed   = allocTotal + excessAmt

    if (Math.abs(totalUsed - entryAmount) > 0.01) {
      return NextResponse.json(
        { error: `Allocations (${allocTotal}) + excess (${excessAmt}) must equal payment amount (${entryAmount})` },
        { status: 400 }
      )
    }

    // ── Load all referenced sales ────────────────────────────────────────────
    const saleIds = allocations.map((a: any) => new Types.ObjectId(a.saleId))
    const sales   = await models.Sale.find({
      _id: { $in: saleIds },
      customerId: new Types.ObjectId(id),
      voidedAt: null,
    })
    if (sales.length !== allocations.length) {
      return NextResponse.json(
        { error: 'One or more sales not found or do not belong to this customer' },
        { status: 400 }
      )
    }
    const saleMap = new Map(sales.map((s: any) => [s._id.toString(), s]))

    // Validate allocations don't exceed sale debt
    for (const alloc of allocations) {
      const sale = saleMap.get(alloc.saleId)!
      const currentDebt = sale.debt ?? sale.total
      if (alloc.amount > currentDebt + 0.01) {
        return NextResponse.json(
          { error: `Allocation for ${sale.orderNumber} (${alloc.amount}) exceeds its remaining balance (${currentDebt})` },
          { status: 400 }
        )
      }
    }

    // ── All validations passed — write ───────────────────────────────────────

    // 1. Update each sale
    for (const alloc of allocations) {
      const sale = saleMap.get(alloc.saleId)!
      const currentDebt = sale.debt ?? sale.total
      const newDebt     = Math.max(0, Math.round((currentDebt - alloc.amount) * 100) / 100)
      sale.debt          = newDebt
      sale.paymentStatus = newDebt <= 0 ? 'paid' : 'partial'
      await sale.save()
    }

    // 2. Stamp saleId on the existing ledger entry (primary allocation — first sale)
    customer.ledger[entryIndex].saleId = new Types.ObjectId(allocations[0].saleId)
    if (allocations.length > 1) {
      // Update the note to reflect the primary sale
      const primarySale = saleMap.get(allocations[0].saleId)
      if (primarySale) {
        customer.ledger[entryIndex].note =
          (customer.ledger[entryIndex].note || 'Credit payment') +
          ` → ${primarySale.orderNumber}`
      }
    }

    // 3. For secondary allocations (amount > 1 order), push synthetic entries
    //    so each covered order has a traceable ledger record
    if (allocations.length > 1) {
      for (let i = 1; i < allocations.length; i++) {
        const alloc = allocations[i]
        const sale  = saleMap.get(alloc.saleId)!
        customer.ledger.push({
          _id:              new Types.ObjectId(),
          date:             entry.date,  // same date as the original payment
          type:             'payment',
          amount:           -alloc.amount,
          balance:          entry.balance, // balance unchanged — this is a split
          saleId:           sale._id,
          note:             `${entry.note || 'Credit payment'} → ${sale.orderNumber} (split)`,
          paymentMethod:    entry.paymentMethod,
          mpesaCode:        entry.mpesaCode,
          mpesaPhone:       entry.mpesaPhone,
          bankProviderId:   entry.bankProviderId,
          bankProviderName: entry.bankProviderName,
          customMethodId:   entry.customMethodId,
          customMethodName: entry.customMethodName,
          collectedBy:      entry.collectedBy,
          collectedByType:  entry.collectedByType,
          branchId:         entry.branchId,
        })
      }
    }

    // 4. Excess → store credit (new Deposit document)
    if (hasExcess) {
      const year  = new Date().getFullYear()
      const count = await models.Deposit.countDocuments({
        userId: ownerId,
        receiptNo: { $regex: `^DEP-${year}-` },
      })
      const receiptNo = `DEP-${year}-${String(count + 1).padStart(4, '0')}`

      const newDeposit = new models.Deposit({
        userId:         ownerId,
        branchId:       branchContext ? new Types.ObjectId(branchContext) : null,
        receiptNo,
        customerId:     new Types.ObjectId(id),
        customerName:   customer.name,
        customerPhone:  customer.phone || '',
        amount:         excessAmt,
        balance:        excessAmt,
        status:         'active',
        method:         entry.paymentMethod || 'cash',
        bankProviderId: entry.bankProviderId || null,
        bankProviderName: entry.bankProviderName || '',
        customMethodId: entry.customMethodId || null,
        customMethodName: entry.customMethodName || '',
        mpesaCode:      entry.mpesaCode || '',
        mpesaPhone:     entry.mpesaPhone || '',
        paymentReference: '',
        consumptions:   [],
        refunds:        [],
        note:           `Overpayment from payment on ${new Date(entry.date).toLocaleDateString('en-GB')}`,
        createdBy:      new Types.ObjectId(payload.userId),
        createdByModel: payload.type === 'staff' ? 'Staff' : 'User',
      })
      await newDeposit.save()

      customer.depositBalance = Math.round(
        ((customer.depositBalance || 0) + excessAmt) * 100
      ) / 100
      customer.ledger.push({
        date:          new Date(),
        type:          'deposit',
        amount:        excessAmt,
        balance:       customer.depositBalance,
        depositId:     newDeposit._id,
        note:          `Store credit from overpayment (attached from unallocated payment)`,
        paymentMethod: entry.paymentMethod,
        collectedBy:   new Types.ObjectId(payload.userId),
        collectedByType: payload.type === 'staff' ? 'staff' : 'user',
        branchId:      branchContext ? new Types.ObjectId(branchContext) : undefined,
      })
    }

    await customer.save()

    return NextResponse.json({
      ok: true,
      attributed: allocations.length,
      excess: hasExcess ? excessAmt : 0,
    })

  } catch (error) {
    console.error('[customers/ledger/entryId] PATCH error:', error)
    return NextResponse.json({ error: 'Failed to attribute payment' }, { status: 500 })
  }
}
