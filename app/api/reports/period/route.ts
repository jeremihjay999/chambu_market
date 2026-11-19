import { getTenantDB } from '@/lib/tenant/get-db'
import { getAuthPayload } from '@/lib/jwt'
import { getBranchContext } from '@/lib/branch-context'
import { NextRequest, NextResponse } from 'next/server'
import { Types } from 'mongoose'
import { normalisePermissions } from '@/lib/modules'
import { canSeeBuyingPrice } from '@/lib/buying-price'

// ── helpers (mirrors end-of-day) ─────────────────────────────────────────────

function cappedPaymentAmount(payment: any, allPayments: any[], saleTotal: number): number {
  const methodName = payment.customMethodName || payment.method || 'cash'
  const otherTotal = allPayments
    .filter((op: any) => {
      const opName = op.customMethodName || op.method || 'cash'
      return opName !== methodName && opName.toLowerCase() !== 'credit'
    })
    .reduce((s: number, op: any) => s + (op.amount || 0), 0)
  return Math.min(payment.amount || 0, Math.max(0, saleTotal - otherTotal))
}

function resolveMethodName(payment: any): string {
  if (payment.method === 'cash') return 'Cash'
  if (payment.method === 'mobile_money') return 'M-Pesa'
  if (payment.method === 'bank' && payment.bankProviderName) return payment.bankProviderName
  if (payment.method === 'custom' && payment.customMethodName) return payment.customMethodName
  return payment.method || 'Other'
}

function resolveLedgerMethodName(entry: any): string {
  if (entry.paymentMethod === 'cash') return 'Cash'
  if (entry.paymentMethod === 'mobile_money') return 'M-Pesa'
  if (entry.paymentMethod === 'bank' && entry.bankProviderName) return entry.bankProviderName
  if (entry.paymentMethod === 'custom' && entry.customMethodName) return entry.customMethodName
  if (entry.paymentMethod) return entry.paymentMethod
  return 'Cash'
}

function resolveReceiptMethodName(r: any): string {
  if (r.paymentMethod === 'cash') return 'Cash'
  if (r.paymentMethod === 'mobile_money') return 'M-Pesa'
  if (r.paymentMethod === 'bank' && r.bankProviderName) return r.bankProviderName
  if (r.paymentMethod === 'custom' && r.customMethodName) return r.customMethodName
  return r.paymentMethod || 'Cash'
}

// ── GET /api/reports/period?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD ──────────

