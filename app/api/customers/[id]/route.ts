import { getTenantDB } from '@/lib/tenant/get-db'
import { getAuthPayload } from '@/lib/jwt'
import { getBranchContext } from '@/lib/branch-context'
import { NextRequest, NextResponse } from 'next/server'
import { Types } from 'mongoose'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await getAuthPayload()
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { models } = await getTenantDB(request)
    const { id } = await params
    const ownerId = payload.type === 'staff' && payload.adminId ? payload.adminId : payload.userId

    const customer = await models.Customer.findOne({ _id: id, userId: ownerId }).lean()
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    return NextResponse.json({ customer })
  } catch (error) {
    console.error('[customers/id] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch customer' }, { status: 500 })
  }
}

// Record a credit payment — supports two modes:
//
// MODE A — Allocation (new, preferred):
//   Pass `allocations: [{ saleId, amount }, ...]`.
//   Each allocation reduces that sale's `debt` and updates `paymentStatus`.
//   A ledger entry with `saleId` is pushed for each allocation.
//   Sum of allocations must equal `amount` exactly (±1 cent tolerance).
//
// MODE B — Pool (legacy, backward compat):
//   No `allocations` field. Behaves exactly as before: reduces
//   `customer.creditBalance` by `amount` with a single unattributed ledger entry.
//   Used by the customer list page quick-pay until Phase 4 replaces it.
//
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await getAuthPayload()
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { models } = await getTenantDB(request)
    const { id } = await params
    const ownerId = payload.type === 'staff' && payload.adminId ? payload.adminId : payload.userId
    const branchContext = await getBranchContext(request)

    const body = await request.json()
    const {
      amount,
      note,
      paymentMethod,
      mpesaCode,
      mpesaPhone,
      bankProviderId,
      bankProviderName,
      customMethodId,
      customMethodName,
      allocations, // Array<{ saleId: string; amount: number }> | undefined
    } = body

    // ── Basic validation ────────────────────────────────────────────────────
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }
    if (!paymentMethod) {
      return NextResponse.json({ error: 'Payment method is required' }, { status: 400 })
    }

    const customer = await models.Customer.findOne({ _id: id, userId: ownerId })
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    // Build the shared payment note suffix
    let methodSuffix = ''
    if (paymentMethod === 'mobile_money' && mpesaCode) methodSuffix = ` (M-Pesa: ${mpesaCode})`
    else if (paymentMethod === 'bank' && bankProviderName)  methodSuffix = ` (${bankProviderName})`
    else if (paymentMethod === 'custom' && customMethodName) methodSuffix = ` (${customMethodName})`
    else if (paymentMethod === 'cash') methodSuffix = ' (Cash)'
    else if (paymentMethod === 'card') methodSuffix = ' (Card)'
    const baseNote = (note || 'Credit payment') + methodSuffix

    // Shared ledger-entry fields
    const ledgerBase: any = {
      date: new Date(),
      type: 'payment',
      collectedBy: new Types.ObjectId(payload.userId),
      collectedByType: payload.type === 'staff' ? 'staff' : 'user',
      branchId: branchContext ? new Types.ObjectId(branchContext) : undefined,
      paymentMethod,
      mpesaCode: mpesaCode || undefined,
      mpesaPhone: mpesaPhone || undefined,
      bankProviderId: bankProviderId ? new Types.ObjectId(bankProviderId) : undefined,
      bankProviderName: bankProviderName || undefined,
      customMethodId: customMethodId ? new Types.ObjectId(customMethodId) : undefined,
      customMethodName: customMethodName || undefined,
    }

    // ══════════════════════════════════════════════════════════════════════
    // MODE A — Allocation-aware
    // ══════════════════════════════════════════════════════════════════════
    if (allocations && Array.isArray(allocations) && allocations.length > 0) {

      // Validate structure
      for (const alloc of allocations) {
        if (!alloc.saleId || typeof alloc.amount !== 'number' || alloc.amount <= 0) {
          return NextResponse.json(
            { error: 'Each allocation must have a valid saleId and a positive amount' },
            { status: 400 }
          )
        }
      }

      // Sum check: allocations must equal amount (±1 cent)
      const allocTotal = allocations.reduce((s: number, a: any) => s + a.amount, 0)
      if (Math.abs(allocTotal - amount) > 0.01) {
        return NextResponse.json(
          { error: `Allocation total (${allocTotal}) must equal payment amount (${amount})` },
          { status: 400 }
        )
      }

      // Load all referenced sales in one query and validate
      const saleIds = allocations.map((a: any) => new Types.ObjectId(a.saleId))
      const sales = await models.Sale.find({
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

      // Validate each allocation amount against the sale's current debt
      for (const alloc of allocations) {
        const sale = saleMap.get(alloc.saleId)
        if (!sale) {
          return NextResponse.json({ error: `Sale ${alloc.saleId} not found` }, { status: 400 })
        }
        if (sale.paymentStatus === 'paid') {
          return NextResponse.json(
            { error: `Sale ${sale.orderNumber} is already fully paid` },
            { status: 400 }
          )
        }
        const currentDebt = sale.debt ?? sale.total
        if (alloc.amount > currentDebt + 0.01) {
          return NextResponse.json(
            { error: `Allocation for ${sale.orderNumber} (${alloc.amount}) exceeds its remaining balance (${currentDebt})` },
            { status: 400 }
          )
        }
      }

      // ── All validations passed — write ──────────────────────────────────

      // Process each allocation: update Sale, build ledger entry
      let runningBalance = customer.creditBalance - amount
      const newLedgerEntries: any[] = []

      for (const alloc of allocations) {
        const sale = saleMap.get(alloc.saleId)!
        const currentDebt = sale.debt ?? sale.total
        const newDebt = Math.max(0, Math.round((currentDebt - alloc.amount) * 100) / 100)

        sale.debt = newDebt
        if (newDebt <= 0) {
          sale.paymentStatus = 'paid'
        } else {
          sale.paymentStatus = 'partial'
        }
        await sale.save()

        newLedgerEntries.push({
          ...ledgerBase,
          amount: -alloc.amount,
          balance: runningBalance, // will be refined below as running balance
          saleId: sale._id,
          note: `${baseNote} → ${sale.orderNumber}`,
        })
      }

      // Recompute running balance properly across ledger entries
      let bal = customer.creditBalance
      for (const entry of newLedgerEntries) {
        bal = Math.round((bal + entry.amount) * 100) / 100
        entry.balance = bal
      }

      // Update customer
      customer.creditBalance = Math.max(0, Math.round((customer.creditBalance - amount) * 100) / 100)
      customer.ledger.push(...newLedgerEntries)
      await customer.save()

      return NextResponse.json({
        customer,
        paid: amount,
        allocations: allocations.length,
        mode: 'allocated',
      })
    }

    // ══════════════════════════════════════════════════════════════════════
    // MODE B — Legacy pool payment (no allocations)
    // ══════════════════════════════════════════════════════════════════════
    const payment = Math.min(amount, customer.creditBalance)
    customer.creditBalance -= payment

    customer.ledger.push({
      ...ledgerBase,
      amount: -payment,
      balance: customer.creditBalance,
      note: baseNote,
    })
    await customer.save()

    return NextResponse.json({ customer, paid: payment, mode: 'pool' })

  } catch (error) {
    console.error('[customers/pay] POST error:', error)
    return NextResponse.json({ error: 'Failed to process payment' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await getAuthPayload()
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { models } = await getTenantDB(request)
    const { id } = await params
    const data = await request.json()

    const customer = await models.Customer.findByIdAndUpdate(id, { $set: data }, { new: true })
    if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ customer })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await getAuthPayload()
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { models } = await getTenantDB(request)
    const { id } = await params
    const data = await request.json()

    const customer = await models.Customer.findByIdAndUpdate(id, { $set: data }, { new: true })
    if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ customer })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await getAuthPayload()
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { models } = await getTenantDB(request)
    const { id } = await params
    await models.Customer.findByIdAndDelete(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete customer' }, { status: 500 })
  }
}
