'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Plus, X, ChevronDown, ChevronUp, CreditCard, Mail, Phone, User, Calendar, MessageCircle, FileText, Edit2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { PermissionGuard } from '@/components/auth/permission-guard'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { apiGet, apiPost, apiPut, apiPatch, handleApiError } from '@/lib/api-client'
import { LoadingOrOffline } from '@/components/offline-indicator'
import { CustomerInvoiceDialog } from '@/components/customers/customer-invoice-dialog'
import { DepositDialog } from '@/components/deposits/deposit-dialog'
import { CustomerDepositsDialog } from '@/components/deposits/customer-deposits-dialog'

interface LedgerEntry {
  date: string
  type: 'purchase' | 'payment' | 'adjustment' | 'deposit' | 'deposit_use' | 'deposit_refund' | 'deposit_return'
  amount: number
  balance: number
  note?: string
  paymentMethod?: string
}

interface Customer {
  _id: string
  name: string
  phone: string
  email?: string
  idNumber?: string
  creditBalance: number
  creditLimit: number
  depositBalance: number  // prepayment we owe the customer (always >= 0)
  ledger: LedgerEntry[]
  createdAt: string
}

export default function CustomersPage() {
  return (
    <PermissionGuard requiredPermission="core.customers">
      <CustomersContent />
    </PermissionGuard>
  )
}

