'use client'

import { useState, useEffect } from 'react'
import {
  Calendar, Printer, TrendingUp, DollarSign, CreditCard, Receipt,
  User, Wallet, AlertCircle, ChevronDown, ChevronUp, ArrowLeft,
  TrendingDown, Percent,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { PermissionGuard } from '@/components/auth/permission-guard'
import Link from 'next/link'

// ── Types ────────────────────────────────────────────────────────────────────

interface PeriodReport {
  branch: { _id: string; name: string }
  period: { startDate: string; endDate: string }
  generatedAt: string
  generatedBy: { name: string; type: string }
  summary: {
    totalSales: number
    totalSalesAmount: number
    totalCollected: number
    totalCreditIssued: number
    totalCreditPaymentsReceived: number
    totalExpenses: number
    totalStockCashOut: number
    totalDepositsReceived: number
    netCash: number
    totalOutstandingPayables: number
    totalOutstandingDeposits: number
    showCost: boolean
    totalCOGS: number | null
    grossProfit: number | null
    grossMarginPct: number | null
    netProfit: number | null
    netProfitMarginPct: number | null
  }
  paymentMethods: {
    methods: string[]
    employeeBreakdown: {
      staffId: string
      employeeName: string
      methods: Record<string, number>
      total: number
    }[]
    totalsByMethod: Record<string, number>
    grandTotal: number
    expensesByMethod: Record<string, number>
    stockOutByMethod: Record<string, number>
    netByMethod: Record<string, number>
    depositRefundsByMethod: Record<string, number>
  }
  creditSales: {
    _id: string
    orderNumber: string
    customerName: string
    total: number
    amountPaid: number
    debt: number
    paymentStatus: string
    staffName: string
    createdAt: string
  }[]
  expensesFormatted: {
    _id: string
    title: string
    category: string
    amount: number
    paymentMethod: string
    paidBy: string
    paymentDate: string
    receiptNumber: string
  }[]
  expensesByCategory: Record<string, number>
  salesByDay: { date: string; count: number; revenue: number }[]
}

// ── Quick-select presets ──────────────────────────────────────────────────────

function getPresetRange(preset: string): { start: string; end: string } {
  const today = new Date()
  const fmt = (d: Date) => d.toISOString().split('T')[0]

  if (preset === 'this_month') {
    return {
      start: fmt(new Date(today.getFullYear(), today.getMonth(), 1)),
      end: fmt(today),
    }
  }
  if (preset === 'last_month') {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const last = new Date(today.getFullYear(), today.getMonth(), 0)
    return { start: fmt(first), end: fmt(last) }
  }
  if (preset === 'last_7') {
    const start = new Date(today)
    start.setDate(today.getDate() - 6)
    return { start: fmt(start), end: fmt(today) }
  }
  if (preset === 'last_30') {
    const start = new Date(today)
    start.setDate(today.getDate() - 29)
    return { start: fmt(start), end: fmt(today) }
  }
  if (preset === 'this_year') {
    return {
      start: fmt(new Date(today.getFullYear(), 0, 1)),
      end: fmt(today),
    }
  }
  return {
    start: fmt(new Date(today.getFullYear(), today.getMonth(), 1)),
    end: fmt(today),
  }
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function PeriodReportPage() {
  return (
    <PermissionGuard requiredPermission="pos.reports">
      <PeriodReportContent />
    </PermissionGuard>
  )
}

// ── Main content ──────────────────────────────────────────────────────────────

function PeriodReportContent() {
  const { toast } = useToast()

  const defaultRange = getPresetRange('this_month')
  const [startDate, setStartDate] = useState(defaultRange.start)
  const [endDate, setEndDate] = useState(defaultRange.end)
  const [activePreset, setActivePreset] = useState<string>('this_month')
  const [report, setReport] = useState<PeriodReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [expensesExpanded, setExpensesExpanded] = useState(false)
  const [creditExpanded, setCreditExpanded] = useState(false)

  // Print styles
  useEffect(() => {
    const style = document.createElement('style')
    style.innerHTML = `
      @media print {
        body * { visibility: hidden; }
        #period-printable, #period-printable * { visibility: visible; }
        #period-printable { position: absolute; left: 0; top: 0; width: 100%; }
        .print-hide { display: none !important; }
        @page { margin: 1cm; }
        table { page-break-inside: auto; }
        tr { page-break-inside: avoid; page-break-after: auto; }
      }
    `
    document.head.appendChild(style)
    return () => { document.head.removeChild(style) }
  }, [])

  // Auto-fetch on mount
  useEffect(() => { fetchReport() }, [])

  async function fetchReport() {
    setLoading(true)
    try {
      const res = await fetch(`/api/reports/period?startDate=${startDate}&endDate=${endDate}`)
      const data = await res.json()
      if (res.ok) {
        setReport(data.report)
      } else {
        toast({ title: data.error || 'Failed to fetch report', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Failed to fetch report', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  function applyPreset(preset: string) {
    const range = getPresetRange(preset)
    setStartDate(range.start)
    setEndDate(range.end)
    setActivePreset(preset)
  }

  function handleDateChange(field: 'start' | 'end', value: string) {
    if (field === 'start') setStartDate(value)
    else setEndDate(value)
    setActivePreset('custom')
  }

  const formatCurrency = (amount: number) =>
    `KSh ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  const formatDateShort = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

  const presets = [
    { key: 'this_month', label: 'This Month' },
    { key: 'last_month', label: 'Last Month' },
    { key: 'last_7',    label: 'Last 7 days' },
    { key: 'last_30',   label: 'Last 30 days' },
    { key: 'this_year', label: 'This Year' },
  ]

  const getMethodColor = (m: string) => {
    if (m === 'Cash')     return { card: 'bg-gray-50 border-gray-300',   label: 'text-gray-700',   val: 'text-gray-900' }
    if (m === 'M-Pesa')   return { card: 'bg-green-50 border-green-300', label: 'text-green-700',  val: 'text-green-900' }
    if (m.includes('Equity') || m.includes('Bank'))
                          return { card: 'bg-blue-50 border-blue-300',   label: 'text-blue-700',   val: 'text-blue-900' }
    return                       { card: 'bg-purple-50 border-purple-300', label: 'text-purple-700', val: 'text-purple-900' }
  }

  if (loading && !report) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4" />
          <p className="text-muted-foreground">Loading report…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between print-hide">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/reports">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <ArrowLeft size={16} />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">Reports</h1>
            <p className="text-xs text-muted-foreground">Financial summary for selected period</p>
          </div>
        </div>
        <Button
          onClick={() => window.print()}
          variant="outline"
          className="h-9 w-9 p-0"
          disabled={!report}
        >
          <Printer size={16} />
        </Button>
      </div>

      {/* ── Controls ────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border p-3 space-y-3 print-hide">
        {/* Preset chips */}
        <div className="flex flex-wrap gap-2">
          {presets.map(p => (
            <button
              key={p.key}
              onClick={() => applyPreset(p.key)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                activePreset === p.key
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-green-400'
              }`}
            >
              {p.label}
            </button>
          ))}
          {activePreset === 'custom' && (
            <span className="px-3 py-1 rounded-full text-xs font-medium border bg-amber-50 text-amber-700 border-amber-300">
              Custom
            </span>
          )}
        </div>

        {/* Date inputs + generate */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-muted-foreground" />
            <Input
              type="date"
              value={startDate}
              onChange={e => handleDateChange('start', e.target.value)}
              className="w-36 h-8 text-sm"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={endDate}
              onChange={e => handleDateChange('end', e.target.value)}
              className="w-36 h-8 text-sm"
            />
          </div>
          <Button
            onClick={fetchReport}
            disabled={loading}
            className="bg-green-600 hover:bg-green-700 h-8 text-sm"
          >
            {loading ? 'Loading…' : 'Generate'}
          </Button>
        </div>
      </div>

      {/* ── Empty state ──────────────────────────────────────────────────────── */}
      {!report && !loading && (
        <div className="text-center py-12 text-muted-foreground">
          Select a date range and click Generate
        </div>
      )}

      {/* ── Report body ──────────────────────────────────────────────────────── */}
      {report && (
        <div id="period-printable" className="space-y-4">

          {/* Report header */}
          <div className="bg-white rounded-lg border p-3">
            <div className="text-center mb-2">
              <h2 className="text-xl font-bold text-green-700">Financial Report</h2>
              <p className="text-sm font-medium">{report.branch.name}</p>
            </div>
            <div className="flex justify-between text-xs border-t pt-2">
              <div>
                <p className="text-muted-foreground">Period</p>
                <p className="font-medium">{formatDate(report.period.startDate)} – {formatDate(report.period.endDate)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Generated</p>
                <p className="font-medium">{formatDate(report.generatedAt)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Generated By</p>
                <p className="font-medium">{report.generatedBy.name}</p>
              </div>
            </div>
          </div>

          {/* ── Profitability panel ─────────────────────────────────────────── */}
          {report.summary.showCost && report.summary.grossProfit !== null && (
            <div className={`rounded-lg border-2 p-4 ${
              (report.summary.netProfit ?? 0) >= 0
                ? 'bg-green-50 border-green-300'
                : 'bg-red-50 border-red-300'
            }`}>
              <div className="flex items-center gap-2 mb-3">
                {(report.summary.netProfit ?? 0) >= 0
                  ? <TrendingUp size={18} className="text-green-700" />
                  : <TrendingDown size={18} className="text-red-700" />
                }
                <h3 className={`text-sm font-bold ${
                  (report.summary.netProfit ?? 0) >= 0 ? 'text-green-900' : 'text-red-900'
                }`}>
                  {(report.summary.netProfit ?? 0) >= 0 ? 'Profit' : 'Loss'} Summary
                </h3>
              </div>

              {/* P&L waterfall */}
              <div className="space-y-1 text-sm">
                <div className="flex items-center justify-between py-1">
                  <span className="text-gray-700">Revenue</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(report.summary.totalSalesAmount)}</span>
                </div>
                <div className="flex items-center justify-between py-1 text-red-700">
                  <span>Cost of Goods Sold</span>
                  <span className="font-semibold">− {formatCurrency(report.summary.totalCOGS ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-t border-gray-300 font-semibold">
                  <span className="text-gray-800">Gross Profit</span>
                  <span className={report.summary.grossProfit >= 0 ? 'text-green-700' : 'text-red-700'}>
                    {formatCurrency(report.summary.grossProfit)}
                    <span className="text-xs font-normal ml-1 opacity-70">
                      ({report.summary.grossMarginPct}%)
                    </span>
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 text-red-700">
                  <span>Operating Expenses</span>
                  <span className="font-semibold">− {formatCurrency(report.summary.totalExpenses)}</span>
                </div>
                <div className={`flex items-center justify-between py-2 px-3 rounded-lg mt-1 ${
                  (report.summary.netProfit ?? 0) >= 0
                    ? 'bg-green-100 border border-green-300'
                    : 'bg-red-100 border border-red-300'
                }`}>
                  <span className={`font-bold text-base ${
                    (report.summary.netProfit ?? 0) >= 0 ? 'text-green-900' : 'text-red-900'
                  }`}>Net {(report.summary.netProfit ?? 0) >= 0 ? 'Profit' : 'Loss'}</span>
                  <div className="text-right">
                    <span className={`font-bold text-lg ${
                      (report.summary.netProfit ?? 0) >= 0 ? 'text-green-900' : 'text-red-900'
                    }`}>{formatCurrency(Math.abs(report.summary.netProfit ?? 0))}</span>
                    {report.summary.netProfitMarginPct !== null && (
                      <div className="flex items-center gap-1 justify-end">
                        <Percent size={10} className="opacity-60" />
                        <span className="text-xs opacity-70">{Math.abs(report.summary.netProfitMarginPct)}% margin</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp size={16} className="text-blue-600" />
                <p className="text-xs text-blue-700 font-medium">Total Sales</p>
              </div>
              <p className="text-xl font-bold text-blue-900">{report.summary.totalSales}</p>
              <p className="text-xs text-blue-600">{formatCurrency(report.summary.totalSalesAmount)}</p>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign size={16} className="text-green-600" />
                <p className="text-xs text-green-700 font-medium">Total Collected</p>
              </div>
              <p className="text-xl font-bold text-green-900">{formatCurrency(report.summary.totalCollected)}</p>
              <p className="text-xs text-green-600">Inc. credit payments</p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <CreditCard size={16} className="text-amber-600" />
                <p className="text-xs text-amber-700 font-medium">Credit Issued</p>
              </div>
              <p className="text-xl font-bold text-amber-900">{formatCurrency(report.summary.totalCreditIssued)}</p>
              <p className="text-xs text-amber-600">{report.creditSales.length} sales</p>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Receipt size={16} className="text-red-600" />
                <p className="text-xs text-red-700 font-medium">Expenses</p>
              </div>
              <p className="text-xl font-bold text-red-900">{formatCurrency(report.summary.totalExpenses)}</p>
              <p className="text-xs text-red-600">{report.expensesFormatted.length} items</p>
            </div>
          </div>

          {/* Secondary summary row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-teal-50 border border-teal-200 rounded-lg p-3">
              <p className="text-xs text-teal-700 font-medium mb-1">Deposits Received</p>
              <p className="text-lg font-bold text-teal-900">{formatCurrency(report.summary.totalDepositsReceived)}</p>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
              <p className="text-xs text-orange-700 font-medium mb-1">Stock Cash Out</p>
              <p className="text-lg font-bold text-orange-900">{formatCurrency(report.summary.totalStockCashOut)}</p>
            </div>
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
              <p className="text-xs text-indigo-700 font-medium mb-1">Credit Recovered</p>
              <p className="text-lg font-bold text-indigo-900">{formatCurrency(report.summary.totalCreditPaymentsReceived)}</p>
            </div>
            <div className={`border rounded-lg p-3 ${report.summary.netCash >= 0 ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
              <p className={`text-xs font-medium mb-1 ${report.summary.netCash >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                Net Cash Position
              </p>
              <p className={`text-lg font-bold ${report.summary.netCash >= 0 ? 'text-green-900' : 'text-red-900'}`}>
                {formatCurrency(report.summary.netCash)}
              </p>
            </div>
          </div>

          {/* Payment methods summary */}
          <div className="bg-white rounded-lg border p-3">
            <h3 className="text-xs font-semibold text-gray-700 mb-2">Payment Methods Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              {Array.from(new Set([
                ...report.paymentMethods.methods.filter(m => m.toLowerCase() !== 'credit'),
                ...Object.keys(report.paymentMethods.expensesByMethod || {}),
                ...Object.keys(report.paymentMethods.stockOutByMethod || {}),
              ])).sort().map(method => {
                const collected = report.paymentMethods.totalsByMethod[method] || 0
                const expenses  = (report.paymentMethods.expensesByMethod || {})[method] || 0
                const stockOut  = (report.paymentMethods.stockOutByMethod || {})[method] || 0
                const net       = (report.paymentMethods.netByMethod || {})[method] ?? (collected - expenses - stockOut)
                const hasOutflow = expenses > 0 || stockOut > 0
                const colors = getMethodColor(method)

                return (
                  <div key={method} className={`${colors.card} border rounded p-2`}>
                    <p className={`text-xs font-semibold mb-1 ${colors.label}`}>{method}</p>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="text-muted-foreground">Collected</span>
                      <span className="font-medium">{formatCurrency(collected)}</span>
                    </div>
                    {expenses > 0 && (
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-red-600">Expenses</span>
                        <span className="text-red-600 font-medium">− {formatCurrency(expenses)}</span>
                      </div>
                    )}
                    {stockOut > 0 && (
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-red-600">Stock Out</span>
                        <span className="text-red-600 font-medium">− {formatCurrency(stockOut)}</span>
                      </div>
                    )}
                    {hasOutflow && <div className="border-t border-current opacity-20 my-1" />}
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-semibold ${colors.label}`}>{hasOutflow ? 'Net' : ''}</span>
                      <span className={`text-base font-bold ${net >= 0 ? colors.val : 'text-red-700'}`}>
                        {formatCurrency(net)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Payment collection by employee */}
          {report.paymentMethods.employeeBreakdown.length > 0 && (
            <div className="bg-white rounded-lg border p-3">
              <h3 className="text-sm font-semibold mb-3 text-green-700">Payment Collection by Employee</h3>
              <div className="space-y-2">
                {report.paymentMethods.employeeBreakdown.map(emp => {
                  const totalExcludingCredit = report.paymentMethods.methods
                    .filter(m => m.toLowerCase() !== 'credit')
                    .reduce((sum, m) => sum + (emp.methods[m] || 0), 0)
                  return (
                    <div key={emp.staffId} className="border rounded p-2 hover:bg-accent/50 transition-colors">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <User size={14} className="text-muted-foreground" />
                          <span className="font-medium text-sm">{emp.employeeName}</span>
                        </div>
                        <span className="font-bold text-sm text-green-700">{formatCurrency(totalExcludingCredit)}</span>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {report.paymentMethods.methods
                          .filter(m => m.toLowerCase() !== 'credit')
                          .filter(m => emp.methods[m] && emp.methods[m] > 0)
                          .map(m => (
                            <span key={m} className="bg-muted px-2 py-0.5 rounded">
                              {m}: <strong>{formatCurrency(emp.methods[m])}</strong>
                            </span>
                          ))}
                      </div>
                    </div>
                  )
                })}

                {/* Grand total row */}
                <div className="border-2 border-green-200 bg-green-50 rounded p-2 mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm">Grand Total Collected</span>
                    <span className="font-bold text-base text-green-700">
                      {formatCurrency(
                        report.paymentMethods.methods
                          .filter(m => m.toLowerCase() !== 'credit')
                          .reduce((s, m) => s + (report.paymentMethods.totalsByMethod[m] || 0), 0)
                      )}
                    </span>
                  </div>
                  {(report.summary.totalExpenses > 0 || report.summary.totalStockCashOut > 0) && (
                    <>
                      {report.summary.totalExpenses > 0 && (
                        <div className="flex items-center justify-between text-xs text-red-600 mb-0.5">
                          <span>Less: Expenses</span>
                          <span className="font-medium">− {formatCurrency(report.summary.totalExpenses)}</span>
                        </div>
                      )}
                      {report.summary.totalStockCashOut > 0 && (
                        <div className="flex items-center justify-between text-xs text-red-600 mb-0.5">
                          <span>Less: Stock Cash Out</span>
                          <span className="font-medium">− {formatCurrency(report.summary.totalStockCashOut)}</span>
                        </div>
                      )}
                      <div className="border-t border-green-300 mt-1 pt-1 flex items-center justify-between">
                        <span className="font-bold text-sm">Net Cash Position</span>
                        <span className={`font-bold text-base ${report.summary.netCash >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                          {formatCurrency(report.summary.netCash)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Daily trend */}
          {report.salesByDay.length > 1 && (
            <div className="bg-white rounded-lg border p-3">
              <h3 className="text-sm font-semibold mb-3 text-gray-700">Daily Sales Trend</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1 pr-3 text-muted-foreground font-medium">Date</th>
                      <th className="text-right py-1 pr-3 text-muted-foreground font-medium">Sales</th>
                      <th className="text-right py-1 text-muted-foreground font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.salesByDay.map(day => (
                      <tr key={day.date} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-1 pr-3 font-medium">{formatDateShort(day.date)}</td>
                        <td className="py-1 pr-3 text-right">{day.count}</td>
                        <td className="py-1 text-right font-semibold text-green-700">{formatCurrency(day.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-green-200 bg-green-50/50">
                      <td className="py-1 pr-3 font-bold text-sm">Total</td>
                      <td className="py-1 pr-3 text-right font-bold">{report.summary.totalSales}</td>
                      <td className="py-1 text-right font-bold text-green-700">{formatCurrency(report.summary.totalSalesAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Expenses by category */}
          {Object.keys(report.expensesByCategory).length > 0 && (
            <div className="bg-white rounded-lg border p-3">
              <button
                className="w-full flex items-center justify-between print-hide"
                onClick={() => setExpensesExpanded(v => !v)}
              >
                <h3 className="text-sm font-semibold text-red-700">
                  Expenses by Category — {formatCurrency(report.summary.totalExpenses)}
                </h3>
                {expensesExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {/* Always show in print */}
              <div className={expensesExpanded ? 'mt-3' : 'hidden print:block mt-3'}>
                {/* Category totals */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                  {Object.entries(report.expensesByCategory)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cat, total]) => (
                      <div key={cat} className="border border-red-200 rounded p-2 bg-red-50/30">
                        <p className="text-xs text-muted-foreground truncate">{cat}</p>
                        <p className="font-bold text-sm text-red-700">{formatCurrency(total)}</p>
                      </div>
                    ))}
                </div>
                {/* Detail rows */}
                <div className="space-y-1">
                  {report.expensesFormatted.map(exp => (
                    <div key={String(exp._id)} className="border border-red-100 rounded p-2 text-xs flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{exp.title}</p>
                        <p className="text-muted-foreground">{exp.category} · {exp.paymentMethod} · {exp.paidBy}</p>
                      </div>
                      <p className="font-bold text-red-700 flex-shrink-0">{formatCurrency(exp.amount)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Credit sales */}
          {report.creditSales.length > 0 && (
            <div className="bg-white rounded-lg border p-3">
              <button
                className="w-full flex items-center justify-between print-hide"
                onClick={() => setCreditExpanded(v => !v)}
              >
                <h3 className="text-sm font-semibold text-amber-700">
                  Credit Sales ({report.creditSales.length}) — Outstanding: {formatCurrency(report.summary.totalCreditIssued)}
                </h3>
                {creditExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              <div className={creditExpanded ? 'mt-3 space-y-2' : 'hidden print:block mt-3 space-y-2'}>
                {report.creditSales.map(sale => (
                  <div key={String(sale._id)} className="border border-amber-200 rounded p-2 bg-amber-50/30">
                    <div className="flex items-start justify-between mb-1">
                      <div>
                        <p className="font-medium text-sm">{sale.customerName}</p>
                        <p className="text-xs text-muted-foreground">#{sale.orderNumber} · {formatDate(sale.createdAt)}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        sale.paymentStatus === 'unpaid'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>{sale.paymentStatus}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div><p className="text-muted-foreground">Total</p><p className="font-semibold">{formatCurrency(sale.total)}</p></div>
                      <div><p className="text-muted-foreground">Paid</p><p className="font-semibold">{formatCurrency(sale.amountPaid)}</p></div>
                      <div><p className="text-muted-foreground">Outstanding</p><p className="font-bold text-amber-700">{formatCurrency(sale.debt)}</p></div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Sold by: {sale.staffName}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Outstanding balances footer */}
          {(report.summary.totalOutstandingPayables > 0 || report.summary.totalOutstandingDeposits > 0) && (
            <div className="bg-white rounded-lg border p-3">
              <h3 className="text-xs font-semibold text-gray-700 mb-2">Current Outstanding Balances</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {report.summary.totalOutstandingPayables > 0 && (
                  <div className="flex items-center gap-2 border rounded p-2 bg-orange-50">
                    <AlertCircle size={14} className="text-orange-600 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-orange-700 font-medium">You Owe Suppliers</p>
                      <p className="font-bold text-orange-900">{formatCurrency(report.summary.totalOutstandingPayables)}</p>
                    </div>
                  </div>
                )}
                {report.summary.totalOutstandingDeposits > 0 && (
                  <div className="flex items-center gap-2 border rounded p-2 bg-teal-50">
                    <Wallet size={14} className="text-teal-600 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-teal-700 font-medium">Customer Deposits Held</p>
                      <p className="font-bold text-teal-900">{formatCurrency(report.summary.totalOutstandingDeposits)}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
