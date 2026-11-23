'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, User, Phone, Mail, CreditCard, ChevronDown, ChevronUp,
  MessageCircle, ShoppingBag, Edit2, Store, Banknote, Wallet, AlertCircle,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { LoadingOrOffline } from '@/components/offline-indicator'
import { PermissionGuard } from '@/components/auth/permission-guard'
import { DepositDialog } from '@/components/deposits/deposit-dialog'
import { CustomerDepositsDialog } from '@/components/deposits/customer-deposits-dialog'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Customer {
  _id: string
  name: string
  phone?: string
  email?: string
  idNumber?: string
  creditBalance: number
  creditLimit: number
  depositBalance: number
  createdAt: string
}

interface SaleItem {
  productName: string
  quantity: number
  price: number
  discount?: number
}

interface Sale {
  _id: string
  orderNumber: string
  createdAt: string
  total: number
  subtotal?: number
  discount?: number
  debt?: number
  paymentStatus: 'paid' | 'partial' | 'unpaid'
  paymentMethod?: string
  payments?: Array<{
    method: string
    amount: number
    bankProviderName?: string
    customMethodName?: string
  }>
  items: SaleItem[]
  staffId?: {
    _id: string
    name?: string
    firstName?: string
    lastName?: string
    isOwner?: boolean
  }
  branchId?: string
  branchName?: string
  returns?: Array<{ productName: string; quantity: number }>
}

// Allocation row in the payment dialog
interface AllocRow {
  saleId: string
  orderNumber: string
  orderDate: string
  currentDebt: number  // what the sale currently owes
  amount: string       // what the cashier types (string to allow empty input)
}

type HistoryFilter = 'all' | 'unsettled' | 'paid'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtKES(n: number) {
  return `KES ${Math.round(n).toLocaleString('en-KE')}`
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
function formatPhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '')
  if (cleaned.startsWith('0')) cleaned = '254' + cleaned.slice(1)
  else if (!cleaned.startsWith('254')) cleaned = '254' + cleaned
  return cleaned
}
function resolveStaffName(staffId: Sale['staffId']): string {
  if (!staffId) return 'Unknown'
  if (staffId.isOwner) return staffId.name || 'Owner'
  const full = [staffId.firstName, staffId.lastName].filter(Boolean).join(' ')
  return full || staffId.name || 'Staff'
}
function resolvePaymentLabel(sale: Sale): string {
  if (sale.payments && sale.payments.length > 0) {
    const labels = sale.payments.map(p => {
      if (p.method === 'cash') return 'Cash'
      if (p.method === 'mobile_money') return 'M-Pesa'
      if (p.method === 'card') return 'Card'
      if (p.method === 'credit') return 'Credit'
      if (p.method === 'bank') return p.bankProviderName || 'Bank'
      if (p.method === 'custom') return p.customMethodName || 'Custom'
      if (p.method === 'deposit') return 'Store Credit'
      return p.method
    })
    return [...new Set(labels)].join(' + ')
  }
  if (!sale.paymentMethod) return '—'
  if (sale.paymentMethod === 'cash') return 'Cash'
  if (sale.paymentMethod === 'mobile_money') return 'M-Pesa'
  if (sale.paymentMethod === 'card') return 'Card'
  if (sale.paymentMethod === 'credit') return 'Credit'
  return sale.paymentMethod
}

// Phase 3: use paymentStatus directly — sale.debt is now live after Phase 1
function settlementStatus(sale: Sale): 'settled' | 'partial' | 'unpaid' {
  if (sale.paymentStatus === 'paid')    return 'settled'
  if (sale.paymentStatus === 'partial') return 'partial'
  return 'unpaid'
}
function settlementBadgeClass(s: ReturnType<typeof settlementStatus>) {
  if (s === 'settled') return 'bg-green-50 text-green-700 border-green-200'
  if (s === 'partial') return 'bg-amber-50 text-amber-700 border-amber-200'
  return 'bg-red-50 text-red-600 border-red-200'
}
function settlementLabel(s: ReturnType<typeof settlementStatus>) {
  if (s === 'settled') return 'Settled'
  if (s === 'partial') return 'Partial'
  return 'Unpaid'
}

// Remaining balance on a sale — now reads live sale.debt
function saleBalance(sale: Sale): number {
  if (sale.paymentStatus === 'paid') return 0
  return sale.debt ?? sale.total
}