function CustomersContent() {
  const router = useRouter()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [isOffline, setIsOffline] = useState(false)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  // Add customer
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newIdNumber, setNewIdNumber] = useState('')
  const [newCreditLimit, setNewCreditLimit] = useState('')
  const [saving, setSaving] = useState(false)

  // Pay credit — navigate to customer detail page instead of inline dialog
  // (removed inline pay dialog; use the full payment flow on the customer detail page)

  // Payment methods data (still needed for deposit dialogs)
  const [bankProviders, setBankProviders] = useState<Array<{ _id: string; name: string }>>([])
  const [customMethods, setCustomMethods] = useState<Array<{ _id: string; name: string }>>([])


  // Edit customer
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editIdNumber, setEditIdNumber] = useState('')
  const [editCreditLimit, setEditCreditLimit] = useState('')
  const [editing, setEditing] = useState(false)

  // Invoice dialog
  const [invoiceCustomer, setInvoiceCustomer] = useState<Customer | null>(null)
  const [shopSettings, setShopSettings] = useState<any>(null)

  // Permissions — the page-level PermissionGuard ensures core.customers, but the
  // deposit actions are finer-grained (pos.deposits.take / .refund). Owners
  // (type 'user') always have everything; staff need explicit grants.
  const [currentUser, setCurrentUser] = useState<any>(null)
  const isOwner = currentUser?.type === 'user'
  const canTakeDeposits = isOwner || !!currentUser?.permissions?.['pos.deposits.take']
  const canRefundDeposits = isOwner || !!currentUser?.permissions?.['pos.deposits.refund']

  // Take deposit
  const [depositCustomer, setDepositCustomer] = useState<Customer | null>(null)
  const [showDeposit, setShowDeposit] = useState(false)

  // View / manage deposits (refund flow lives here)
  const [depositsCustomer, setDepositsCustomer] = useState<Customer | null>(null)
  const [showDepositsDialog, setShowDepositsDialog] = useState(false)

  // WhatsApp invoice sharing (legacy - keeping for compatibility)
  useEffect(() => { 
    load()
    fetchSettings()
    fetchBankProviders()
    fetchCustomMethods()
    fetchCurrentUser()
  }, [])

  async function fetchCurrentUser() {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const data = await res.json()
        setCurrentUser(data.user || null)
      }
    } catch (error) {
      console.error('Failed to fetch current user:', error)
    }
  }

  async function load() {
    setLoading(true)
    setIsOffline(false)
    
    const result = await apiGet<{ customers: Customer[] }>(`/api/customers?search=${encodeURIComponent(search)}`)
    
    if (result.success && result.data) {
      setCustomers(result.data.customers || [])
    } else if (result.error) {
      setIsOffline(result.error.isOffline)
      if (!result.error.isOffline) {
        toast.error(handleApiError(result.error, 'Failed to load customers'))
      }
    }
    
    setLoading(false)
  }

  async function fetchSettings() {
    try {
      const res = await fetch('/api/settings')
      if (res.ok) {
        const data = await res.json()
        setShopSettings(data.settings || {})
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error)
    }
  }

  async function fetchBankProviders() {
    try {
      const res = await fetch('/api/bank-providers')
      if (res.ok) {
        const data = await res.json()
        setBankProviders(data.providers || [])
      }
    } catch (error) {
      console.error('Failed to fetch bank providers:', error)
    }
  }

  async function fetchCustomMethods() {
    try {
      const res = await fetch('/api/payment-methods')
      if (res.ok) {
        const data = await res.json()
        setCustomMethods(data.methods || [])
      }
    } catch (error) {
      console.error('Failed to fetch payment methods:', error)
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
  }, [search])

  async function addCustomer() {
    if (!newName.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: newName, 
          phone: newPhone, 
          email: newEmail,
          idNumber: newIdNumber,
          creditLimit: parseFloat(newCreditLimit) || 0 
        }),
      })
      if (res.ok) {
        toast.success('Customer added')
        setShowAdd(false); setNewName(''); setNewPhone(''); setNewEmail(''); setNewIdNumber(''); setNewCreditLimit('')
        load()
      } else {
        const d = await res.json(); toast.error(d.error || 'Failed to add customer')
      }
    } catch { toast.error('Failed to add customer') }
    setSaving(false)
  }

  function openEditCustomer(customer: Customer) {
    setEditCustomer(customer)
    setEditName(customer.name)
    setEditPhone(customer.phone)
    setEditEmail(customer.email || '')
    setEditIdNumber(customer.idNumber || '')
    setEditCreditLimit(String(customer.creditLimit))
  }

  async function updateCustomer() {
    if (!editCustomer || !editName.trim()) { toast.error('Name is required'); return }
    setEditing(true)
    try {
      const res = await fetch(`/api/customers/${editCustomer._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          phone: editPhone,
          email: editEmail,
          idNumber: editIdNumber,
          creditLimit: parseFloat(editCreditLimit) || 0,
        }),
      })
      if (res.ok) {
        toast.success('Customer updated')
        setEditCustomer(null); setEditName(''); setEditPhone(''); setEditEmail(''); setEditIdNumber(''); setEditCreditLimit('')
        load()
      } else {
        const d = await res.json(); toast.error(d.error || 'Failed to update customer')
      }
    } catch { toast.error('Failed to update customer') }
    setEditing(false)
  }

  async function deleteCustomer(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    try {
      await fetch(`/api/customers/${id}`, { method: 'DELETE' })
      toast.success('Customer deleted')
      load()
    } catch { toast.error('Failed to delete') }
  }

  function formatPhone(phone: string): string {
    // Format Kenyan phone numbers for WhatsApp
    if (!phone) return ''
    let cleaned = phone.replace(/\D/g, '')
    
    // If starts with 0, replace with 254
    if (cleaned.startsWith('0')) {
      cleaned = '254' + cleaned.slice(1)
    }
    // If doesn't start with country code, add 254
    else if (!cleaned.startsWith('254')) {
      cleaned = '254' + cleaned
    }
    
    return cleaned
  }

  function shareInvoiceViaWhatsApp(customer: Customer) {
    if (!customer.phone) {
      toast.error('No phone number registered for this customer')
      return
    }

    const businessName = shopSettings?.general?.shopName || shopSettings?.shopName || 'Our Business'
    const phone = formatPhone(customer.phone)
    
    if (phone.length < 12) {
      toast.error('Invalid phone number format')
      return
    }

    // Create invoice message
    const message = `Hello ${customer.name},

Thank you for your business with ${businessName}!

${customer.creditBalance > 0 
  ? `Current Balance: KES ${customer.creditBalance.toLocaleString()}
${customer.creditLimit > 0 ? `Credit Limit: KES ${customer.creditLimit.toLocaleString()}` : ''}

Please contact us to settle your outstanding balance.`
  : 'Your account is in good standing. Thank you for your prompt payments!'}

For any inquiries, please contact us.

Thank you for choosing ${businessName}!`

    const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    
    // Open WhatsApp in new window
    window.open(whatsappUrl, '_blank')
    toast.success('Opening WhatsApp...')
  }

  const totalDebt = customers.reduce((s, c) => s + c.creditBalance, 0)
  const totalDeposits = customers.reduce((s, c) => s + (c.depositBalance || 0), 0)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Customers</h1>
          {totalDebt > 0 && (
            <p className="text-sm text-red-500 mt-0.5">Total outstanding credit: KES {totalDebt.toLocaleString()}</p>
          )}
          {totalDeposits > 0 && (
            <p className="text-sm text-teal-600 mt-0.5">Total customer deposits held: KES {totalDeposits.toLocaleString()}</p>
          )}
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold"
        >
          <Plus size={15} /> Add Customer
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <Input
          className="pl-9"
          placeholder="Search by name or phone..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Customer Cards Grid */}
      <LoadingOrOffline
        isLoading={loading}
        isOffline={isOffline}
        onRetry={load}
        loadingText="Loading customers..."
        offlineMessage="Unable to load customers. Please check your connection."
      >
        {customers.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">
            {search ? 'No customers match your search.' : 'No customers yet. Add your first one.'}
          </div>
        ) : (
          <div className="space-y-2">
            {customers.map(c => {
              const hasCredit   = c.creditBalance > 0
              const hasDeposit  = (c.depositBalance || 0) > 0
              const isClear     = !hasCredit && !hasDeposit
              return (
                <div
                  key={c._id}
                  onClick={() => router.push(`/dashboard/customers/${c._id}`)}
                  className={`bg-white rounded-lg border overflow-hidden hover:shadow-sm transition-shadow cursor-pointer ${
                    hasCredit ? 'border-red-200' : hasDeposit ? 'border-teal-200' : 'border-gray-200'
                  }`}
                >
                  {/* Row */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Avatar */}
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                      hasCredit ? 'bg-red-100' : hasDeposit ? 'bg-teal-100' : 'bg-gray-100'
                    }`}>
                      <User size={16} className={
                        hasCredit ? 'text-red-500' : hasDeposit ? 'text-teal-600' : 'text-gray-500'
                      } />
                    </div>

                    {/* Name + contact */}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-900 truncate">{c.name}</p>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {c.phone && (
                          <span className="flex items-center gap-1 text-xs text-gray-400">
                            <Phone size={10} />{c.phone}
                          </span>
                        )}
                        {c.email && (
                          <span className="text-xs text-gray-400 truncate max-w-[160px]">{c.email}</span>
                        )}
                        {!c.phone && !c.email && (
                          <span className="text-xs text-gray-400 italic">No contact info</span>
                        )}
                      </div>
                    </div>

                    {/* Credit limit — hidden on mobile */}
                    <div className="hidden sm:flex flex-col items-end gap-0.5 shrink-0 min-w-[90px]">
                      {c.creditLimit > 0 ? (
                        <span className="text-xs text-gray-400">Limit: KES {c.creditLimit.toLocaleString()}</span>
                      ) : (
                        <span className="text-xs text-gray-400 italic">No limit</span>
                      )}
                      {c.idNumber && (
                        <span className="text-xs text-gray-400">ID: {c.idNumber}</span>
                      )}
                    </div>

                    {/* Status badges */}
                    <div className="flex flex-col gap-1 shrink-0 items-end min-w-[90px]">
                      {isClear ? (
                        <span className="text-xs font-medium text-green-600 bg-green-50 border border-green-200 rounded px-2 py-0.5">Clear</span>
                      ) : (
                        <>
                          {hasCredit && (
                            <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-2 py-0.5 whitespace-nowrap">
                              Owes KES {c.creditBalance.toLocaleString()}
                            </span>
                          )}
                          {hasDeposit && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setDepositsCustomer(c); setShowDepositsDialog(true) }}
                              className="text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 rounded px-2 py-0.5 whitespace-nowrap hover:bg-teal-100 transition-colors"
                            >
                              +KES {c.depositBalance.toLocaleString()}
                            </button>
                          )}
                        </>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditCustomer(c) }}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                        title="Edit"
                      >
                        <Edit2 size={14} />
                      </button>
                      {canTakeDeposits && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setDepositCustomer(c); setShowDeposit(true) }}
                          className="p-1.5 rounded hover:bg-teal-50 text-teal-500 hover:text-teal-700 transition-colors"
                          title="Take deposit"
                        >
                          <CreditCard size={14} />
                        </button>
                      )}
                      {hasCredit ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/customers/${c._id}?action=pay`) }}
                          className="px-2.5 py-1 text-xs font-semibold rounded bg-green-600 hover:bg-green-700 text-white transition-colors"
                        >
                          Pay
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); shareInvoiceViaWhatsApp(c) }}
                          disabled={!c.phone}
                          className="p-1.5 rounded hover:bg-green-50 text-green-500 hover:text-green-700 transition-colors disabled:opacity-40"
                          title="WhatsApp"
                        >
                          <MessageCircle size={14} />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setExpanded(expanded === c._id ? null : c._id) }}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        {expanded === c._id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Ledger */}
                  {expanded === c._id && (
                    <div className="px-4 pb-3 pt-2 bg-gray-50 border-t border-gray-100">
                      <p className="text-xs font-medium text-gray-600 mb-1.5">Transaction history</p>
                      {c.ledger.length === 0 ? (
                        <p className="text-xs text-gray-400 py-1">No transactions</p>
                      ) : (
                        <div className="space-y-0.5 max-h-40 overflow-y-auto">
                          {[...c.ledger].reverse().map((entry, i) => {
                            let label = 'Adj'
                            let labelClass = 'text-gray-600'
                            let amountClass = entry.amount < 0 ? 'text-green-600' : 'text-red-500'
                            if (entry.type === 'payment') {
                              label = 'Payment'; labelClass = 'text-green-600'
                            } else if (entry.type === 'purchase') {
                              label = 'Purchase'; labelClass = 'text-gray-600'
                            } else if (entry.type === 'deposit') {
                              label = 'Deposit'; labelClass = 'text-teal-700'; amountClass = 'text-teal-700'
                            } else if (entry.type === 'deposit_use') {
                              label = 'Used'; labelClass = 'text-cyan-700'; amountClass = 'text-cyan-700'
                            } else if (entry.type === 'deposit_refund') {
                              label = 'Refund'; labelClass = 'text-orange-600'; amountClass = 'text-orange-600'
                            } else if (entry.type === 'deposit_return') {
                              label = 'Return'; labelClass = 'text-teal-700'; amountClass = 'text-teal-700'
                            }
                            return (
                              <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-gray-100 last:border-0">
                                <span className={labelClass}>{label}</span>
                                <div className="flex items-center gap-2">
                                  <span className={amountClass}>
                                    {entry.amount < 0 ? '-' : '+'}KES {Math.abs(entry.amount).toLocaleString()}
                                  </span>
                                  <span className="text-gray-300">{new Date(entry.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {hasCredit && (
                        <button
                          onClick={() => setInvoiceCustomer(c)}
                          disabled={!c.phone}
                          className="w-full mt-2 px-2 py-1 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium flex items-center justify-center gap-1"
                        >
                          <FileText size={12} />
                          Send Invoice
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </LoadingOrOffline>

      {/* Add Customer Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Add Customer</DialogTitle>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-sm font-medium text-gray-700">Name *</label>
              <Input className="mt-1" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Full name" autoFocus />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Phone</label>
              <Input className="mt-1" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="e.g. 0712345678" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Email</label>
              <Input className="mt-1" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="optional" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">ID Number</label>
              <Input 
                className="mt-1" 
                value={newIdNumber} 
                onChange={e => setNewIdNumber(e.target.value)} 
                placeholder="Required for credit (e.g. National ID, Passport)" 
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Credit Limit</label>
              <Input 
                className="mt-1" 
                type="number" 
                value={newCreditLimit} 
                onChange={e => setNewCreditLimit(e.target.value)} 
                placeholder="0 for no credit" 
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={addCustomer}
                disabled={saving}
                className="flex-1 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Add Customer'}
              </button>
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Customer Dialog */}
      <Dialog open={!!editCustomer} onOpenChange={v => !v && setEditCustomer(null)}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Edit Customer</DialogTitle>
          {editCustomer && (
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
                <Input 
                  className="mt-1" 
                  value={editIdNumber} 
                  onChange={e => setEditIdNumber(e.target.value)} 
                  placeholder="Required for credit (e.g. National ID, Passport)" 
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Credit Limit</label>
                <Input 
                  className="mt-1" 
                  type="number" 
                  value={editCreditLimit} 
                  onChange={e => setEditCreditLimit(e.target.value)} 
                  placeholder="0 for no credit" 
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={updateCustomer}
                  disabled={editing}
                  className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {editing ? 'Saving...' : 'Update Customer'}
                </button>
                <button onClick={() => setEditCustomer(null)} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Customer Invoice Dialog */}
      <CustomerInvoiceDialog
        open={!!invoiceCustomer}
        onOpenChange={(open) => !open && setInvoiceCustomer(null)}
        customer={invoiceCustomer}
        shopName={shopSettings?.general?.shopName || 'Our Shop'}
        shopLogo={shopSettings?.general?.logo}
        shopPhone={shopSettings?.general?.phone}
        shopEmail={shopSettings?.general?.email}
        shopAddress={shopSettings?.general?.address}
        mpesaPaybill={shopSettings?.payment?.mpesaPaybill}
        mpesaAccountNumber={shopSettings?.payment?.mpesaAccountNumber}
        bankDetails={shopSettings?.payment?.bankDetails}
        issuedBy={currentUser?.name}
      />

      {/* Take Deposit Dialog */}
      <DepositDialog
        customer={depositCustomer}
        open={showDeposit}
        onOpenChange={setShowDeposit}
        bankProviders={bankProviders}
        customMethods={customMethods}
        onTaken={load}
        shopName={shopSettings?.general?.shopName || shopSettings?.shopName || ''}
        shopLogo={shopSettings?.general?.logo || shopSettings?.logo}
        shopPhone={shopSettings?.general?.phone}
        shopEmail={shopSettings?.general?.email}
        shopAddress={shopSettings?.general?.address}
        cashierName={currentUser?.name}
        paperSize={shopSettings?.receipt?.paperSize || '58mm'}
      />

      {/* Customer Deposits management dialog (view + refund) */}
      <CustomerDepositsDialog
        customerId={depositsCustomer?._id ?? null}
        customerName={depositsCustomer?.name ?? ''}
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
