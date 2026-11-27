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
//   Sum of allocations must equal sum(payments) exactly (±1 cent tolerance).
//
//   `payments` array (new multi-method):
//     Array<{ method, amount, mpesaCode?, mpesaPhone?, bankProviderId?,
//             bankProviderName?, customMethodId?, customMethodName? }>
//   Produces one ledger entry per payment instrument so the dashboard
//   cash-by-method breakdown is accurate.
//
//   Backward compat: flat `amount`/`paymentMethod` still accepted and is
//   normalised into a single-element payments array internally.
//
//   Optional: `depositAllocations: [{ depositId, amount, saleId }]`
//   Draws from customer's existing deposit balance to cover order debt.
//   Each entry creates a deposit_use ledger entry and decrements the Deposit doc.
//
//   Optional: `excess: number`
//   Any overpayment above total order debt. Creates a new Deposit document
//   and increments customer.depositBalance. Uses the last payment method.
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
      // ── New multi-method array (preferred) ───────────────────────────────
      payments: paymentsRaw,  // Array<{ method, amount, mpesaCode?, ... }>

      // ── Legacy flat fields (backward compat, normalised into payments[]) ─
      amount,
      note,
      paymentMethod,
      mpesaCode,
      mpesaPhone,
      bankProviderId,
      bankProviderName,
      customMethodId,
      customMethodName,

      // ── Allocation fields ────────────────────────────────────────────────
      allocations,          // Array<{ saleId, amount }> | undefined
      depositAllocations,   // Array<{ depositId, amount, saleId }> | undefined
      excess,               // number | undefined — overpayment → store credit
    } = body

    // ── Normalise payments into a unified array ─────────────────────────────
    // If the caller sent the new `payments[]` array, use it directly.
    // Otherwise build a single-element array from the legacy flat fields so
    // the rest of the handler only needs to deal with one format.
    let payments: Array<{
      method: string
      amount: number
      mpesaCode?: string
      mpesaPhone?: string
      bankProviderId?: string
      bankProviderName?: string
      customMethodId?: string
      customMethodName?: string
    }>

    if (paymentsRaw && Array.isArray(paymentsRaw) && paymentsRaw.length > 0) {
      payments = paymentsRaw
    } else if (parseFloat(amount) > 0 && paymentMethod) {
      payments = [{
        method: paymentMethod,
        amount: parseFloat(amount),
        mpesaCode: mpesaCode || undefined,
        mpesaPhone: mpesaPhone || undefined,
        bankProviderId: bankProviderId || undefined,
        bankProviderName: bankProviderName || undefined,
        customMethodId: customMethodId || undefined,
        customMethodName: customMethodName || undefined,
      }]
    } else {
      payments = []
    }

    const totalPaymentsAmount = Math.round(payments.reduce((s, p) => s + (p.amount || 0), 0) * 100) / 100

    console.log('[customers/pay] POST — customerId:', id,
      '| totalPayments:', totalPaymentsAmount,
      '| paymentMethods:', payments.map(p => p.method).join('+') || 'none',
      '| allocations:', allocations?.length ?? 0,
      '| depositAllocations:', depositAllocations?.length ?? 0,
      '| excess:', excess ?? 0)

    // ── Basic validation ────────────────────────────────────────────────────
    const hasDepositAllocs = depositAllocations && Array.isArray(depositAllocations) && depositAllocations.length > 0
    const hasExcess = typeof excess === 'number' && excess > 0.005

    // Must have either real payments or deposit allocations
    if (totalPaymentsAmount <= 0 && !hasDepositAllocs) {
      console.warn('[customers/pay] 400 No payment amount and no deposit allocations')
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }

    // Validate each payment entry
    for (const p of payments) {
      if (!p.method) {
        console.warn('[customers/pay] 400 Payment entry missing method —', JSON.stringify(p))
        return NextResponse.json({ error: 'Each payment entry must have a method' }, { status: 400 })
      }
      if (typeof p.amount !== 'number' || p.amount <= 0) {
        console.warn('[customers/pay] 400 Payment entry invalid amount —', JSON.stringify(p))
        return NextResponse.json({ error: 'Each payment entry must have a positive amount' }, { status: 400 })
      }
    }

    const customer = await models.Customer.findOne({ _id: id, userId: ownerId })
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    // ── Build a method suffix string for the base note (used in Mode B) ─────
    const methodSuffix = payments.length === 1
      ? (() => {
          const p = payments[0]
          if (p.method === 'mobile_money' && p.mpesaCode) return ` (M-Pesa: ${p.mpesaCode})`
          if (p.method === 'bank' && p.bankProviderName) return ` (${p.bankProviderName})`
          if (p.method === 'custom' && p.customMethodName) return ` (${p.customMethodName})`
          if (p.method === 'cash') return ' (Cash)'
          if (p.method === 'card') return ' (Card)'
          return ''
        })()
      : payments.map(p => {
          if (p.method === 'cash') return 'Cash'
          if (p.method === 'mobile_money') return p.mpesaCode ? `M-Pesa: ${p.mpesaCode}` : 'M-Pesa'
          if (p.method === 'card') return 'Card'
          if (p.method === 'bank') return p.bankProviderName || 'Bank'
          if (p.method === 'custom') return p.customMethodName || 'Custom'
          return p.method
        }).map((s, i) => ` (${s}: KES ${payments[i].amount.toLocaleString()})`).join('')

    const baseNote = (note || 'Credit payment') + methodSuffix

    // ══════════════════════════════════════════════════════════════════════
    // MODE A — Allocation-aware
    // ══════════════════════════════════════════════════════════════════════
    if (allocations && Array.isArray(allocations) && allocations.length > 0) {

      // Validate cash allocation structure
      for (const alloc of allocations) {
        if (!alloc.saleId || typeof alloc.amount !== 'number' || alloc.amount <= 0) {
          console.warn('[customers/pay] 400 Bad cash allocation — alloc:', JSON.stringify(alloc))
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
            console.warn('[customers/pay] 400 Bad deposit allocation — da:', JSON.stringify(da))
            return NextResponse.json(
              { error: 'Each deposit allocation must have a valid depositId and a positive amount' },
              { status: 400 }
            )
          }
        }
      }

      // Sum check: payments + deposit allocations must equal order allocations
      // Skip when there are no real payments (deposit-only flow) since there
      // is nothing incoming to reconcile against the allocation totals.
      const cashAllocTotal    = allocations.reduce((s: number, a: any) => s + a.amount, 0)
      const depositAllocTotal = hasDepositAllocs
        ? depositAllocations.reduce((s: number, a: any) => s + a.amount, 0) : 0

      if (totalPaymentsAmount > 0) {
        if (Math.abs(cashAllocTotal - totalPaymentsAmount) > 0.01 && !hasExcess) {
          console.warn('[customers/pay] 400 Payment/allocation mismatch —',
            { cashAllocTotal, totalPaymentsAmount, allocations: JSON.stringify(allocations) })
          return NextResponse.json(
            { error: `Allocation total (${cashAllocTotal}) must equal amount received (${totalPaymentsAmount})` },
            { status: 400 }
          )
        }
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
        if (!sale) {
          console.warn('[customers/pay] 400 Sale not found — saleId:', alloc.saleId)
          return NextResponse.json({ error: `Sale ${alloc.saleId} not found` }, { status: 400 })
        }
        if (sale.paymentStatus === 'paid') {
          console.warn('[customers/pay] 400 Sale already paid — order:', sale.orderNumber)
          return NextResponse.json({ error: `Sale ${sale.orderNumber} is already fully paid` }, { status: 400 })
        }
        const currentDebt = sale.debt ?? sale.total
        if (alloc.amount > currentDebt + 0.01) {
          console.warn('[customers/pay] 400 Allocation exceeds debt —', { order: sale.orderNumber, allocAmt: alloc.amount, currentDebt })
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
            if (!sale) {
              console.warn('[customers/pay] 400 Deposit alloc sale not found — saleId:', da.saleId)
              return NextResponse.json({ error: `Sale ${da.saleId} not found` }, { status: 400 })
            }
          }
        }
      }

      // ── All validations passed — write ──────────────────────────────────

      const entryDate = new Date()
      const collectedBy = new Types.ObjectId(payload.userId)
      const collectedByType = payload.type === 'staff' ? 'staff' : 'user'
      const branchObjId = branchContext ? new Types.ObjectId(branchContext) : undefined

      // ── Update sale debts ─────────────────────────────────────────────────
      for (const alloc of allocations) {
        const sale = saleMap.get(alloc.saleId)!
        const currentDebt = sale.debt ?? sale.total
        const newDebt = Math.max(0, Math.round((currentDebt - alloc.amount) * 100) / 100)
        sale.debt = newDebt
        sale.paymentStatus = newDebt <= 0 ? 'paid' : 'partial'
        await sale.save()
      }

      // ── Push one ledger entry per payment method ──────────────────────────
      // Each entry records what physically came in. The order-level attribution
      // lives on the Sale documents (via debt/paymentStatus above).
      let runningBalance = customer.creditBalance
      for (const p of payments) {
        runningBalance = Math.round((runningBalance - p.amount) * 100) / 100

        const methodSuffixSingle = (() => {
          if (p.method === 'mobile_money' && p.mpesaCode) return ` (M-Pesa: ${p.mpesaCode})`
          if (p.method === 'bank' && p.bankProviderName) return ` (${p.bankProviderName})`
          if (p.method === 'custom' && p.customMethodName) return ` (${p.customMethodName})`
          if (p.method === 'cash') return ' (Cash)'
          if (p.method === 'card') return ' (Card)'
          return ''
        })()

        const orderRefs = allocations
          .map((a: any) => saleMap.get(a.saleId)?.orderNumber)
          .filter(Boolean)
          .join(', ')

        customer.ledger.push({
          date: entryDate,
          type: 'payment',
          amount: -p.amount,
          balance: runningBalance,
          note: (note || 'Credit payment') + methodSuffixSingle + (orderRefs ? ` → ${orderRefs}` : ''),
          collectedBy,
          collectedByType,
          branchId: branchObjId,
          paymentMethod: p.method,
          mpesaCode: p.mpesaCode || undefined,
          mpesaPhone: p.mpesaPhone || undefined,
          bankProviderId: p.bankProviderId ? new Types.ObjectId(p.bankProviderId) : undefined,
          bankProviderName: p.bankProviderName || undefined,
          customMethodId: p.customMethodId ? new Types.ObjectId(p.customMethodId) : undefined,
          customMethodName: p.customMethodName || undefined,
        })
      }

      // Decrement creditBalance by total payments received (cash/card/mpesa/bank)
      // plus any deposit allocations that settled credit sales.
      // Both reduce what the customer owes — just from different sources.
      customer.creditBalance = Math.max(0, Math.round((customer.creditBalance - totalPaymentsAmount) * 100) / 100)

      // ── Process deposit allocations ───────────────────────────────────────
      if (hasDepositAllocs) {
        for (const da of depositAllocations) {
          const deposit = await models.Deposit.findOne({
            _id: new Types.ObjectId(da.depositId),
            userId: ownerId,
            status: { $in: ['active', 'partial'] },
          })
          if (!deposit) {
            console.warn('[customers/pay] 400 Deposit not found or not active — depositId:', da.depositId)
            return NextResponse.json({ error: `Deposit ${da.depositId} not found or not active` }, { status: 400 })
          }
          if (da.amount > deposit.balance + 0.01) {
            console.warn('[customers/pay] 400 Deposit insufficient —', { receipt: deposit.receiptNo, balance: deposit.balance, requested: da.amount })
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
            ...(da.saleId ? { saleId: new Types.ObjectId(da.saleId) } : {}),
            amount: cappedDraw,
            date: entryDate,
            consumedBy: collectedBy,
            consumedByModel: payload.type === 'staff' ? 'Staff' : 'User',
          })
          await deposit.save()

          // Update sale debt if saleId provided
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
            date: entryDate,
            type: 'deposit_use',
            amount: -cappedDraw,
            balance: customer.creditBalance,
            saleId: da.saleId ? new Types.ObjectId(da.saleId) : undefined,
            depositId: deposit._id,
            note: da.saleId
              ? `Store credit used → ${saleMap.get(da.saleId)?.orderNumber || da.saleId}`
              : `Store credit used (${deposit.receiptNo})`,
            collectedBy,
            collectedByType,
            branchId: branchObjId,
          })
        }
      }

      // Decrement creditBalance by the total drawn from deposits.
      // The deposit allocations settle credit-sale debt just like cash does —
      // the customer no longer owes that amount.
      if (hasDepositAllocs) {
        const depositAllocTotal = depositAllocations.reduce((s: number, a: any) => s + (a.amount || 0), 0)
        customer.creditBalance = Math.max(0, Math.round((customer.creditBalance - depositAllocTotal) * 100) / 100)
      }

      // ── Process excess → store credit ─────────────────────────────────────
      if (hasExcess) {
        // Use the last payment method for the deposit record
        const lastPayment = payments[payments.length - 1]
        const excessMethod = lastPayment?.method || 'cash'
        const excessBankProviderId = lastPayment?.bankProviderId || null
        const excessBankProviderName = lastPayment?.bankProviderName || ''
        const excessCustomMethodId = lastPayment?.customMethodId || null
        const excessCustomMethodName = lastPayment?.customMethodName || ''
        const excessMpesaCode = lastPayment?.mpesaCode || ''
        const excessMpesaPhone = lastPayment?.mpesaPhone || ''

        // Generate receipt number
        const year = new Date().getFullYear()
        const count = await models.Deposit.countDocuments({
          userId: ownerId,
          receiptNo: { $regex: `^DEP-${year}-` },
        })
        const receiptNo = `DEP-${year}-${String(count + 1).padStart(4, '0')}`

        const newDeposit = new models.Deposit({
          userId: ownerId,
          branchId: branchObjId || null,
          receiptNo,
          customerId: new Types.ObjectId(id),
          customerName: customer.name,
          customerPhone: customer.phone || '',
          amount: excess,
          balance: excess,
          status: 'active',
          method: excessMethod,
          bankProviderId: excessBankProviderId ? new Types.ObjectId(excessBankProviderId) : null,
          bankProviderName: excessBankProviderName,
          customMethodId: excessCustomMethodId ? new Types.ObjectId(excessCustomMethodId) : null,
          customMethodName: excessCustomMethodName,
          mpesaCode: excessMpesaCode,
          mpesaPhone: excessMpesaPhone,
          paymentReference: '',
          consumptions: [],
          refunds: [],
          note: `Overpayment from credit settlement`,
          createdBy: collectedBy,
          createdByModel: payload.type === 'staff' ? 'Staff' : 'User',
        })
        await newDeposit.save()

        customer.depositBalance = Math.round(((customer.depositBalance || 0) + excess) * 100) / 100
        customer.ledger.push({
          date: entryDate,
          type: 'deposit',
          amount: excess,
          balance: customer.depositBalance,
          depositId: newDeposit._id,
          note: `Store credit from overpayment (${baseNote})`,
          paymentMethod: excessMethod,
          collectedBy,
          collectedByType,
          branchId: branchObjId,
        })
      }

      await customer.save()

      return NextResponse.json({
        customer,
        paid: totalPaymentsAmount,
        allocations: allocations.length,
        depositAllocations: hasDepositAllocs ? depositAllocations.length : 0,
        excess: hasExcess ? excess : 0,
        mode: 'allocated',
      })
    }

    // ══════════════════════════════════════════════════════════════════════
    // MODE B — Legacy pool payment (no allocations)
    // ══════════════════════════════════════════════════════════════════════
    const payment = Math.min(totalPaymentsAmount, customer.creditBalance)
    customer.creditBalance = Math.round((customer.creditBalance - payment) * 100) / 100

    // One ledger entry per payment method even in legacy mode
    const entryDateB = new Date()
    let runningBalB = customer.creditBalance + payment // start before deduction, step down
    for (const p of payments) {
      const share = Math.min(p.amount, runningBalB)
      runningBalB = Math.round((runningBalB - share) * 100) / 100
      customer.ledger.push({
        date: entryDateB,
        type: 'payment',
        amount: -share,
        balance: runningBalB,
        note: baseNote,
        collectedBy: new Types.ObjectId(payload.userId),
        collectedByType: payload.type === 'staff' ? 'staff' : 'user',
        branchId: branchContext ? new Types.ObjectId(branchContext) : undefined,
        paymentMethod: p.method,
        mpesaCode: p.mpesaCode || undefined,
        mpesaPhone: p.mpesaPhone || undefined,
        bankProviderId: p.bankProviderId ? new Types.ObjectId(p.bankProviderId) : undefined,
        bankProviderName: p.bankProviderName || undefined,
        customMethodId: p.customMethodId ? new Types.ObjectId(p.customMethodId) : undefined,
        customMethodName: p.customMethodName || undefined,
      })
    }
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