function buildAccountWhatsApp(customer: Customer, shopName: string): string {
  return [
    `Hello ${customer.name},`,
    '',
    `Thank you for your business with ${shopName}!`,
    '',
    customer.creditBalance > 0
      ? [
          `Outstanding Balance: KES ${customer.creditBalance.toLocaleString()}`,
          customer.creditLimit > 0 ? `Credit Limit: KES ${customer.creditLimit.toLocaleString()}` : '',
          '',
          'Please contact us to settle your outstanding balance.',
        ].filter(Boolean).join('\n')
      : 'Your account is in good standing. Thank you for your prompt payments!',
    '',
    `Thank you for choosing ${shopName}!`,
  ].join('\n')
}

function buildOrderWhatsApp(sale: Sale, customer: Customer, shopName: string): string {
  const lines = [
    `Hello ${customer.name},`,
    '',
    `Here is your receipt from ${shopName}:`,
    '',
    `Order: ${sale.orderNumber}`,
    `Date:  ${fmtDate(sale.createdAt)} at ${fmtTime(sale.createdAt)}`,
    '',
    '— Items —',
    ...sale.items.map(i => {
      const disc = i.discount || 0
      const lineTotal = (i.price - disc) * i.quantity
      return disc > 0
        ? `${i.productName} ×${i.quantity}  KES ${lineTotal.toLocaleString()} (disc -KES ${disc.toLocaleString()})`
        : `${i.productName} ×${i.quantity}  KES ${lineTotal.toLocaleString()}`
    }),
    '',
    `Total: KES ${sale.total.toLocaleString()}`,
    `Payment: ${resolvePaymentLabel(sale)}`,
  ]
  const bal = saleBalance(sale)
  if (bal > 0) lines.push(`Balance Due: KES ${bal.toLocaleString()}`)
  lines.push('', 'Thank you for your business!')
  return lines.join('\n')
}

// ── Page wrapper ──────────────────────────────────────────────────────────────

export default function CustomerDetailPage() {
  return (
    <PermissionGuard requiredPermission="core.customers">
      <CustomerDetailContent />
    </PermissionGuard>
  )
}

// ── Main content ──────────────────────────────────────────────────────────────