export async function GET(request: NextRequest) {
  try {
    const payload = await getAuthPayload()
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { models, conn } = await getTenantDB(request)
    const isStaff = payload.type === 'staff'
    const ownerId = isStaff && payload.adminId ? payload.adminId : payload.userId
    const branchContext = await getBranchContext(request)

    const perms = isStaff ? normalisePermissions(payload.permissions || {}) : null
    const canSeeFullReport = !isStaff || perms?.['pos.reports'] === true
    const staffScopeId = isStaff && !canSeeFullReport ? payload.userId : null

    if (!branchContext) {
      return NextResponse.json({ error: 'Branch context required' }, { status: 400 })
    }

    const url = new URL(request.url)

    // Default: first day of current month → today
    const now = new Date()
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const defaultEnd = new Date()

    const startParam = url.searchParams.get('startDate')
    const endParam = url.searchParams.get('endDate')

    const periodStart = new Date(startParam ? startParam : defaultStart.toISOString().split('T')[0])
    const periodEnd = new Date(endParam ? endParam : defaultEnd.toISOString().split('T')[0])

    periodStart.setHours(0, 0, 0, 0)
    periodEnd.setHours(23, 59, 59, 999)

    // ── Branch ───────────────────────────────────────────────────────────────
    const branch = await models.Branch.findById(branchContext).lean() as any
    if (!branch) return NextResponse.json({ error: 'Branch not found' }, { status: 404 })

    // ── 1. Sales ─────────────────────────────────────────────────────────────
    const sales = await models.Sale.find({
      userId: ownerId,
      branchId: branchContext,
      createdAt: { $gte: periodStart, $lte: periodEnd },
      status: { $ne: 'held' },
      ...(staffScopeId ? { staffId: new Types.ObjectId(staffScopeId) } : {}),
    }).populate('items.productId', 'buyingPrice').lean()

    // ── 1b. COGS (cost of goods sold) ────────────────────────────────────────
    // Batch-fetch all SALE StockLedger entries for the period's sales in one
    // query. unitCost is not written by the sales route today, so it will
    // always be undefined and the fallback to item.productId.buyingPrice fires.
    // The infra is here so it works automatically once unitCost is populated.
    const showCost = canSeeBuyingPrice(payload)
    let totalCOGS = 0
    let grossProfit = 0
    let grossMarginPct = 0

    if (showCost) {
      const saleIds = sales.map((s: any) => s._id)
      const ledgerEntries = await models.StockLedger.find({
        userId: ownerId,
        saleId: { $in: saleIds },
        type: 'SALE',
      }).select('saleId productId unitCost').lean() as any[]

      // Build a fast lookup: `${saleId}:${productId}` → unitCost
      const ledgerMap = new Map<string, number>()
      for (const e of ledgerEntries) {
        const k = `${e.saleId}:${e.productId}`
        if (e.unitCost != null) ledgerMap.set(k, e.unitCost)
      }

      for (const sale of sales) {
        for (const item of (sale.items || [])) {
          const pid = item.productId?._id ?? item.productId
          const key = `${sale._id}:${pid}`
          const unitCost = ledgerMap.has(key)
            ? ledgerMap.get(key)!
            : (item.productId?.buyingPrice ?? 0)
          totalCOGS += unitCost * (item.quantity || 0)
        }
      }

      const totalSalesRev = sales.reduce((s: number, sale: any) => s + (sale.total || 0), 0)
      grossProfit = totalSalesRev - totalCOGS
      grossMarginPct = totalSalesRev > 0 ? parseFloat(((grossProfit / totalSalesRev) * 100).toFixed(2)) : 0
    }

    // ── 2. Payment method aggregation by employee ─────────────────────────────
    const paymentsByEmployee = new Map<string, Map<string, number>>()
    const allPaymentMethods = new Set<string>()
    const staffIds = new Set<string>()
    const depositsUsedTotal: number[] = []

    for (const sale of sales) {
      const saleStaffId = sale.staffId ? sale.staffId.toString() : 'owner'
      staffIds.add(saleStaffId)
      if (!paymentsByEmployee.has(saleStaffId)) {
        paymentsByEmployee.set(saleStaffId, new Map())
      }
      const empMap = paymentsByEmployee.get(saleStaffId)!

      if (sale.payments && Array.isArray(sale.payments)) {
        for (const payment of sale.payments) {
          if ((payment.method || '').toLowerCase() === 'credit') continue
          if ((payment.method || '').toLowerCase() === 'deposit') {
            depositsUsedTotal.push(parseFloat(payment.amount) || 0)
            continue
          }
          const methodName = resolveMethodName(payment)
          const capped = cappedPaymentAmount(payment, sale.payments, sale.total)
          allPaymentMethods.add(methodName)
          empMap.set(methodName, (empMap.get(methodName) || 0) + capped)
        }
      } else if (sale.paymentMethod) {
        if (sale.paymentMethod.toLowerCase() === 'credit') continue
        let methodName = ''
        if (sale.paymentMethod === 'cash') methodName = 'Cash'
        else if (sale.paymentMethod === 'mobile_money') methodName = 'M-Pesa'
        else methodName = sale.paymentMethod
        allPaymentMethods.add(methodName)
        empMap.set(methodName, (empMap.get(methodName) || 0) + (sale.total || 0))
      }
    }

    // ── 3a. Credit payments received ─────────────────────────────────────────
    const creditPaymentCustomers = await models.Customer.find({
      userId: ownerId,
      'ledger.date': { $gte: periodStart, $lte: periodEnd },
      'ledger.type': 'payment',
      'ledger.branchId': branchContext,
    }).lean()

    let totalCreditPaymentsReceived = 0

    for (const customer of creditPaymentCustomers) {
      for (const entry of customer.ledger) {
        const entryDate = new Date(entry.date)
        if (entryDate < periodStart || entryDate > periodEnd) continue
        if (entry.type !== 'payment' || entry.amount >= 0) continue
        if (staffScopeId && entry.collectedBy?.toString() !== staffScopeId) continue
        if (branchContext && entry.branchId?.toString() !== branchContext.toString()) continue

        const paymentAmount = Math.abs(entry.amount)
        const collectorId = entry.collectedBy?.toString() || 'owner'
        staffIds.add(collectorId)
        if (!paymentsByEmployee.has(collectorId)) paymentsByEmployee.set(collectorId, new Map())
        const methodName = resolveLedgerMethodName(entry)
        allPaymentMethods.add(methodName)
        const empMap = paymentsByEmployee.get(collectorId)!
        empMap.set(methodName, (empMap.get(methodName) || 0) + paymentAmount)
        totalCreditPaymentsReceived += paymentAmount
      }
    }

    // ── 3b. Customer deposits received & refunded ────────────────────────────
    const depositLedgerCustomers = await models.Customer.find({
      userId: ownerId,
      'ledger.date': { $gte: periodStart, $lte: periodEnd },
      'ledger.type': { $in: ['deposit', 'deposit_refund'] },
      'ledger.branchId': branchContext,
    }).lean()

    let totalDepositsReceived = 0
    const depositRefundsByMethod = new Map<string, number>()

    for (const customer of depositLedgerCustomers) {
      for (const entry of customer.ledger) {
        const entryDate = new Date(entry.date)
        if (entryDate < periodStart || entryDate > periodEnd) continue

        if (entry.type === 'deposit' && entry.amount > 0) {
          if (staffScopeId && entry.collectedBy?.toString() !== staffScopeId) continue
          if (branchContext && entry.branchId?.toString() !== branchContext.toString()) continue

          const methodName = resolveLedgerMethodName(entry)
          const collectorId = entry.collectedBy?.toString() || 'owner'
          staffIds.add(collectorId)
          if (!paymentsByEmployee.has(collectorId)) paymentsByEmployee.set(collectorId, new Map())
          allPaymentMethods.add(methodName)
          const empMap = paymentsByEmployee.get(collectorId)!
          empMap.set(methodName, (empMap.get(methodName) || 0) + entry.amount)
          totalDepositsReceived += entry.amount
        } else if (entry.type === 'deposit_refund' && entry.amount < 0) {
          if (staffScopeId && entry.collectedBy?.toString() !== staffScopeId) continue
          if (branchContext && entry.branchId?.toString() !== branchContext.toString()) continue
          const methodName = resolveLedgerMethodName(entry)
          depositRefundsByMethod.set(methodName, (depositRefundsByMethod.get(methodName) || 0) + Math.abs(entry.amount))
        }
      }
    }

    // ── 4. Staff details ──────────────────────────────────────────────────────
    const staffIdsArray = Array.from(staffIds).filter(id => id !== 'owner')
    const staffMap = new Map<string, string>()

    if (staffIdsArray.length > 0) {
      const staff = await conn.db.collection('staff')
        .find({ _id: { $in: staffIdsArray.map(id => new Types.ObjectId(id)) } })
        .toArray()
      staff.forEach((s: any) => {
        const name = s.firstName && s.lastName
          ? `${s.firstName} ${s.lastName}`.trim()
          : s.name || s.email || 'Staff'
        staffMap.set(s._id.toString(), name)
      })
    }

    const owner = await conn.db.collection('users').findOne({ _id: new Types.ObjectId(ownerId) }) as any
    const ownerName = owner?.firstName && owner?.lastName
      ? `${owner.firstName} ${owner.lastName}`.trim()
      : owner?.shopName || owner?.name || owner?.email || 'Owner'
    staffMap.set('owner', ownerName)

    // ── 5. Build payment methods table ───────────────────────────────────────
    const paymentMethodsArray = Array.from(allPaymentMethods).sort()
    const totalsByMethod = new Map<string, number>()
    const employeeBreakdown: any[] = []

    for (const [staffId, payments] of paymentsByEmployee.entries()) {
      const row: any = {
        staffId,
        employeeName: staffMap.get(staffId) || 'Unknown',
        methods: {},
        total: 0,
      }
      for (const method of paymentMethodsArray) {
        const amount = payments.get(method) || 0
        row.methods[method] = amount
        row.total += amount
        totalsByMethod.set(method, (totalsByMethod.get(method) || 0) + amount)
      }
      employeeBreakdown.push(row)
    }

    employeeBreakdown.sort((a, b) => {
      if (a.employeeName === ownerName) return -1
      if (b.employeeName === ownerName) return 1
      return a.employeeName.localeCompare(b.employeeName)
    })

    const grandTotal = Array.from(totalsByMethod.values()).reduce((s, v) => s + v, 0)

    // ── 6. Credit sales (created in period with outstanding balance) ──────────
    const creditSales = sales.filter(s => s.paymentStatus === 'unpaid' || s.paymentStatus === 'partial')
    const totalCreditIssued = creditSales.reduce((s, sale) => s + (sale.debt || 0), 0)
    const creditSalesFormatted = creditSales.map(sale => ({
      _id: sale._id,
      orderNumber: sale.orderNumber,
      customerName: sale.customerName || 'Walk-in',
      total: sale.total,
      amountPaid: sale.amountPaid || 0,
      debt: sale.debt || 0,
      paymentStatus: sale.paymentStatus,
      staffName: sale.staffId ? staffMap.get(sale.staffId.toString()) || 'Staff' : ownerName,
      createdAt: sale.createdAt,
    }))

    // ── 7. Expenses ───────────────────────────────────────────────────────────
    const approvedExpenses = await models.Expense.find({
      userId: ownerId,
      branchId: branchContext,
      status: 'approved',
      paymentDate: { $gte: periodStart, $lte: periodEnd },
      ...(staffScopeId ? { $or: [{ staffId: new Types.ObjectId(staffScopeId) }, { paidBy: new Types.ObjectId(staffScopeId) }] } : {}),
    }).lean()

    const expensesFormatted = approvedExpenses.map((exp: any) => {
      let methodName = ''
      if (exp.paymentMethod === 'cash') methodName = 'Cash'
      else if (exp.paymentMethod === 'mobile_money') methodName = 'M-Pesa'
      else if (exp.paymentMethod === 'bank' && exp.bankProviderName) methodName = exp.bankProviderName
      else if (exp.paymentMethod === 'custom' && exp.customMethodName) methodName = exp.customMethodName
      else methodName = exp.paymentMethod || 'N/A'

      return {
        _id: exp._id,
        title: exp.title,
        category: exp.category || 'Uncategorized',
        amount: exp.amount,
        paymentMethod: methodName,
        paidBy: exp.paidBy ? staffMap.get(exp.paidBy.toString()) || 'Staff' : ownerName,
        paymentDate: exp.paymentDate,
        receiptNumber: exp.receiptNumber || '',
      }
    })

    const totalExpenses = expensesFormatted.reduce((s: number, e: any) => s + e.amount, 0)

    // Expenses by category (useful for period view)
    const expensesByCategory: Record<string, number> = {}
    for (const exp of expensesFormatted) {
      expensesByCategory[exp.category] = (expensesByCategory[exp.category] || 0) + exp.amount
    }

    // Expenses by method (for net calculation)
    const expensesByMethod = new Map<string, number>()
    for (const exp of expensesFormatted) {
      expensesByMethod.set(exp.paymentMethod, (expensesByMethod.get(exp.paymentMethod) || 0) + exp.amount)
    }

    // ── 8. Stock receipts ─────────────────────────────────────────────────────
    const stockReceiptsPeriod = await (models as any).StockReceipt.find({
      userId: ownerId,
      ...(branchContext ? { branchId: branchContext } : {}),
      $or: [
        { paymentStatus: 'paid', paidAt: { $gte: periodStart, $lte: periodEnd }, 'items.0': { $exists: true } },
        { paymentStatus: 'prepaid', paidAt: { $gte: periodStart, $lte: periodEnd } },
      ],
    }).lean()

    const totalStockCashOut = stockReceiptsPeriod.reduce((s: number, r: any) => s + (r.totalCost || 0), 0)
    const stockOutByMethod = new Map<string, number>()
    for (const r of stockReceiptsPeriod) {
      const method = resolveReceiptMethodName(r)
      stockOutByMethod.set(method, (stockOutByMethod.get(method) || 0) + (r.totalCost || 0))
    }

    // Outstanding payables snapshot (current state, not period-scoped)
    const allUnpaid = await (models as any).StockReceipt.find({
      userId: ownerId,
      ...(branchContext ? { branchId: branchContext } : {}),
      paymentStatus: 'unpaid',
    }).select('totalCost').lean()
    const totalOutstandingPayables = allUnpaid.reduce((s: number, r: any) => s + r.totalCost, 0)

    // ── 9. Net by method ──────────────────────────────────────────────────────
    const allOutflowMethods = new Set([
      ...Array.from(totalsByMethod.keys()),
      ...Array.from(expensesByMethod.keys()),
      ...Array.from(stockOutByMethod.keys()),
      ...Array.from(depositRefundsByMethod.keys()),
    ])
    const netByMethod: Record<string, number> = {}
    for (const method of allOutflowMethods) {
      netByMethod[method] =
        (totalsByMethod.get(method) || 0) -
        (expensesByMethod.get(method) || 0) -
        (stockOutByMethod.get(method) || 0) -
        (depositRefundsByMethod.get(method) || 0)
    }

    // ── 10. Sales by day (trend) ──────────────────────────────────────────────
    const salesByDay: Record<string, { date: string; count: number; revenue: number }> = {}
    for (const sale of sales) {
      const d = new Date(sale.createdAt).toISOString().split('T')[0]
      if (!salesByDay[d]) salesByDay[d] = { date: d, count: 0, revenue: 0 }
      salesByDay[d].count += 1
      salesByDay[d].revenue += sale.total || 0
    }

    // Outstanding deposits liability
    const outstandingDepositsAgg = await models.Deposit.aggregate([
      { $match: {
        userId: new Types.ObjectId(ownerId),
        ...(branchContext ? { branchId: new Types.ObjectId(branchContext) } : {}),
        status: { $in: ['active', 'partial'] },
      }},
      { $group: { _id: null, total: { $sum: '$balance' } } },
    ])
    const totalOutstandingDeposits = outstandingDepositsAgg[0]?.total || 0

    const totalSalesAmount = sales.reduce((s: number, sale: any) => s + sale.total, 0)
    const netCash = grandTotal - totalExpenses - totalStockCashOut

    // Net profit = gross profit (revenue − COGS) − operating expenses
    const netProfit = showCost ? grossProfit - totalExpenses : null
    const netProfitMarginPct = (showCost && totalSalesAmount > 0)
      ? parseFloat(((netProfit! / totalSalesAmount) * 100).toFixed(2))
      : null

    const report = {
      branch: { _id: branch._id, name: branch.name },
      period: { startDate: periodStart, endDate: periodEnd },
      generatedAt: new Date(),
      generatedBy: {
        name: staffScopeId ? staffMap.get(staffScopeId) || 'Staff' : ownerName,
        type: payload.type,
      },
      summary: {
        totalSales: sales.length,
        totalSalesAmount,
        totalCollected: grandTotal,
        totalCreditIssued,
        totalCreditPaymentsReceived,
        totalExpenses,
        totalStockCashOut,
        totalDepositsReceived,
        netCash,
        totalOutstandingPayables,
        totalOutstandingDeposits,
        // Profitability (null when caller lacks pos.buying-price permission)
        showCost,
        totalCOGS:          showCost ? totalCOGS : null,
        grossProfit:        showCost ? grossProfit : null,
        grossMarginPct:     showCost ? grossMarginPct : null,
        netProfit,
        netProfitMarginPct,
      },
      paymentMethods: {
        methods: paymentMethodsArray,
        employeeBreakdown,
        totalsByMethod: Object.fromEntries(totalsByMethod),
        grandTotal,
        expensesByMethod: Object.fromEntries(expensesByMethod),
        stockOutByMethod: Object.fromEntries(stockOutByMethod),
        netByMethod,
        depositRefundsByMethod: Object.fromEntries(depositRefundsByMethod),
      },
      creditSales: creditSalesFormatted,
      expensesFormatted,
      expensesByCategory,
      salesByDay: Object.values(salesByDay).sort((a, b) => a.date.localeCompare(b.date)),
    }

    return NextResponse.json({ report })
  } catch (error) {
    console.error('[period-report] GET error:', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}
