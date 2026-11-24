'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Check, Download, MessageCircle, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { resolveMediaUrl } from '@/lib/media-url'
import { format } from 'date-fns'
import { QuotationReceipt, QuotationReceiptRef } from '@/components/quotations/quotation-receipt'

interface PublicItem {
  productName: string
  quantity: number
  unitPrice: number
  discount: number
  lineTotal: number
  checked: boolean
  removed: boolean
}

interface PublicQuotation {
  quotationNumber: string
  customerName: string
  items: PublicItem[]
  subtotal: number
  discount: number
  total: number
  paid: number
  remaining: number
  validUntil: string
  createdAt: string
  notes: string
  shop: {
    shopName: string
    logo?: string
    phone?: string
    email?: string
    address?: string
    website?: string
  }
}

const lineOf = (i: PublicItem) => i.lineTotal ?? i.quantity * i.unitPrice - (i.discount || 0)

export default function PublicQuotationPage() {
  const params = useParams()
  const token = params.token as string
  const receiptRef = useRef<QuotationReceiptRef>(null)
  const [quotation, setQuotation] = useState<PublicQuotation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    load()
  }, [token])

  async function load() {
    try {
      const res = await fetch(`/api/quotations/public/${token}`)
      if (!res.ok) { setError(true); return }
      const data = await res.json()
      setQuotation(data.quotation)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  const items = quotation?.items ?? []
  const remainingItems = items.filter(i => !i.checked && !i.removed)
  const boughtItems = items.filter(i => i.checked && !i.removed)
  const removedItems = items.filter(i => i.removed)
  const progress = quotation && quotation.total > 0 ? Math.round((quotation.paid / quotation.total) * 100) : 0
  const statusLabel =
    !quotation ? ''
    : quotation.total === 0 ? 'Empty'
    : quotation.remaining === 0 ? 'Fully Paid'
    : quotation.paid === 0 ? 'Unpaid'
    : 'Partially Paid'

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading…</div>
  }
  if (error || !quotation) {
    return (
      <div className="p-8 text-center space-y-2">
        <Package className="h-8 w-8 mx-auto opacity-50" />
        <p className="text-muted-foreground">This quotation link is not available.</p>
        <p className="text-xs text-muted-foreground">Check the link with the seller, or it may have been removed.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-muted/30 py-6 px-4">
      <div className="max-w-md mx-auto space-y-4">
        {/* Shop header */}
        <div className="text-center space-y-1">
          {quotation.shop.logo && (
            <img src={resolveMediaUrl(quotation.shop.logo)} alt={quotation.shop.shopName} className="h-12 mx-auto object-contain" />
          )}
          <h1 className="text-lg font-bold">{quotation.shop.shopName || 'Business'}</h1>
          {(quotation.shop.phone || quotation.shop.address) && (
            <p className="text-xs text-muted-foreground">
              {[quotation.shop.phone, quotation.shop.address].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        {/* Quotation meta */}
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-sm font-semibold">{quotation.quotationNumber}</div>
            <div className="text-xs text-muted-foreground">
              For: {quotation.customerName}
            </div>
          </div>
          <Badge>{statusLabel}</Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          Valid until {format(new Date(quotation.validUntil), 'd MMM yyyy')}
        </div>

        {/* Summary */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-xs text-muted-foreground">Total</div>
                <div className="text-base font-bold">KSh {quotation.total.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Paid</div>
                <div className="text-base font-bold text-green-700">KSh {quotation.paid.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Remaining</div>
                <div className="text-base font-bold text-red-600">KSh {quotation.remaining.toLocaleString()}</div>
              </div>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-green-600" style={{ width: `${progress}%` }} />
            </div>
          </CardContent>
        </Card>

        {/* Remaining items */}
        {remainingItems.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Remaining ({remainingItems.length})</h2>
            {remainingItems.map((i, idx) => (
              <PublicItemRow key={`r${idx}`} item={i} />
            ))}
          </div>
        )}

        {/* Bought items */}
        {boughtItems.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">Paid ({boughtItems.length})</h2>
            {boughtItems.map((i, idx) => (
              <PublicItemRow key={`b${idx}`} item={i} paid />
            ))}
          </div>
        )}

        {/* Removed items */}
        {removedItems.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">Removed ({removedItems.length})</h2>
            {removedItems.map((i, idx) => (
              <PublicItemRow key={`x${idx}`} item={i} removed />
            ))}
          </div>
        )}

        {/* Notes */}
        {quotation.notes && (
          <div className="border rounded-lg p-3 bg-muted/40">
            <h3 className="text-xs font-semibold mb-1">Notes</h3>
            <p className="text-sm whitespace-pre-wrap">{quotation.notes}</p>
          </div>
        )}

        {/* Download PDF */}
        <Button onClick={() => receiptRef.current?.print()} className="w-full" size="lg">
          <Download className="h-4 w-4 mr-2" />
          Download PDF
        </Button>

        {quotation.shop.website && (
          <p className="text-center text-xs text-muted-foreground pt-2">{quotation.shop.website}</p>
        )}
      </div>

      {/* Hidden printable receipt */}
      <QuotationReceipt
        ref={receiptRef}
        shopName={quotation.shop.shopName}
        shopLogo={quotation.shop.logo}
        shopPhone={quotation.shop.phone}
        shopEmail={quotation.shop.email}
        shopAddress={quotation.shop.address}
        website={quotation.shop.website}
        quotationNumber={quotation.quotationNumber}
        date={new Date(quotation.createdAt)}
        validUntil={new Date(quotation.validUntil)}
        customerName={quotation.customerName}
        items={quotation.items}
        subtotal={quotation.subtotal}
        discount={quotation.discount}
        total={quotation.total}
        paid={quotation.paid}
        remaining={quotation.remaining}
        notes={quotation.notes}
        paperSize="A4"
      />
    </div>
  )
}

function PublicItemRow({ item, paid, removed }: { item: PublicItem; paid?: boolean; removed?: boolean }) {
  const struck = !!paid || !!removed
  return (
    <div className={cn(
      'flex items-center gap-3 border rounded-lg px-3 py-2.5 bg-background',
      removed ? 'bg-muted/40' : paid ? 'bg-green-50/60' : ''
    )}>
      <div className={cn(
        'h-6 w-6 shrink-0 rounded-md flex items-center justify-center',
        removed ? 'border border-dashed text-muted-foreground' : paid ? 'bg-green-600 text-white' : 'border-2 border-muted-foreground/30'
      )}>
        {paid && <Check className="h-3.5 w-3.5" />}
      </div>
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
      <span className="text-sm font-semibold shrink-0">KSh {lineOf(item).toLocaleString()}</span>
    </div>
  )
}