function CustomerDetailContent() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()

  // ── Data ──────────────────────────────────────────────────────────────────
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [isOffline, setIsOffline] = useState(false)

  // ── Support data ──────────────────────────────────────────────────────────
  const [shopSettings, setShopSettings] = useState<any>(null)
  const [bankProviders, setBankProviders] = useState<Array<{ _id: string; name: string }>>([])
  const [customMethods, setCustomMethods] = useState<Array<{ _id: string; name: string }>>([])
  const [currentUser, setCurrentUser] = useState<any>(null)
  const isOwner       = currentUser?.type === 'user'
  const canTakeDeposits   = isOwner || !!currentUser?.permissions?.['pos.deposits.take']
  const canRefundDeposits = isOwner || !!currentUser?.permissions?.['pos.deposits.refund']

  // ── UI state ──────────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState<string | null>(null)
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')

  // ── Payment dialog (Phase 2 — allocation UI) ──────────────────────────────
  const [showPay, setShowPay] = useState(false)
  const [payMethod, setPayMethod]           = useState('cash')
  const [payMpesaCode, setPayMpesaCode]     = useState('')
  const [payMpesaPhone, setPayMpesaPhone]   = useState('')
  const [payBankId, setPayBankId]           = useState('')
  const [payCustomId, setPayCustomId]       = useState('')
  const [payNote, setPayNote]               = useState('')
  const [payReceived, setPayReceived]       = useState('')  // total cash received
  const [allocRows, setAllocRows]           = useState<AllocRow[]>([])
  const [paying, setPaying]                 = useState(false)

  // ── Edit dialog ───────────────────────────────────────────────────────────
  const [showEdit, setShowEdit]         = useState(false)
  const [editName, setEditName]         = useState('')
  const [editPhone, setEditPhone]       = useState('')
  const [editEmail, setEditEmail]       = useState('')
  const [editIdNumber, setEditIdNumber] = useState('')
  const [editCreditLimit, setEditCreditLimit] = useState('')
  const [editing, setEditing]           = useState(false)

  // ── Deposit dialogs ───────────────────────────────────────────────────────
  const [showDeposit, setShowDeposit]           = useState(false)
  const [showDepositsDialog, setShowDepositsDialog] = useState(false)

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => { load(); loadSupport() }, [id])

  // Open pay dialog if navigated here with ?action=pay (Phase 4)
  useEffect(() => {
    if (searchParams.get('action') === 'pay' && customer && sales.length > 0) {
      openPay()
      // Remove the query param so back-navigation doesn't re-open
      router.replace(`/dashboard/customers/${id}`)
    }
  }, [searchParams, customer, sales])

  async function load() {
    setLoading(true)
    setIsOffline(false)
    try {
      const [custRes, salesRes] = await Promise.all([
        fetch(`/api/customers/${id}`),
        fetch(`/api/sales?customerId=${id}`),
      ])
      if (!custRes.ok) {
        if (custRes.status === 404) { toast.error('Customer not found'); router.push('/dashboard/customers'); return }
        throw new Error('failed')
      }
      setCustomer((await custRes.json()).customer)
      if (salesRes.ok) setSales((await salesRes.json()).sales || [])
    } catch (err: any) {
      if (err?.name === 'TypeError') setIsOffline(true)
      else toast.error('Failed to load customer details')
    }
    setLoading(false)
  }

  async function loadSupport() {
    try {
      const [sRes, bRes, mRes, meRes] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/bank-providers'),
        fetch('/api/payment-methods'),
        fetch('/api/auth/me'),
      ])
      if (sRes.ok)  setShopSettings((await sRes.json()).settings || {})
      if (bRes.ok)  setBankProviders((await bRes.json()).providers || [])
      if (mRes.ok)  setCustomMethods((await mRes.json()).methods || [])
      if (meRes.ok) setCurrentUser((await meRes.json()).user || null)
    } catch {}
  }

  // ── Payment dialog — open ─────────────────────────────────────────────────
  function openPay() {
    if (!customer) return
    // Build allocation rows from unsettled sales, sorted oldest first
    const unsettled = [...sales]
      .filter(s => s.paymentStatus !== 'paid')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    setAllocRows(unsettled.map(s => ({
      saleId: s._id,
      orderNumber: s.orderNumber,
      orderDate: s.createdAt,
      currentDebt: saleBalance(s),
      amount: '',
    })))

    setPayMethod('cash')
    setPayMpesaCode(''); setPayMpesaPhone(''); setPayBankId(''); setPayCustomId('')
    setPayNote('')
    setPayReceived('')
    setShowPay(true)
  }

  // ── Payment dialog — allocation helpers ───────────────────────────────────
  const allocTotal = useMemo(
    () => allocRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0),
    [allocRows]
  )
  const payReceivedNum = parseFloat(payReceived) || 0
  const unallocated    = Math.round((payReceivedNum - allocTotal) * 100) / 100
  const canSubmitPay   = payReceivedNum > 0 && Math.abs(unallocated) <= 0.01 && allocRows.some(r => (parseFloat(r.amount) || 0) > 0)

  function setAllocAmount(saleId: string, value: string) {
    setAllocRows(prev => prev.map(r => r.saleId === saleId ? { ...r, amount: value } : r))
  }

  // ── Payment dialog — submit ───────────────────────────────────────────────
  async function recordPayment() {
    if (!customer || payReceivedNum <= 0) { toast.error('Enter amount received'); return }
    if (!payMethod) { toast.error('Select a payment method'); return }
    if (payMethod === 'bank' && !payBankId) { toast.error('Select a bank provider'); return }
    if (!canSubmitPay) { toast.error('Allocated amount must equal amount received'); return }

    const isCustom   = payMethod.startsWith('custom:')
    const actualMethod = isCustom ? 'custom' : payMethod
    const customMethodId   = isCustom ? payMethod.split(':')[1] : ''
    const customMethodName = customMethodId ? customMethods.find(m => m._id === customMethodId)?.name || '' : ''
    const bankProviderName = payBankId ? bankProviders.find(b => b._id === payBankId)?.name || '' : ''

    const activeAllocs = allocRows
      .filter(r => (parseFloat(r.amount) || 0) > 0)
      .map(r => ({ saleId: r.saleId, amount: parseFloat(r.amount) }))

    const payload: any = {
      amount: payReceivedNum,
      paymentMethod: actualMethod,
      note: payNote || undefined,
      allocations: activeAllocs,
    }
    if (actualMethod === 'mobile_money') { payload.mpesaCode = payMpesaCode; payload.mpesaPhone = payMpesaPhone }
    if (actualMethod === 'bank')   { payload.bankProviderId = payBankId; payload.bankProviderName = bankProviderName }
    if (actualMethod === 'custom') { payload.customMethodId = customMethodId; payload.customMethodName = customMethodName }

    setPaying(true)
    try {
      const res = await fetch(`/api/customers/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        toast.success('Payment recorded')
        setShowPay(false)
        load()
      } else {
        toast.error((await res.json()).error || 'Failed to record payment')
      }
    } catch { toast.error('Failed to record payment') }
    setPaying(false)
  }

  // ── Edit ──────────────────────────────────────────────────────────────────
  function openEdit() {
    if (!customer) return
    setEditName(customer.name); setEditPhone(customer.phone || '')
    setEditEmail(customer.email || ''); setEditIdNumber(customer.idNumber || '')
    setEditCreditLimit(String(customer.creditLimit))
    setShowEdit(true)
  }
  async function updateCustomer() {
    if (!editName.trim()) { toast.error('Name is required'); return }
    setEditing(true)
    try {
      const res = await fetch(`/api/customers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, phone: editPhone, email: editEmail, idNumber: editIdNumber, creditLimit: parseFloat(editCreditLimit) || 0 }),
      })
      if (res.ok) { toast.success('Customer updated'); setShowEdit(false); load() }
      else toast.error((await res.json()).error || 'Failed to update customer')
    } catch { toast.error('Failed to update customer') }
    setEditing(false)
  }

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  function sendAccountWhatsApp() {
    if (!customer?.phone) { toast.error('No phone number for this customer'); return }
    const phone = formatPhone(customer.phone)
    if (phone.length < 12) { toast.error('Invalid phone number format'); return }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(buildAccountWhatsApp(customer, shopSettings?.general?.shopName || 'Our Business'))}`, '_blank')
    toast.success('Opening WhatsApp…')
  }
  function sendOrderWhatsApp(sale: Sale) {
    if (!customer?.phone) { toast.error('No phone number for this customer'); return }
    const phone = formatPhone(customer.phone)
    if (phone.length < 12) { toast.error('Invalid phone number format'); return }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(buildOrderWhatsApp(sale, customer, shopSettings?.general?.shopName || 'Our Business'))}`, '_blank')
    toast.success('Opening WhatsApp…')
  }

  // ── Derived stats (Phase 3) ───────────────────────────────────────────────
  const totalBilled  = useMemo(() => sales.reduce((s, sale) => s + sale.total, 0), [sales])
  const totalPaid    = useMemo(() => sales.reduce((s, sale) => s + (sale.total - saleBalance(sale)), 0), [sales])
  const outstanding  = customer?.creditBalance ?? 0

  // Phase 3: filter uses paymentStatus directly
  const filteredSales = useMemo(() => {
    if (historyFilter === 'all')       return sales
    if (historyFilter === 'unsettled') return sales.filter(s => s.paymentStatus !== 'paid')
    return sales.filter(s => s.paymentStatus === 'paid')
  }, [sales, historyFilter])

  const shopName = shopSettings?.general?.shopName || shopSettings?.shopName || ''

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      <button
        onClick={() => router.push('/dashboard/customers')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft size={15} /> Back to Customers
      </button>

      <LoadingOrOffline isLoading={loading} isOffline={isOffline} onRetry={load}
        loadingText="Loading customer…"
        offlineMessage="Unable to load customer details. Check your connection."
      >
        {customer && (
          <div className="space-y-4">

            {/* ── Header card ─────────────────────────────────────────────── */}
            <div className={`bg-white rounded-lg border overflow-hidden ${
              customer.creditBalance > 0 ? 'border-red-200' : customer.depositBalance > 0 ? 'border-teal-200' : 'border-gray-200'
            }`}>
              <div className="flex items-center gap-3 px-4 py-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  customer.creditBalance > 0 ? 'bg-red-100' : customer.depositBalance > 0 ? 'bg-teal-100' : 'bg-gray-100'
                }`}>
                  <User size={18} className={customer.creditBalance > 0 ? 'text-red-500' : customer.depositBalance > 0 ? 'text-teal-600' : 'text-gray-500'} />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-bold text-base text-gray-900">{customer.name}</p>
                  <div className="flex flex-wrap items-center gap-3 mt-0.5">
                    {customer.phone && (
                      <a href={`tel:${customer.phone}`} className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 transition-colors">
                        <Phone size={10} />{customer.phone}
                      </a>
                    )}
                    {customer.email && (
                      <span className="flex items-center gap-1 text-xs text-gray-400 truncate max-w-[180px]">
                        <Mail size={10} />{customer.email}
                      </span>
                    )}
                    {customer.idNumber && <span className="text-xs text-gray-400">ID: {customer.idNumber}</span>}
                  </div>
                </div>

                <div className="flex flex-col gap-1 items-end shrink-0">
                  {customer.creditBalance > 0
                    ? <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-2 py-0.5 whitespace-nowrap">Owes {fmtKES(customer.creditBalance)}</span>
                    : <span className="text-xs font-medium text-green-600 bg-green-50 border border-green-200 rounded px-2 py-0.5">Clear</span>
                  }
                  {customer.depositBalance > 0 && (
                    <button onClick={() => setShowDepositsDialog(true)}
                      className="text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 rounded px-2 py-0.5 whitespace-nowrap hover:bg-teal-100 transition-colors">
                      +{fmtKES(customer.depositBalance)} deposit
                    </button>
                  )}
                </div>

                <button onClick={openEdit} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors shrink-0" title="Edit customer">
                  <Edit2 size={15} />
                </button>
              </div>

              {/* Action bar */}
              <div className="flex flex-wrap gap-2 px-4 pb-3 pt-0">
                {customer.creditBalance > 0 && (
                  <button onClick={openPay}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors">
                    <Banknote size={13} /> Record Payment
                  </button>
                )}
                {canTakeDeposits && (
                  <button onClick={() => setShowDeposit(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-teal-300 bg-teal-50 hover:bg-teal-100 text-teal-700 transition-colors">
                    <Wallet size={13} /> Take Deposit
                  </button>
                )}
                {customer.depositBalance > 0 && (
                  <button onClick={() => setShowDepositsDialog(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-teal-200 bg-white hover:bg-teal-50 text-teal-600 transition-colors">
                    <CreditCard size={13} /> Manage Deposits
                  </button>
                )}
                {customer.phone && (
                  <button onClick={sendAccountWhatsApp}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors">
                    <MessageCircle size={13} /> WhatsApp
                  </button>
                )}
                {customer.creditLimit > 0 && (
                  <span className="flex items-center px-3 py-1.5 text-xs text-gray-400 border border-gray-100 rounded-lg bg-gray-50">
                    Credit limit: {fmtKES(customer.creditLimit)}
                  </span>
                )}
              </div>
            </div>

            {/* ── Summary strip ────────────────────────────────────────────── */}
            <div className="flex flex-wrap gap-3">
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 min-w-[110px]">
                <p className="text-xs text-blue-600 font-medium">Total Billed</p>
                <p className="text-base font-bold text-blue-900">{fmtKES(totalBilled)}</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 min-w-[110px]">
                <p className="text-xs text-green-600 font-medium">Total Paid</p>
                <p className="text-base font-bold text-green-900">{fmtKES(totalPaid)}</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 min-w-[80px]">
                <p className="text-xs text-gray-500 font-medium">Orders</p>
                <p className="text-base font-bold text-gray-800">{sales.length}</p>
              </div>
              {outstanding > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 min-w-[110px]">
                  <p className="text-xs text-red-500 font-medium">Outstanding</p>
                  <p className="text-base font-bold text-red-700">{fmtKES(outstanding)}</p>
                </div>
              )}
            </div>

            {/* ── Purchase history ─────────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
                <h2 className="text-sm font-semibold text-gray-700">Purchase History</h2>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
                  {(['all', 'unsettled', 'paid'] as HistoryFilter[]).map(f => (
                    <button key={f} onClick={() => setHistoryFilter(f)}
                      className={`px-3 py-1.5 transition-colors ${historyFilter === f ? 'bg-gray-800 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                      {f === 'unsettled' ? 'Unsettled' : f === 'paid' ? 'Settled' : 'All'}
                    </button>
                  ))}
                </div>
              </div>

              {filteredSales.length === 0 ? (
                <div className="py-16 text-center text-sm text-gray-400 bg-white rounded-lg border border-gray-200">
                  <ShoppingBag size={32} className="mx-auto mb-3 text-gray-300" />
                  <p className="font-medium">
                    {historyFilter === 'all' ? 'No purchases yet' : `No ${historyFilter === 'unsettled' ? 'unsettled' : 'settled'} orders`}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredSales.map(sale => {
                    const isOpen    = expanded === sale._id
                    const status    = settlementStatus(sale)
                    const staffName = resolveStaffName(sale.staffId)
                    const payLabel  = resolvePaymentLabel(sale)
                    const bal       = saleBalance(sale)
                    const itemSummary = sale.items.length <= 2
                      ? sale.items.map(i => `${i.productName} ×${i.quantity}`).join(', ')
                      : `${sale.items[0].productName} ×${sale.items[0].quantity} +${sale.items.length - 1} more`

                    return (
                      <div key={sale._id} className={`bg-white rounded-lg border overflow-hidden hover:shadow-sm transition-shadow ${
                        status === 'unpaid' ? 'border-red-200' : status === 'partial' ? 'border-amber-200' : 'border-gray-200'
                      }`}>
                        {/* Collapsed row */}
                        <div className="flex items-center gap-3 px-4 py-3">
                          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                            <ShoppingBag size={14} className="text-gray-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm text-gray-900">{sale.orderNumber}</span>
                              <span className="text-xs text-gray-400">{fmtDate(sale.createdAt)}</span>
                            </div>
                            <p className="text-xs text-gray-400 truncate mt-0.5">{itemSummary}</p>
                          </div>
                          <div className="hidden sm:flex flex-col items-end gap-0.5 shrink-0 min-w-[100px]">
                            <span className="text-xs text-gray-500 truncate max-w-[130px]">{staffName}</span>
                            <span className="text-xs text-gray-400">{payLabel}</span>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="text-sm font-bold text-gray-900">{fmtKES(sale.total)}</span>
                            <span className={`text-xs font-medium border rounded px-1.5 py-0.5 ${settlementBadgeClass(status)}`}>
                              {settlementLabel(status)}
                            </span>
                          </div>
                          <button onClick={() => setExpanded(isOpen ? null : sale._id)}
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors shrink-0">
                            {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        </div>

                        {/* Expanded drawer */}
                        {isOpen && (
                          <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 space-y-3">
                            <div className="flex flex-wrap gap-4 sm:hidden text-xs text-gray-500">
                              <span>Served by: <span className="font-medium text-gray-700">{staffName}</span></span>
                              <span>Payment: <span className="font-medium text-gray-700">{payLabel}</span></span>
                            </div>
                            <div className="flex flex-wrap gap-4 text-xs text-gray-400">
                              <span>{fmtDate(sale.createdAt)} at {fmtTime(sale.createdAt)}</span>
                              {sale.branchName && (
                                <span className="flex items-center gap-1"><Store size={10} />{sale.branchName}</span>
                              )}
                            </div>

                            {/* Items table */}
                            <div className="rounded-md overflow-hidden border border-gray-200 bg-white">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-gray-100 bg-gray-50">
                                    <th className="text-left px-3 py-2 font-medium text-gray-500">Item</th>
                                    <th className="text-center px-2 py-2 font-medium text-gray-500">Qty</th>
                                    <th className="text-right px-3 py-2 font-medium text-gray-500">Price</th>
                                    <th className="text-right px-3 py-2 font-medium text-gray-500">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sale.items.map((item, i) => {
                                    const disc = item.discount || 0
                                    const lineTotal = (item.price - disc) * item.quantity
                                    return (
                                      <tr key={i} className="border-b border-gray-50 last:border-0">
                                        <td className="px-3 py-2 text-gray-800">{item.productName}</td>
                                        <td className="px-2 py-2 text-center text-gray-600">{item.quantity}</td>
                                        <td className="px-3 py-2 text-right text-gray-600">
                                          {fmtKES(item.price)}
                                          {disc > 0 && <span className="text-orange-500 ml-1">−{fmtKES(disc)}</span>}
                                        </td>
                                        <td className="px-3 py-2 text-right font-medium text-gray-800">{fmtKES(lineTotal)}</td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                                <tfoot>
                                  {(sale.discount || 0) > 0 && (
                                    <tr className="border-t border-gray-100">
                                      <td colSpan={3} className="px-3 py-1.5 text-right text-gray-500">Order Discount</td>
                                      <td className="px-3 py-1.5 text-right text-orange-500 font-medium">−{fmtKES(sale.discount || 0)}</td>
                                    </tr>
                                  )}
                                  <tr className="border-t border-gray-200 bg-gray-50">
                                    <td colSpan={3} className="px-3 py-2 text-right font-semibold text-gray-700">Total</td>
                                    <td className="px-3 py-2 text-right font-bold text-gray-900">{fmtKES(sale.total)}</td>
                                  </tr>
                                  {bal > 0 && (
                                    <tr>
                                      <td colSpan={3} className="px-3 py-1.5 text-right text-xs text-gray-500">Paid so far</td>
                                      <td className="px-3 py-1.5 text-right text-xs font-medium text-green-700">{fmtKES(sale.total - bal)}</td>
                                    </tr>
                                  )}
                                  {bal > 0 && (
                                    <tr>
                                      <td colSpan={3} className="px-3 py-1.5 text-right text-xs text-red-500">Balance due</td>
                                      <td className="px-3 py-1.5 text-right text-xs font-semibold text-red-600">{fmtKES(bal)}</td>
                                    </tr>
                                  )}
                                </tfoot>
                              </table>
                            </div>

                            {sale.returns && sale.returns.length > 0 && (
                              <p className="text-xs text-orange-600 bg-orange-50 border border-orange-100 rounded px-3 py-1.5">
                                Returns: {sale.returns.map(r => `${r.productName} ×${r.quantity}`).join(', ')}
                              </p>
                            )}

                            <button onClick={() => sendOrderWhatsApp(sale)} disabled={!customer.phone}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 border border-green-300 bg-green-50 hover:bg-green-100 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                              <MessageCircle size={12} /> Send Receipt via WhatsApp
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </LoadingOrOffline>

      {/* ════════════════════════════════════════════════════════════════════
          Phase 2 — Allocation-aware payment dialog
      ════════════════════════════════════════════════════════════════════ */}
      <Dialog open={showPay} onOpenChange={v => { if (!v) setShowPay(false) }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogTitle>Record Payment — {customer?.name}</DialogTitle>

          <div className="flex-1 overflow-y-auto space-y-4 mt-2 pr-1">

            {/* ── Payment method + amount ── */}
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Payment Method *</label>
                <select value={payMethod}
                  onChange={e => { setPayMethod(e.target.value); setPayMpesaCode(''); setPayMpesaPhone(''); setPayBankId(''); setPayCustomId('') }}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <optgroup label="Standard Methods">
                    <option value="cash">Cash</option>
                    <option value="mobile_money">M-Pesa / Mobile Money</option>
                    <option value="card">Card</option>
                    {bankProviders.length > 0 && <option value="bank">Bank Transfer</option>}
                  </optgroup>
                  {customMethods.length > 0 && (
                    <optgroup label="Custom Methods">
                      {customMethods.map(m => <option key={m._id} value={`custom:${m._id}`}>{m.name}</option>)}
                    </optgroup>
                  )}
                </select>
              </div>

              {payMethod === 'mobile_money' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-sm font-medium text-gray-700">M-Pesa Code</label>
                    <Input className="mt-1" value={payMpesaCode} onChange={e => setPayMpesaCode(e.target.value)} placeholder="e.g. SG7XK3M9" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">M-Pesa Phone</label>
                    <Input className="mt-1" value={payMpesaPhone} onChange={e => setPayMpesaPhone(e.target.value)} placeholder="0712345678" />
                  </div>
                </div>
              )}
              {payMethod === 'bank' && (
                <div>
                  <label className="text-sm font-medium text-gray-700">Bank *</label>
                  <select value={payBankId} onChange={e => setPayBankId(e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    <option value="">Select bank</option>
                    {bankProviders.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-gray-700">Amount Received *</label>
                <Input className="mt-1" type="number" value={payReceived}
                  onChange={e => setPayReceived(e.target.value)} placeholder="Total cash/M-Pesa received" autoFocus />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700">Note (optional)</label>
                <Input className="mt-1" value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="e.g. Partial settlement" />
              </div>
            </div>

            {/* ── Order allocation list ── */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Allocate to Orders</p>

              {allocRows.length === 0 ? (
                <div className="text-center py-6 text-sm text-gray-400 bg-gray-50 rounded-lg border border-gray-200">
                  No unsettled orders found for this customer.
                </div>
              ) : (
                <div className="space-y-2">
                  {allocRows.map(row => {
                    const entered = parseFloat(row.amount) || 0
                    const overPay = entered > row.currentDebt + 0.01
                    return (
                      <div key={row.saleId} className={`rounded-lg border px-3 py-2.5 bg-white ${overPay ? 'border-red-300' : 'border-gray-200'}`}>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900">{row.orderNumber}</p>
                            <p className="text-xs text-gray-400">{fmtDate(row.orderDate)} · Balance: <span className="text-red-600 font-medium">{fmtKES(row.currentDebt)}</span></p>
                          </div>
                          <div className="w-32 shrink-0">
                            <Input
                              type="number"
                              value={row.amount}
                              onChange={e => setAllocAmount(row.saleId, e.target.value)}
                              placeholder="0"
                              className={`text-right text-sm ${overPay ? 'border-red-400 focus:ring-red-400' : ''}`}
                            />
                          </div>
                        </div>
                        {overPay && (
                          <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                            <AlertCircle size={11} /> Exceeds order balance of {fmtKES(row.currentDebt)}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── Running tally ── */}
            {payReceivedNum > 0 && (
              <div className={`rounded-lg border px-3 py-2.5 text-sm ${Math.abs(unallocated) <= 0.01 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                <div className="flex justify-between">
                  <span className="text-gray-600">Received</span>
                  <span className="font-semibold text-gray-900">{fmtKES(payReceivedNum)}</span>
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-gray-600">Allocated</span>
                  <span className="font-semibold text-gray-900">{fmtKES(allocTotal)}</span>
                </div>
                <div className={`flex justify-between mt-0.5 font-semibold ${Math.abs(unallocated) <= 0.01 ? 'text-green-700' : 'text-amber-700'}`}>
                  <span>Unallocated</span>
                  <span>{fmtKES(Math.abs(unallocated))}{unallocated < -0.01 ? ' (over-allocated)' : ''}</span>
                </div>
                {Math.abs(unallocated) <= 0.01 && (
                  <p className="text-xs text-green-600 mt-1">✓ Fully allocated — ready to submit</p>
                )}
              </div>
            )}
          </div>

          {/* ── Submit bar ── */}
          <div className="flex gap-2 pt-3 border-t border-gray-100 mt-3">
            <button onClick={recordPayment} disabled={paying || !canSubmitPay}
              className="flex-1 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
              {paying ? 'Saving…' : 'Record Payment'}
            </button>
            <button onClick={() => setShowPay(false)}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Customer Dialog ───────────────────────────────────────────── */}
      <Dialog open={showEdit} onOpenChange={v => { if (!v) setShowEdit(false) }}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Edit Customer</DialogTitle>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-sm font-medium text-gray-700">Name *</label>
              <Input className="mt-1" value={editName} onChange={e => setEditName(e.target.value)} placeholder="Full name" autoFocus />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Phone</label>
              <Input className="mt-1" value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="e.g. 0712345678" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Email</label>
              <Input className="mt-1" type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="optional" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">ID Number</label>
              <Input className="mt-1" value={editIdNumber} onChange={e => setEditIdNumber(e.target.value)} placeholder="National ID, Passport…" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Credit Limit</label>
              <Input className="mt-1" type="number" value={editCreditLimit} onChange={e => setEditCreditLimit(e.target.value)} placeholder="0 for no credit" />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={updateCustomer} disabled={editing}
                className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50">
                {editing ? 'Saving…' : 'Update Customer'}
              </button>
              <button onClick={() => setShowEdit(false)}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Take Deposit Dialog ────────────────────────────────────────────── */}
      <DepositDialog
        customer={customer ? { _id: customer._id, name: customer.name, phone: customer.phone } : null}
        open={showDeposit}
        onOpenChange={setShowDeposit}
        bankProviders={bankProviders}
        customMethods={customMethods}
        onTaken={load}
        shopName={shopSettings?.general?.shopName || shopName}
        shopLogo={shopSettings?.general?.logo}
        shopPhone={shopSettings?.general?.phone}
        shopEmail={shopSettings?.general?.email}
        shopAddress={shopSettings?.general?.address}
      />

      {/* ── Customer Deposits Dialog ───────────────────────────────────────── */}
      <CustomerDepositsDialog
        customerId={customer?._id ?? null}
        customerName={customer?.name ?? ''}
        open={showDepositsDialog}
        onOpenChange={setShowDepositsDialog}
        bankProviders={bankProviders}
        customMethods={customMethods}
        onCustomerChanged={load}
        canRefund={canRefundDeposits}
      />
    </div>
  )
}
