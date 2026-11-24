'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Check, Send, Download, Plus, Trash2, RotateCcw,
  ShoppingCart, MessageCircle, Package, Pencil,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatProductName } from '@/lib/format-product-name'
import { format } from 'date-fns'
import { PermissionGuard } from '@/components/auth/permission-guard'
import { QuotationReceipt, QuotationReceiptRef } from '@/components/quotations/quotation-receipt'

interface QuoteItem {
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  discount: number
  lineTotal: number
  checked?: boolean
  removed?: boolean
}

interface Quotation {
  _id: string
  quotationNumber: string
  customerId: string
  customerName: string
  customerPhone: string
  customerEmail: string
  items: QuoteItem[]
  subtotal: number
  discount: number
  total: number
  validUntil: string
  notes: string
  sentAt?: string | null
  status: string
  createdAt: string
}

interface Product {
  _id: string
  productName: string
  brand?: string
  variant?: string
  sellingPrice: number
  stock: number
}

function formatPhone(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '')
  if (digits.startsWith('0') && digits.length === 10) return '254' + digits.slice(1)
  if (digits.startsWith('254')) return digits
  return digits
}

const lineOf = (i: QuoteItem) => i.lineTotal ?? i.quantity * i.unitPrice - (i.discount || 0)

export default function QuotationDetailPage() {
  return (
    <PermissionGuard requiredPermission="core.quotations">
      <ChecklistPage />
    </PermissionGuard>
  )
}

function ChecklistPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const receiptRef = useRef<QuotationReceiptRef>(null)

  const [quotation, setQuotation] = useState<Quotation | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [shopSettings, setShopSettings] = useState<any>(null)
  const [showAddItem, setShowAddItem] = useState(false)
  const [showRemoved, setShowRemoved] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [productSearch, setProductSearch] = useState('')

  const itemsRef = useRef<QuoteItem[]>([])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    try {
      const [qRes, sRes] = await Promise.all([
        fetch(`/api/quotations/${id}`),
        fetch('/api/settings'),
      ])
      if (qRes.ok) {
        const data = await qRes.json()
        setQuotation(data.quotation)
      } else {
        toast.error('Quotation not found')
      }
      if (sRes.ok) {
        const data = await sRes.json()
        setShopSettings(data.settings || {})
      }
    } catch {
      toast.error('Failed to load quotation')
    } finally {
      setLoading(false)
    }
  }

  const items = quotation?.items ?? []
  useEffect(() => { itemsRef.current = items }, [items])

  // Derived totals from item checklist state.
  const activeItems = useMemo(() => items.filter(i => !i.removed), [items])
  const subtotal = useMemo(() => activeItems.reduce((s, i) => s + lineOf(i), 0), [activeItems])
  const total = Math.max(0, subtotal - (quotation?.discount || 0))
  const paid = useMemo(
    () => activeItems.filter(i => i.checked).reduce((s, i) => s + lineOf(i), 0),
    [activeItems]
  )
  const remaining = Math.max(0, total - paid)
  const progress = total > 0 ? Math.round((paid / total) * 100) : 0

  const remainingItems = items.map((i, idx) => ({ i, idx })).filter(x => !x.i.checked && !x.i.removed)
  const boughtItems = items.map((i, idx) => ({ i, idx })).filter(x => x.i.checked && !x.i.removed)
  const removedItems = items.map((i, idx) => ({ i, idx })).filter(x => x.i.removed)

  const statusLabel =
    total === 0 ? 'Empty'
    : remaining === 0 ? 'Fully Paid'
    : paid === 0 ? 'Unpaid'
    : 'Partially Paid'
  const statusTone =
    statusLabel === 'Fully Paid' ? 'bg-green-100 text-green-800'
    : statusLabel === 'Partially Paid' ? 'bg-amber-100 text-amber-800'
    : statusLabel === 'Unpaid' ? 'bg-blue-100 text-blue-800'
    : 'bg-gray-100 text-gray-800'

  function mutateItem(idx: number, patch: Partial<QuoteItem>) {
    setQuotation(prev => {
      if (!prev) return prev
      const next = [...prev.items]
      next[idx] = { ...next[idx], ...patch }
      return { ...prev, items: next }
    })
    scheduleSave()
  }

  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveItems(itemsRef.current), 500)
  }

  async function saveItems(updatedItems: QuoteItem[]) {
    if (!quotation) return
    setSaving(true)
    try {
      const res = await fetch(`/api/quotations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: quotation.customerId,
          customerName: quotation.customerName,
          customerPhone: quotation.customerPhone,
          customerEmail: quotation.customerEmail,
          items: updatedItems.map(i => ({
            productId: i.productId,
            productName: i.productName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            discount: i.discount,
            checked: !!i.checked,
            removed: !!i.removed,
          })),
          discount: quotation.discount || 0,
          validUntil: quotation.validUntil,
          notes: quotation.notes || '',
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        toast.error(d.error || 'Failed to save')
        load()
      }
    } catch {
      toast.error('Failed to save')
      load()
    } finally {
      setSaving(false)
    }
  }

  async function fetchProducts() {
    try {
      const res = await fetch('/api/products')
      if (res.ok) {
        const data = await res.json()
        setProducts(data.products || [])
      }
    } catch { /* ignore */ }
  }

  function addItem(product: Product) {
    if (!quotation) return
    setQuotation(prev => prev ? {
      ...prev,
      items: [...prev.items, {
        productId: product._id,
        productName: formatProductName(product),
        quantity: 1,
        unitPrice: product.sellingPrice,
        discount: 0,
        lineTotal: product.sellingPrice,
        checked: false,
        removed: false,
      }],
    } : prev)
    scheduleSave()
    setShowAddItem(false)
    setProductSearch('')
    toast.success('Item added')
  }

  async function handleSendWhatsApp() {
    if (!quotation) return
    if (!quotation.customerPhone) {
      toast.error('Customer has no phone number')
      return
    }
    try {
      const res = await fetch(`/api/quotations/${id}/share`, { method: 'POST' })
      if (!res.ok) {
        toast.error('Failed to create share link')
        return
      }
      const data = await res.json()
      const origin = shopSettings?.general?.publicBaseUrl || window.location.origin
      const url = `${origin}/q/${data.shareToken}`
      const shopName = shopSettings?.general?.shopName || shopSettings?.shopName || 'Our Shop'
      const msg =
        `*${shopName.toUpperCase()} QUOTATION*\n` +
        `Quote: ${quotation.quotationNumber}\n` +
        `Total: KSh ${total.toLocaleString()}\n` +
        `Paid: KSh ${paid.toLocaleString()} | Remaining: KSh ${remaining.toLocaleString()}\n\n` +
        `View full quotation & download PDF:\n${url}\n\n` +
        `Valid until ${format(new Date(quotation.validUntil), 'd MMM yyyy')}`
      window.open(`https://wa.me/${formatPhone(quotation.customerPhone)}?text=${encodeURIComponent(msg)}`, '_blank')
      load()
    } catch {
      toast.error('Failed to send')
    }
  }

  function handleDownloadPDF() {
    receiptRef.current?.print()
  }

  function handlePushToCart() {
    if (!quotation) return
    const unchecked = items.filter(i => !i.checked && !i.removed)
    if (unchecked.length === 0) {
      toast.info('No unpaid items to push')
      return
    }
    const cartItems = unchecked.map(i => ({
      productId: i.productId,
      productName: i.productName,
      sellingPrice: i.unitPrice,
      quantity: i.quantity,
      discount: i.discount || 0,
    }))
    sessionStorage.setItem('quotationCart', JSON.stringify(cartItems))
    sessionStorage.setItem('quotationDiscount', String(quotation.discount || 0))
    sessionStorage.setItem('quotationCustomer', JSON.stringify({
      name: quotation.customerName,
      phone: quotation.customerPhone,
      email: quotation.customerEmail,
    }))
    window.location.href = '/dashboard/sales?from=quotation'
  }

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading…</div>
  }
  if (!quotation) {
    return <div className="p-8 text-center text-muted-foreground">Quotation not found.</div>
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-3xl mx-auto">
      {/* Top: back + number + status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/quotations')}>
            <ArrowLeft className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Back</span>
          </Button>
          <h1 className="text-lg sm:text-2xl font-bold truncate">{quotation.quotationNumber}</h1>
          {saving && <span className="text-xs text-muted-foreground">saving…</span>}
        </div>
        <Badge className={statusTone}>{statusLabel}</Badge>
      </div>

      {/* Customer line */}
      <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
        <span className="font-medium text-foreground">{quotation.customerName}</span>
        {quotation.customerPhone && (
          <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{quotation.customerPhone}</span>
        )}
        <span>·</span>
        <span>Valid until {format(new Date(quotation.validUntil), 'd MMM yyyy')}</span>
      </div>

      {/* Summary card */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-xs text-muted-foreground">Total</div>
              <div className="text-base sm:text-lg font-bold">KSh {total.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Paid</div>
              <div className="text-base sm:text-lg font-bold text-green-700">KSh {paid.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Remaining</div>
              <div className="text-base sm:text-lg font-bold text-red-600">KSh {remaining.toLocaleString()}</div>
            </div>
          </div>
          {/* Progress bar */}
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-green-600 transition-all" style={{ width: `${progress}%` }} />
          </div>
          {/* Quick actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={handleSendWhatsApp} className="bg-green-600 hover:bg-green-700 text-white">
              <Send className="h-3.5 w-3.5 mr-1.5" /> WhatsApp Update
            </Button>
            <Button size="sm" variant="outline" onClick={handleDownloadPDF}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> PDF
            </Button>
            <Button size="sm" variant="outline" onClick={() => router.push(`/dashboard/quotations/${id}/edit`)}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit Items
            </Button>
            <Button size="sm" variant="outline" onClick={() => { fetchProducts(); setShowAddItem(true) }}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Item
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Remaining items */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Remaining / Unpaid ({remainingItems.length})</h2>
        </div>
        {remainingItems.length === 0 ? (
          <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-4 text-center">
            No unpaid items. Tick items below to mark them paid.
          </p>
        ) : (
          <div className="space-y-2">
            {remainingItems.map(({ i, idx }) => (
              <ItemRow
                key={idx}
                item={i}
                onTick={() => mutateItem(idx, { checked: true })}
                onRemove={() => mutateItem(idx, { removed: true })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bought items */}
      {boughtItems.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Bought / Paid ({boughtItems.length})</h2>
          <div className="space-y-2">
            {boughtItems.map(({ i, idx }) => (
              <ItemRow
                key={idx}
                item={i}
                paid
                onUncheck={() => mutateItem(idx, { checked: false })}
                onRemove={() => mutateItem(idx, { removed: true })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Removed items (collapsible) */}
      {removedItems.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowRemoved(v => !v)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <span>Removed ({removedItems.length})</span>
            <span className="text-xs">{showRemoved ? 'hide' : 'show'}</span>
          </button>
          {showRemoved && (
            <div className="space-y-2">
              {removedItems.map(({ i, idx }) => (
                <ItemRow
                  key={idx}
                  item={i}
                  removed
                  onRestore={() => mutateItem(idx, { removed: false })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sticky checkout bar */}
      <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 border-t bg-background/95 backdrop-blur flex items-center justify-between gap-3">
        <div className="text-sm">
          <span className="text-muted-foreground">Push unpaid: </span>
          <span className="font-semibold">{remainingItems.length} item{remainingItems.length !== 1 ? 's' : ''}</span>
          <span className="text-muted-foreground"> · KSh {remaining.toLocaleString()}</span>
        </div>
        <Button onClick={handlePushToCart} disabled={remainingItems.length === 0}>
          <ShoppingCart className="h-4 w-4 mr-2" />
          Push Unchecked to Cart
        </Button>
      </div>

      {/* Hidden printable receipt (status-aware) */}
      <QuotationReceipt
        ref={receiptRef}
        shopName={shopSettings?.general?.shopName || shopSettings?.shopName || 'Business Name'}
        shopLogo={shopSettings?.general?.logo || shopSettings?.logo}
        shopPhone={shopSettings?.general?.phone || shopSettings?.phone}
        shopEmail={shopSettings?.general?.email || shopSettings?.email}
        shopAddress={shopSettings?.general?.address || shopSettings?.address}
        quotationNumber={quotation.quotationNumber}
        date={new Date(quotation.createdAt)}
        validUntil={new Date(quotation.validUntil)}
        customerName={quotation.customerName}
        customerPhone={quotation.customerPhone}
        customerEmail={quotation.customerEmail}
        items={items}
        subtotal={subtotal}
        discount={quotation.discount || 0}
        total={total}
        paid={paid}
        remaining={remaining}
        notes={quotation.notes}
        terms={shopSettings?.quotationTerms}
        mpesaPaybill={shopSettings?.mpesaPaybill}
        mpesaAccountNumber={shopSettings?.mpesaAccountNumber}
        bankDetails={shopSettings?.bankDetails}
        website={shopSettings?.website}
        paperSize="A4"
      />

      {/* Add item dialog */}
      <Dialog open={showAddItem} onOpenChange={setShowAddItem}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add item to quotation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Search products…"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
            />
            <div className="border rounded-lg max-h-72 overflow-y-auto">
              {products
                .filter(p => {
                  if (!productSearch.trim()) return true
                  const q = productSearch.toLowerCase()
                  return formatProductName(p).toLowerCase().includes(q)
                })
                .slice(0, 50)
                .map(p => (
                  <button
                    key={p._id}
                    onClick={() => addItem(p)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted text-left border-b last:border-b-0"
                  >
                    <span className="text-sm truncate">{formatProductName(p)}</span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">stk {p.stock} · KSh {p.sellingPrice.toLocaleString()}</span>
                  </button>
                ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Single item row ──────────────────────────────────────────────────────────
function ItemRow({
  item, paid, removed, onTick, onUncheck, onRemove, onRestore,
}: {
  item: QuoteItem
  paid?: boolean
  removed?: boolean
  onTick?: () => void
  onUncheck?: () => void
  onRemove?: () => void
  onRestore?: () => void
}) {
  const struck = !!paid || !!removed
  return (
    <div className={cn(
      'flex items-center gap-3 border rounded-lg px-3 py-2.5',
      removed ? 'bg-muted/40' : paid ? 'bg-green-50/50' : 'bg-background'
    )}>
      {/* Tick square */}
      {removed ? (
        <button
          type="button"
          onClick={onRestore}
          title="Restore"
          className="h-7 w-7 shrink-0 rounded-md border border-dashed flex items-center justify-center text-muted-foreground hover:bg-muted"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      ) : paid ? (
        <button
          type="button"
          onClick={onUncheck}
          title="Mark unpaid"
          className="h-7 w-7 shrink-0 rounded-md bg-green-600 text-white flex items-center justify-center"
        >
          <Check className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onTick}
          title="Mark paid"
          className="h-7 w-7 shrink-0 rounded-md border-2 border-muted-foreground/30 hover:border-green-600 hover:bg-green-50"
        />
      )}

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className={cn('text-sm font-medium leading-tight', struck && 'line-through text-muted-foreground')}>
          {item.productName}
          {removed && <span className="ml-1 text-xs text-red-600">(Removed)</span>}
        </div>
        <div className="text-xs text-muted-foreground">
          {item.quantity} × KSh {item.unitPrice.toLocaleString()}
          {item.discount ? ` · disc ${item.discount.toLocaleString()}` : ''}
        </div>
      </div>

      {/* Total + remove */}
      <span className="text-sm font-semibold shrink-0">KSh {lineOf(item).toLocaleString()}</span>
      {!removed && (
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={onRemove} title="Remove">
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      )}
    </div>
  )
}
