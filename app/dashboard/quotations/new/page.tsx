'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Plus, Trash2, Minus, Search, Send, Download, Save, Check,
  ChevronsUpDown, Calendar as CalendarIcon, UserPlus, MessageCircle, Package,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Calendar as CalendarComponent } from '@/components/ui/calendar'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatProductName } from '@/lib/format-product-name'
import { format } from 'date-fns'
import { PermissionGuard } from '@/components/auth/permission-guard'
import {
  QuotationReceipt,
  QuotationReceiptRef,
} from '@/components/quotations/quotation-receipt'

// ── Types ────────────────────────────────────────────────────────────────────
interface Product {
  _id: string
  productName: string
  category: string
  sellingPrice: number
  wholeSale: number
  stock: number
  brand?: string
  model?: string
  variant?: string
  barcode?: string
  images?: string[]
  trackLots?: boolean
}

interface Customer {
  _id: string
  name: string
  phone: string
  email?: string
}

interface QuoteLineItem {
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  discount: number // per-line, fixed KSh
}

// ── Phone formatting (07xx / 01xx → 254xx) for wa.me ─────────────────────────
function formatPhone(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '')
  if (digits.startsWith('0') && digits.length === 10) return '254' + digits.slice(1)
  if (digits.startsWith('254')) return digits
  return digits
}

const EXPIRY_PRESETS = [
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
]

export default function QuotationsNewPage() {
  return (
    <PermissionGuard requiredPermission="core.quotations">
      <QuotationsNewContent />
    </PermissionGuard>
  )
}

