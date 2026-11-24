import { getTenantDB } from '@/lib/tenant/get-db'
import { getAuthPayload } from '@/lib/jwt'
import { getBranchContext } from '@/lib/branch-context'
import { NextRequest, NextResponse } from 'next/server'
import { Types } from 'mongoose'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await getAuthPayload()
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { models, conn } = await getTenantDB(request)
    const { id } = await params
    const ownerId = payload.type === 'staff' && payload.adminId ? payload.adminId : payload.userId

    const customer = await models.Customer.findOne({ _id: id, userId: ownerId }).lean() as any
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    // Resolve collectedBy names for every ledger entry so the client
    // can display "james kanyua" instead of a raw ObjectId
    const ledger: any[] = customer.ledger || []
    const collectedByIds = [...new Set(
      ledger.filter(e => e.collectedBy).map(e => e.collectedBy.toString())
    )]

    const nameMap = new Map<string, string>()
    if (collectedByIds.length > 0) {
      const oids = collectedByIds.map(i => new Types.ObjectId(i))
      const [staffDocs, userDocs] = await Promise.all([
        conn.db.collection('staff').find({ _id: { $in: oids } })
          .project({ _id: 1, name: 1, firstName: 1, lastName: 1 }).toArray(),
        conn.db.collection('users').find({ _id: { $in: oids } })
          .project({ _id: 1, firstName: 1, lastName: 1, shopName: 1, email: 1 }).toArray(),
      ])
      for (const s of staffDocs as any[]) {
        const name = [s.firstName, s.lastName].filter(Boolean).join(' ') || s.name || s._id.toString()
        nameMap.set(s._id.toString(), name)
      }
      for (const u of userDocs as any[]) {
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.shopName || u.email || u._id.toString()
        nameMap.set(u._id.toString(), name)
      }
    }

    // Stamp collectedByName onto each ledger entry
    const enrichedLedger = ledger.map(e => ({
      ...e,
      collectedByName: e.collectedBy ? (nameMap.get(e.collectedBy.toString()) || null) : null,
    }))

    return NextResponse.json({ customer: { ...customer, ledger: enrichedLedger } })
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
//   Optional: `depositAllocations: [{ depositId, amount, saleId }]`
//   Draws from customer's existing deposit balance to cover order debt.
//   Each entry creates a deposit_use ledger entry and decrements the Deposit doc.
//
//   Optional: `excess: number`
//   Any overpayment above total order debt. Creates a new Deposit document
//   and increments customer.depositBalance. Real cash — counts in day totals.
//
// MODE B — Pool (legacy, backward compat):
//   No `allocations` field. Behaves exactly as before: reduces
//   `customer.creditBalance` by `amount` with a single unattributed ledger entry.
//
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await getAuthPayload()
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { models, conn } = await getTenantDB(request)
    const { id } = await params
    const ownerId = payload.type === 'staff' && payload.adminId ? payload.adminId : payload.userId
    const branchContext = await getBranchContext(request)

    const body = await request.json()
    const {
      amount,           // cash received
      note,
      paymentMethod,
      mpesaCode,
      mpesaPhone,
      bankProviderId,
      bankProviderName,
      customMethodId,
      customMethodName,
      allocations,          // Array<{ saleId, amount }> | undefined  — cash allocations
      depositAllocations,   // Array<{ depositId, amount, saleId }> | undefined
      excess,               // number | undefined — overpayment → store credit
    } = body

    // ── Basic validation ────────────────────────────────────────────────────
    const cashAmount = parseFloat(amount) || 0
    const hasDepositAllocs = depositAllocations && Array.isArray(depositAllocations) && depositAllocations.length > 0
    const hasExcess = typeof excess === 'number' && excess > 0.005

    // Must have either cash or deposit allocations
    if (cashAmount <= 0 && !hasDepositAllocs) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }
    if (cashAmount > 0 && !paymentMethod) {
      return NextResponse.json({ error: 'Payment method is required' }, { status: 400 })
    }

    const customer = await models.Customer.findOne({ _id: id, userId: ownerId })
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    // Build the shared payment note suffix for cash payments
    let methodSuffix = ''
    if (paymentMethod === 'mobile_money' && mpesaCode) methodSuffix = ` (M-Pesa: ${mpesaCode})`
    else if (paymentMethod === 'bank' && bankProviderName)   methodSuffix = ` (${bankProviderName})`
    else if (paymentMethod === 'custom' && customMethodName) methodSuffix = ` (${customMethodName})`
    else if (paymentMethod === 'cash') methodSuffix = ' (Cash)'
    else if (paymentMethod === 'card') methodSuffix = ' (Card)'
    const baseNote = (note || 'Credit payment') + methodSuffix

    // Shared ledger-entry fields for cash payment entries
    const cashLedgerBase: any = {
      date: new Date(),
      type: 'payment',
      collectedBy: new Types.ObjectId(payload.userId),
      collectedByType: payload.type === 'staff' ? 'staff' : 'user',
      branchId: branchContext ? new Types.ObjectId(branchContext) : undefined,
      paymentMethod: paymentMethod || undefined,
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

      // Validate cash allocation structure
      for (const alloc of allocations) {
        if (!alloc.saleId || typeof alloc.amount !== 'number' || alloc.amount <= 0) {
          return NextResponse.json(
            { error: 'Each allocation must have a valid saleId and a positive amount' },
            { status: 400 }
          )
        }
      }

      // Validate deposit allocations if present
      if (hasDepositAllocs) {
        for (const da of depositAllocations) {
          if (!da.depositId || typeof da.amount !== 'number' || da.amount <= 0) {
            return NextResponse.json(
              { error: 'Each deposit allocation must have a valid depositId and a positive amount' },
              { status: 400 }
            )
          }
        }
      }

      // Sum check: cash allocations + deposit allocations = cash amount + deposit amount
      const cashAllocTotal     = allocations.reduce((s: number, a: any) => s + a.amount, 0)
      const depositAllocTotal  = hasDepositAllocs
        ? depositAllocations.reduce((s: number, a: any) => s + a.amount, 0) : 0
      const totalAllocated     = cashAllocTotal + depositAllocTotal
      const excessAmount       = hasExcess ? excess : 0
      const totalIn            = cashAmount + depositAllocTotal

      if (Math.abs(cashAllocTotal - cashAmount) > 0.01 && !hasExcess) {
        return NextResponse.json(
          { error: `Cash allocation total (${cashAllocTotal}) must equal amount received (${cashAmount})` },
          { status: 400 }
        )
      }

      // Collect all saleIds (from both cash and deposit allocations)
      const allSaleIds = [
        ...allocations.map((a: any) => a.saleId),
        ...(hasDepositAllocs ? depositAllocations.filter((a: any) => a.saleId).map((a: any) => a.saleId) : []),
      ]
      const uniqueSaleIds = [...new Set(allSaleIds)]

      // Load all referenced sales
      const sales = await models.Sale.find({
        _id: { $in: uniqueSaleIds.map((s: string) => new Types.ObjectId(s)) },
        customerId: new Types.ObjectId(id),
        voidedAt: null,
      })
      const saleMap = new Map(sales.map((s: any) => [s._id.toString(), s]))

      // Validate cash allocations against sale debt
      for (const alloc of allocations) {
        const sale = saleMap.get(alloc.saleId)
        if (!sale) return NextResponse.json({ error: `Sale ${alloc.saleId} not found` }, { status: 400 })
        if (sale.paymentStatus === 'paid') {
          return NextResponse.json({ error: `Sale ${sale.orderNumber} is already fully paid` }, { status: 400 })
        }
        const currentDebt = sale.debt ?? sale.total
        if (alloc.amount > currentDebt + 0.01) {
          return NextResponse.json(
            { error: `Allocation for ${sale.orderNumber} (${alloc.amount}) exceeds its remaining balance (${currentDebt})` },
            { status: 400 }
          )
        }
      }

      // Validate deposit allocations against sale debt
      if (hasDepositAllocs) {
        for (const da of depositAllocations) {
          if (da.saleId) {
            const sale = saleMap.get(da.saleId)
            if (!sale) return NextResponse.json({ error: `Sale ${da.saleId} not found` }, { status: 400 })
          }
        }
      }

      // ── All validations passed — write ──────────────────────────────────

      const newLedgerEntries: any[] = []
      let runningCreditBalance = customer.creditBalance

      // ── Process cash allocations ──────────────────────────────────────────
      for (const alloc of allocations) {
        const sale = saleMap.get(alloc.saleId)!
        const currentDebt = sale.debt ?? sale.total
        const newDebt = Math.max(0, Math.round((currentDebt - alloc.amount) * 100) / 100)
        sale.debt = newDebt
        sale.paymentStatus = newDebt <= 0 ? 'paid' : 'partial'
        await sale.save()

        runningCreditBalance = Math.round((runningCreditBalance - alloc.amount) * 100) / 100
        newLedgerEntries.push({
          ...cashLedgerBase,
          amount: -alloc.amount,
          balance: runningCreditBalance,
          saleId: sale._id,
          note: `${baseNote} → ${sale.orderNumber}`,
        })
      }

      // Recompute running balance properly
      let bal = customer.creditBalance
      for (const entry of newLedgerEntries) {
        bal = Math.round((bal + entry.amount) * 100) / 100
        entry.balance = bal
      }
      customer.creditBalance = Math.max(0, Math.round((customer.creditBalance - cashAmount) * 100) / 100)
      customer.ledger.push(...newLedgerEntries)

      // ── Process deposit allocations ───────────────────────────────────────
      if (hasDepositAllocs) {
        for (const da of depositAllocations) {
          const deposit = await models.Deposit.findOne({
            _id: new Types.ObjectId(da.depositId),
            userId: ownerId,
            status: { $in: ['active', 'partial'] },
          })
          if (!deposit) {
            return NextResponse.json({ error: `Deposit ${da.depositId} not found or not active` }, { status: 400 })
          }
          if (da.amount > deposit.balance + 0.01) {
            return NextResponse.json(
              { error: `Deposit ${deposit.receiptNo} balance (${deposit.balance}) insufficient for ${da.amount}` },
              { status: 400 }
            )
          }

          // Decrement deposit
          const cappedDraw = Math.min(da.amount, deposit.balance)
          deposit.balance = Math.max(0, Math.round((deposit.balance - cappedDraw) * 100) / 100)
          deposit.status = deposit.balance <= 0 ? 'used' : 'partial'
          deposit.consumptions = deposit.consumptions || []
          deposit.consumptions.push({
            saleId: da.saleId ? new Types.ObjectId(da.saleId) : undefined,
            amount: cappedDraw,
            date: new Date(),
            consumedBy: new Types.ObjectId(payload.userId),
            consumedByModel: payload.type === 'staff' ? 'Staff' : 'User',
          })
          await deposit.save()

          // Update sale if saleId provided
          if (da.saleId) {
            const sale = saleMap.get(da.saleId)
            if (sale) {
              const currentDebt = sale.debt ?? sale.total
              const newDebt = Math.max(0, Math.round((currentDebt - cappedDraw) * 100) / 100)
              sale.debt = newDebt
              sale.paymentStatus = newDebt <= 0 ? 'paid' : 'partial'
              await sale.save()
            }
          }

          // Customer: decrement depositBalance, push deposit_use ledger entry
          customer.depositBalance = Math.max(0, Math.round(((customer.depositBalance || 0) - cappedDraw) * 100) / 100)
          customer.ledger.push({
            date: new Date(),
            type: 'deposit_use',
            amount: -cappedDraw,
            balance: customer.creditBalance,
            saleId: da.saleId ? new Types.ObjectId(da.saleId) : undefined,
            depositId: deposit._id,
            note: da.saleId
              ? `Store credit used → ${saleMap.get(da.saleId)?.orderNumber || da.saleId}`
              : `Store credit used (${deposit.receiptNo})`,
            collectedBy: new Types.ObjectId(payload.userId),
            collectedByType: payload.type === 'staff' ? 'staff' : 'user',
            branchId: branchContext ? new Types.ObjectId(branchContext) : undefined,
          })
        }
      }

      // ── Process excess → store credit ─────────────────────────────────────
      if (hasExcess) {
        // Generate receipt number
        const year = new Date().getFullYear()
        const count = await models.Deposit.countDocuments({
          userId: ownerId,
          receiptNo: { $regex: `^DEP-${year}-` },
        })
        const receiptNo = `DEP-${year}-${String(count + 1).padStart(4, '0')}`

        const newDeposit = new models.Deposit({
          userId: ownerId,
          branchId: branchContext ? new Types.ObjectId(branchContext) : null,
          receiptNo,
          customerId: new Types.ObjectId(id),
          customerName: customer.name,
          customerPhone: customer.phone || '',
          amount: excess,
          balance: excess,
          status: 'active',
          method: paymentMethod || 'cash',
          bankProviderId: bankProviderId ? new Types.ObjectId(bankProviderId) : null,
          bankProviderName: bankProviderName || '',
          customMethodId: customMethodId ? new Types.ObjectId(customMethodId) : null,
          customMethodName: customMethodName || '',
          mpesaCode: mpesaCode || '',
          mpesaPhone: mpesaPhone || '',
          paymentReference: '',
          consumptions: [],
          refunds: [],
          note: `Overpayment from credit settlement`,
          createdBy: new Types.ObjectId(payload.userId),
          createdByModel: payload.type === 'staff' ? 'Staff' : 'User',
        })
        await newDeposit.save()

        customer.depositBalance = Math.round(((customer.depositBalance || 0) + excess) * 100) / 100
        customer.ledger.push({
          date: new Date(),
          type: 'deposit',
          amount: excess,
          balance: customer.depositBalance,
          depositId: newDeposit._id,
          note: `Store credit from overpayment (${baseNote})`,
          paymentMethod: paymentMethod || undefined,
          collectedBy: new Types.ObjectId(payload.userId),
          collectedByType: payload.type === 'staff' ? 'staff' : 'user',
          branchId: branchContext ? new Types.ObjectId(branchContext) : undefined,
        })
      }

      await customer.save()

      return NextResponse.json({
        customer,
        paid: cashAmount,
        allocations: allocations.length,
        depositAllocations: hasDepositAllocs ? depositAllocations.length : 0,
        excess: hasExcess ? excess : 0,
        mode: 'allocated',
      })
    }

    // ══════════════════════════════════════════════════════════════════════
    // MODE B — Legacy pool payment (no allocations)
    // ══════════════════════════════════════════════════════════════════════
    const payment = Math.min(cashAmount, customer.creditBalance)
    customer.creditBalance -= payment

    customer.ledger.push({
      ...cashLedgerBase,
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