function QuotationsNewContent() {
  const router = useRouter()
  const receiptRef = useRef<QuotationReceiptRef>(null)

  // ── Data ──
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [shopSettings, setShopSettings] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  // ── Product search / filter ──
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  // ── Customer selector ──
  const [customerId, setCustomerId] = useState('')
  const [customerOpen, setCustomerOpen] = useState(false)
  const [showCreateCustomer, setShowCreateCustomer] = useState(false)
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '' })
  const [creatingCustomer, setCreatingCustomer] = useState(false)

  // ── Quote header ──
  const [validUntil, setValidUntil] = useState<Date>(() => {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    return d
  })
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [notes, setNotes] = useState('')

  // ── Pricing mode ──
  const [isWholesaleMode, setIsWholesaleMode] = useState(false)
  const [branchPricingConfig, setBranchPricingConfig] = useState<{
    pricingType: 'retail' | 'wholesale'
    allowModeToggle: boolean
  }>({ pricingType: 'retail', allowModeToggle: true })

  // ── Line items ──
  const [items, setItems] = useState<QuoteLineItem[]>([])
  const [cartDiscount, setCartDiscount] = useState<number>(0)

  // ── Save state ──
  const [savedQuote, setSavedQuote] = useState<{ _id: string; quotationNumber: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [mobileTab, setMobileTab] = useState<'products' | 'cart'>('products')

  const selectedCustomer = customers.find(c => c._id === customerId) || null

  useEffect(() => {
    fetchInitialData()
  }, [])

  async function fetchInitialData() {
    try {
      const [productsRes, customersRes, settingsRes] = await Promise.all([
        fetch('/api/products'),
        fetch('/api/customers'),
        fetch('/api/settings'),
      ])

      if (productsRes.ok) {
        const data = await productsRes.json()
        const prods: Product[] = data.products || []
        setProducts(prods)
        const cats = Array.from(new Set(prods.map(p => p.category).filter(Boolean))).sort()
        setCategories(cats)
      }
      if (customersRes.ok) {
        const data = await customersRes.json()
        setCustomers(data.customers || [])
      }
      if (settingsRes.ok) {
        const data = await settingsRes.json()
        setShopSettings(data.settings || {})
      }

      // Branch pricing defaults
      try {
        const branchId = document.cookie
          .split('; ')
          .find(row => row.startsWith('selected_branch='))
          ?.split('=')[1]
        if (branchId) {
          const res = await fetch(`/api/branches/${branchId}`)
          if (res.ok) {
            const data = await res.json()
            const pricingType: 'retail' | 'wholesale' = data.branch?.pricingType ?? 'retail'
            const allowModeToggle: boolean = data.branch?.allowModeToggle ?? true
            setBranchPricingConfig({ pricingType, allowModeToggle })
            setIsWholesaleMode(pricingType === 'wholesale')
          }
        }
      } catch {
        // ignore — retail default
      }
    } catch (error) {
      console.error('Initial data error:', error)
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  // ── Filtered products ──
  const filteredProducts = useMemo(() => {
    let filtered = products
    if (categoryFilter !== 'all') filtered = filtered.filter(p => p.category === categoryFilter)
    if (search.trim()) {
      const terms = search.toLowerCase().split(/\s+/).filter(Boolean)
      filtered = filtered.filter(p => {
        const combined = [p.productName, p.brand, p.model, p.variant, p.category]
          .filter(Boolean).join(' ').toLowerCase()
        return terms.every(t => combined.includes(t))
      })
    }
    return filtered
  }, [products, categoryFilter, search])

  // ── Line item helpers ──
  function priceForProduct(p: Product): number {
    return isWholesaleMode && p.wholeSale > 0 ? p.wholeSale : p.sellingPrice
  }

  function addToQuote(product: Product) {
    setItems(prev => {
      const existing = prev.findIndex(i => i.productId === product._id)
      if (existing !== -1) {
        const next = [...prev]
        next[existing] = { ...next[existing], quantity: next[existing].quantity + 1 }
        return next
      }
      return [
        ...prev,
        {
          productId: product._id,
          productName: formatProductName(product),
          quantity: 1,
          unitPrice: priceForProduct(product),
          discount: 0,
        },
      ]
    })
  }

  function updateItem(index: number, field: keyof QuoteLineItem, value: number) {
    setItems(prev => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  function adjustQty(index: number, delta: number) {
    setItems(prev => {
      const next = [...prev]
      const newQty = Math.max(1, next[index].quantity + delta)
      next[index] = { ...next[index], quantity: newQty }
      return next
    })
  }

  function removeItem(index: number) {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  const lineTotal = (i: QuoteLineItem) => Math.max(0, i.quantity * i.unitPrice - i.discount)
  const subtotal = items.reduce((s, i) => s + lineTotal(i), 0)
  const total = Math.max(0, subtotal - cartDiscount)

  // ── Customer create ──
  async function handleCreateCustomer() {
    if (!newCustomer.name.trim()) {
      toast.error('Customer name is required')
      return
    }
    setCreatingCustomer(true)
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCustomer.name.trim(),
          phone: newCustomer.phone.trim(),
          email: newCustomer.email.trim(),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const created: Customer = data.customer
        setCustomers(prev => [...prev, created])
        setCustomerId(created._id)
        setShowCreateCustomer(false)
        setNewCustomer({ name: '', phone: '', email: '' })
        toast.success(`Customer created: ${created.name}`)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create customer')
      }
    } catch {
      toast.error('Error creating customer')
    } finally {
      setCreatingCustomer(false)
    }
  }

  // ── Persistence ──
  function buildBody(sendNow: boolean) {
    return {
      customerId,
      customerName: selectedCustomer?.name || '',
      customerPhone: selectedCustomer?.phone || '',
      customerEmail: selectedCustomer?.email || '',
      items: items.map(i => ({
        productId: i.productId,
        productName: i.productName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discount: i.discount,
      })),
      discount: cartDiscount,
      validUntil: validUntil.toISOString(),
      notes,
      sendNow,
    }
  }

  async function persistQuote(sendNow: boolean): Promise<{ _id: string; quotationNumber: string } | null> {
    const body = buildBody(sendNow)

    if (savedQuote) {
      // Update the quote already created this session.
      const res = await fetch(`/api/quotations/${savedQuote._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, status: sendNow ? 'sent' : undefined }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update quotation')
      }
      return savedQuote
    }

    const res = await fetch('/api/quotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Failed to save quotation')
    }
    const data = await res.json()
    const created = { _id: data.quotation._id, quotationNumber: data.quotation.quotationNumber }
    setSavedQuote(created)
    return created
  }

  function validate(): string | null {
    if (!customerId) return 'Please select a customer'
    if (items.length === 0) return 'Add at least one item'
    if (items.some(i => i.quantity < 1)) return 'Quantities must be at least 1'
    return null
  }

  // ── Save Quote ──
  async function handleSave() {
    const err = validate()
    if (err) { toast.error(err); return }
    setSaving(true)
    try {
      const q = await persistQuote(false)
      toast.success(`Quotation ${q?.quotationNumber} saved`)
      router.push('/dashboard/quotations')
    } catch (e: any) {
      toast.error(e.message || 'Failed to save quotation')
    } finally {
      setSaving(false)
    }
  }

  // ── Save & Send on WhatsApp ──
  async function handleSaveAndSend() {
    const err = validate()
    if (err) { toast.error(err); return }
    if (!selectedCustomer?.phone) {
      toast.error('Customer has no phone number. Add one to their record first.')
      return
    }
    setSending(true)
    try {
      const q = await persistQuote(true)
      // Generate the public share token so the message can carry a web link
      // to the mobile-friendly quotation view instead of a long item list.
      let shareUrl = ''
      try {
        const shareRes = await fetch(`/api/quotations/${q?._id}/share`, { method: 'POST' })
        if (shareRes.ok) {
          const shareData = await shareRes.json()
          const origin = shopSettings?.general?.publicBaseUrl || window.location.origin
          shareUrl = `${origin}/q/${shareData.shareToken}`
        }
      } catch { /* non-fatal — send without link */ }
      const message = buildWhatsAppMessage(q?.quotationNumber || '', shareUrl)
      const waUrl = `https://wa.me/${formatPhone(selectedCustomer.phone)}?text=${encodeURIComponent(message)}`
      window.open(waUrl, '_blank')
      toast.success(`Quotation ${q?.quotationNumber} saved and opened in WhatsApp`)
      router.push('/dashboard/quotations')
    } catch (e: any) {
      toast.error(e.message || 'Failed to send quotation')
    } finally {
      setSending(false)
    }
  }

  // ── Download PDF (save as draft + print a proper quotation document) ──
  async function handleDownloadPDF() {
    const err = validate()
    if (err) { toast.error(err); return }
    setSaving(true)
    try {
      const q = await persistQuote(false)
      toast.success(`Quotation ${q?.quotationNumber} saved — opening print dialog`)
      // Small delay to let the hidden receipt render with the new number.
      setTimeout(() => receiptRef.current?.print(), 100)
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate PDF')
    } finally {
      setSaving(false)
    }
  }

  // ── WhatsApp message (short summary + public link) ──
  function buildWhatsAppMessage(qNumber: string, shareUrl: string): string {
    const shopName = shopSettings?.general?.shopName || shopSettings?.shopName || 'Our Shop'
    let msg = `*${shopName.toUpperCase()} QUOTATION*\n`
    if (qNumber) msg += `Quote: ${qNumber}\n`
    msg += `Total: KSh ${total.toLocaleString()}\n`
    msg += `Paid: KSh 0 | Remaining: KSh ${total.toLocaleString()}\n\n`
    if (shareUrl) msg += `View full quotation & download PDF:\n${shareUrl}\n\n`
    msg += `Valid until ${format(validUntil, 'd MMM yyyy')}\n\n`
    msg += `Reply to confirm or adjust. Thank you!`
    return msg
  }

  // ── Receipt props (for Download PDF) ──
  const receiptItems = items.map(i => ({
    productId: i.productId,
    productName: i.productName,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    discount: i.discount,
    lineTotal: lineTotal(i),
  }))

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-7rem)] min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-2 sm:py-3 border-b bg-background">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="sm" className="px-2 sm:px-3" onClick={() => router.push('/dashboard/quotations')}>
            <ArrowLeft className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Back</span>
          </Button>
          <h1 className="text-base sm:text-xl font-bold truncate">New Quotation</h1>
          {savedQuote && (
            <Badge variant="secondary" className="shrink-0">{savedQuote.quotationNumber}</Badge>
          )}
        </div>
        {branchPricingConfig.allowModeToggle && (
          <div className="flex items-center gap-2 shrink-0">
            <span className={cn('text-sm hidden sm:inline', !isWholesaleMode && 'font-semibold')}>Retail</span>
            <span className="text-xs sm:hidden font-medium">{isWholesaleMode ? 'Wholesale' : 'Retail'}</span>
            <Switch checked={isWholesaleMode} onCheckedChange={setIsWholesaleMode} />
            <span className={cn('text-sm hidden sm:inline', isWholesaleMode && 'font-semibold')}>Wholesale</span>
          </div>
        )}
      </div>

      {/* Top bar: customer + expiry */}
      <div className="flex items-end gap-2 sm:gap-4 px-4 sm:px-6 py-2 sm:py-3 border-b bg-muted/30">
        {/* Customer selector */}
        <div className="flex-1 min-w-0">
          <Label className="text-xs text-muted-foreground mb-1 hidden sm:block">Customer</Label>
          <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="w-full justify-between h-9 sm:h-10" type="button">
                {selectedCustomer ? (
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="truncate">{selectedCustomer.name}</span>
                    {selectedCustomer.phone && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                        <MessageCircle className="h-3 w-3" />
                        {selectedCustomer.phone}
                      </span>
                    )}
                  </span>
                ) : (
                  'Select customer…'
                )}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[90vw] max-w-[360px] sm:w-[360px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search customers…" />
                <CommandList>
                  <CommandEmpty>No customer found.</CommandEmpty>
                  <CommandGroup>
                    {customers.map(c => (
                      <CommandItem
                        key={c._id}
                        value={c.name + ' ' + (c.phone || '')}
                        onSelect={() => { setCustomerId(c._id); setCustomerOpen(false) }}
                      >
                        <Check className={cn('mr-2 h-4 w-4', customerId === c._id ? 'opacity-100' : 'opacity-0')} />
                        <div>
                          <div>{c.name}</div>
                          {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  <Separator />
                  <CommandGroup>
                    <CommandItem
                      onSelect={() => {
                        setCustomerOpen(false)
                        setNewCustomer({ name: '', phone: '', email: '' })
                        setShowCreateCustomer(true)
                      }}
                    >
                      <UserPlus className="mr-2 h-4 w-4" />
                      Create new customer
                    </CommandItem>
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* Expiry */}
        <div className="shrink-0">
          <Label className="text-xs text-muted-foreground mb-1 hidden sm:block">Valid for</Label>
          <div className="flex gap-2">
            <Select
              value={String(EXPIRY_PRESETS.find(p => p.days === presetDays(validUntil))?.days ?? 'custom')}
              onValueChange={(v) => {
                if (v === 'custom') return
                const d = new Date()
                d.setDate(d.getDate() + Number(v))
                setValidUntil(d)
              }}
            >
              <SelectTrigger className="w-[92px] sm:w-[130px] text-xs sm:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_PRESETS.map(p => (
                  <SelectItem key={p.days} value={String(p.days)}>{p.label}</SelectItem>
                ))}
                <SelectItem value="custom">Custom…</SelectItem>
              </SelectContent>
            </Select>
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" type="button" className="justify-center h-9 w-9 p-0 sm:h-auto sm:w-auto sm:px-3 sm:justify-start sm:flex-1">
                  <CalendarIcon className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">{format(validUntil, 'd MMM yyyy')}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={validUntil}
                  onSelect={(d) => { if (d) { setValidUntil(d); setCalendarOpen(false) } }}
                  disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      {/* Main split: inventory | line items (tabbed on mobile, side-by-side on desktop) */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        {/* Mobile tab switcher */}
        <div className="flex border-b lg:hidden">
          <button
            type="button"
            onClick={() => setMobileTab('products')}
            className={cn(
              'flex-1 py-2.5 text-sm font-medium border-b-2 transition-colors',
              mobileTab === 'products' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'
            )}
          >
            Products
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('cart')}
            className={cn(
              'flex-1 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-1.5',
              mobileTab === 'cart' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'
            )}
          >
            Cart
            {items.length > 0 && <Badge variant="secondary">{items.length}</Badge>}
          </button>
        </div>
        {/* Inventory pane */}
        <div className={cn(
          'flex-1 min-h-0 border-r min-w-0 lg:flex lg:flex-col',
          mobileTab === 'products' ? 'flex flex-col' : 'hidden'
        )}>
          <div className="p-3 border-b space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search products…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Package className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">No products found</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
                {filteredProducts.map(p => {
                  const price = priceForProduct(p)
                  return (
                    <button
                      key={p._id}
                      onClick={() => addToQuote(p)}
                      disabled={p.stock <= 0}
                      className={cn(
                        'text-left border rounded-lg p-2.5 hover:border-primary hover:shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex flex-col gap-1',
                        items.some(i => i.productId === p._id) && 'border-primary bg-primary/5'
                      )}
                    >
                      <div className="text-sm font-semibold leading-tight line-clamp-2">
                        {p.productName}
                      </div>
                      {(p.brand || p.model || p.variant) && (
                        <div className="text-xs text-muted-foreground leading-tight line-clamp-1">
                          {[p.brand, p.model, p.variant].filter(Boolean).join(' · ')}
                        </div>
                      )}
                      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {p.category && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 leading-none truncate">{p.category}</Badge>
                          )}
                          <span className="text-xs text-muted-foreground">stk: {p.stock}</span>
                        </div>
                        <span className="text-sm font-bold shrink-0">KSh {price.toLocaleString()}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Line items pane */}
        <div className={cn(
          'flex-1 min-h-0 bg-background lg:w-[460px] lg:flex lg:flex-col lg:flex-none',
          mobileTab === 'cart' ? 'flex flex-col w-full' : 'hidden'
        )}>
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Line Items</Label>
                <Badge variant="outline">{items.length} item{items.length !== 1 ? 's' : ''}</Badge>
              </div>

              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border border-dashed rounded-lg">
                  <Package className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">Tap a product to add it to the quote</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item, index) => (
                    <div key={item.productId} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium leading-tight">{item.productName}</span>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeItem(index)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                      <div className="flex flex-col gap-2 sm:grid sm:grid-cols-12 sm:gap-2 sm:items-center">
                        {/* Qty stepper */}
                        <div className="flex items-center sm:col-span-4">
                          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => adjustQty(index, -1)}>
                            <Minus className="h-3 w-3" />
                          </Button>
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateItem(index, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                            className="h-8 mx-1 text-center w-14"
                          />
                          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => adjustQty(index, 1)}>
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="flex gap-2 sm:contents">
                          {/* Unit price */}
                          <div className="flex-1 sm:col-span-4">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.unitPrice}
                              onChange={(e) => updateItem(index, 'unitPrice', Math.max(0, parseFloat(e.target.value) || 0))}
                              className="h-8 text-xs"
                            />
                          </div>
                          {/* Discount */}
                          <div className="flex-1 sm:col-span-4">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="disc"
                              value={item.discount || ''}
                              onChange={(e) => updateItem(index, 'discount', Math.max(0, parseFloat(e.target.value) || 0))}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground pl-1">
                        <span>Qty · Unit Price · Disc (KSh)</span>
                        <span className="font-semibold text-foreground">KSh {lineTotal(item).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Totals + notes */}
          <div className="border-t p-4 space-y-3 bg-muted/30">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">KSh {subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Cart discount (KSh)</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={cartDiscount || ''}
                  onChange={(e) => setCartDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="h-8 w-28 text-right"
                  placeholder="0"
                />
              </div>
              <Separator className="my-1" />
              <div className="flex justify-between text-base font-bold">
                <span>Total</span>
                <span>KSh {total.toLocaleString()}</span>
              </div>
            </div>
            <Textarea
              placeholder="Notes (optional)…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="bg-background"
            />
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-2 px-3 sm:px-6 py-2 sm:py-3 border-t bg-background sm:justify-end sm:gap-3">
        <Button variant="outline" onClick={handleSave} disabled={saving || sending} className="flex-1 sm:flex-none h-9 rounded-full sm:rounded-md text-xs sm:text-sm px-3 sm:px-4">
          <Save className="h-4 w-4 mr-1 sm:mr-2" />
          <span className="sm:hidden">Save</span>
          <span className="hidden sm:inline">Save Quote</span>
        </Button>
        <Button onClick={handleDownloadPDF} disabled={saving || sending} variant="outline" className="flex-1 sm:flex-none h-9 rounded-full sm:rounded-md text-xs sm:text-sm px-3 sm:px-4">
          <Download className="h-4 w-4 mr-1 sm:mr-2" />
          <span className="sm:hidden">PDF</span>
          <span className="hidden sm:inline">Download PDF</span>
        </Button>
        <Button
          onClick={handleSaveAndSend}
          disabled={saving || sending}
          className="flex-1 sm:flex-none h-9 rounded-full sm:rounded-md text-xs sm:text-sm px-3 sm:px-4 bg-green-600 hover:bg-green-700 text-white"
        >
          <Send className="h-4 w-4 mr-1 sm:mr-2" />
          <span className="sm:hidden">WhatsApp</span>
          <span className="hidden sm:inline">Save &amp; Send on WhatsApp</span>
        </Button>
      </div>

      {/* Hidden printable quotation document */}
      <QuotationReceipt
        ref={receiptRef}
        shopName={shopSettings?.general?.shopName || shopSettings?.shopName || 'Business Name'}
        shopLogo={shopSettings?.general?.logo || shopSettings?.logo}
        shopPhone={shopSettings?.general?.phone || shopSettings?.phone}
        shopEmail={shopSettings?.general?.email || shopSettings?.email}
        shopAddress={shopSettings?.general?.address || shopSettings?.address}
        quotationNumber={savedQuote?.quotationNumber || 'DRAFT'}
        date={new Date()}
        validUntil={validUntil}
        customerName={selectedCustomer?.name || ''}
        customerPhone={selectedCustomer?.phone || ''}
        customerEmail={selectedCustomer?.email || ''}
        items={receiptItems}
        subtotal={subtotal}
        discount={cartDiscount}
        total={total}
        notes={notes}
        terms={shopSettings?.quotationTerms}
        mpesaPaybill={shopSettings?.mpesaPaybill}
        mpesaAccountNumber={shopSettings?.mpesaAccountNumber}
        bankDetails={shopSettings?.bankDetails}
        website={shopSettings?.website}
        paperSize="A4"
      />

      {/* Create customer dialog */}
      <Dialog open={showCreateCustomer} onOpenChange={setShowCreateCustomer}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Create Customer
            </DialogTitle>
            <DialogDescription>
              Add a real customer record to quote against.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Name *</Label>
              <Input
                value={newCustomer.name}
                onChange={(e) => setNewCustomer(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Jane Wanjiru"
                autoFocus
              />
            </div>
            <div>
              <Label>Phone (WhatsApp)</Label>
              <Input
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="e.g. 0712 345 678"
              />
            </div>
            <div>
              <Label>Email (optional)</Label>
              <Input
                type="email"
                value={newCustomer.email}
                onChange={(e) => setNewCustomer(prev => ({ ...prev, email: e.target.value }))}
                placeholder="e.g. jane@example.com"
              />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowCreateCustomer(false)} disabled={creatingCustomer}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleCreateCustomer} disabled={creatingCustomer}>
              {creatingCustomer ? 'Creating…' : 'Create Customer'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Determine which preset (if any) the current validUntil matches.
function presetDays(date: Date): number | null {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const v = new Date(date)
  v.setHours(0, 0, 0, 0)
  const diff = Math.round((v.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  return EXPIRY_PRESETS.find(p => p.days === diff) ? diff : null
}
