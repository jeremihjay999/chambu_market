'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Plus, FileText, Eye, Printer, CheckCircle, XCircle, Clock, TrendingUp, DollarSign, ShoppingCart } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { PermissionGuard } from '@/components/auth/permission-guard'
import { QuotationPrintView } from '@/components/quotations/quotation-print-view'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface QuotationItem {
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  lineTotal: number
  discount?: number
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
  status: 'draft' | 'sent' | 'accepted' | 'expired' | 'converted'
  items: QuotationItem[]
  subtotal: number
  discount: number
  total: number
  validUntil: string
  notes: string
  convertedToSaleId?: string
  createdAt: string
}

export default function QuotationsPage() {
  return (
    <PermissionGuard requiredPermission="core.quotations">
      <QuotationsContent />
    </PermissionGuard>
  )
}

function QuotationsContent() {
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const router = useRouter()
  const [selectedQuotation, setSelectedQuotation] = useState<Quotation | null>(null)
  const [showPrintView, setShowPrintView] = useState(false)
  const [showConvertDialog, setShowConvertDialog] = useState(false)
  const [converting, setConverting] = useState(false)

  useEffect(() => {
    loadQuotations()
  }, [])

  useEffect(() => {
    const timer = setTimeout(loadQuotations, 300)
    return () => clearTimeout(timer)
  }, [search, statusFilter])

  async function loadQuotations() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.append('status', statusFilter)
      if (search) params.append('search', search)

      const res = await fetch(`/api/quotations?${params}`)
      if (res.ok) {
        const data = await res.json()
        setQuotations(data.quotations || [])
      } else {
        toast.error('Failed to load quotations')
      }
    } catch (error) {
      toast.error('Error loading quotations')
    }
    setLoading(false)
  }

  function getStatusBadge(status: string) {
    const styles = {
      draft: 'bg-gray-100 text-gray-800',
      sent: 'bg-blue-100 text-blue-800',
      accepted: 'bg-green-100 text-green-800',
      expired: 'bg-red-100 text-red-800',
      converted: 'bg-purple-100 text-purple-800',
    }
    return <Badge className={styles[status as keyof typeof styles] || ''}>{status.toUpperCase()}</Badge>
  }

  function handlePrint(quotation: Quotation) {
    setSelectedQuotation(quotation)
    setShowPrintView(true)
  }

  function handleViewDetails(quotation: Quotation) {
    router.push(`/dashboard/quotations/${quotation._id}`)
  }

  async function handleStatusChange(quotationId: string, newStatus: string) {
    try {
      const res = await fetch(`/api/quotations/${quotationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        toast.success(`Quotation marked as ${newStatus}`)
        loadQuotations()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update quotation')
      }
    } catch (error) {
      toast.error('Error updating quotation')
    }
  }

  async function handleDelete(quotationId: string) {
    if (!confirm('Are you sure you want to delete this quotation?')) return

    try {
      const res = await fetch(`/api/quotations/${quotationId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Quotation deleted')
        loadQuotations()
        setSelectedQuotation(null)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete quotation')
      }
    } catch (error) {
      toast.error('Error deleting quotation')
    }
  }

  function initiateConvert(quotation: Quotation) {
    setSelectedQuotation(quotation)
    setShowConvertDialog(true)
  }

  function handleAddToCart(quotation: Quotation) {
    // Only push active (non-removed, non-checked) items into the POS cart.
    const cartItems = quotation.items
      .filter((item: any) => !item.removed && !item.checked)
      .map(item => ({
        productId: item.productId,
        productName: item.productName,
        sellingPrice: item.unitPrice,
        quantity: item.quantity,
        discount: item.discount || 0,
      }))

    if (cartItems.length === 0) {
      toast.info('No unpaid items to push to cart')
      return
    }

    sessionStorage.setItem('quotationCart', JSON.stringify(cartItems))
    sessionStorage.setItem('quotationDiscount', String(quotation.discount))
    sessionStorage.setItem('quotationCustomer', JSON.stringify({
      name: quotation.customerName,
      phone: quotation.customerPhone,
      email: quotation.customerEmail,
    }))

    toast.success('Quotation items added to cart')
    window.location.href = '/dashboard/sales?from=quotation'
  }

  async function handleConvert() {
    if (!selectedQuotation) return

    setConverting(true)
    try {
      const res = await fetch(`/api/quotations/${selectedQuotation._id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentMethod: 'cash',
          amountPaid: selectedQuotation.total,
          payments: [{
            method: 'cash',
            amount: selectedQuotation.total,
          }]
        }),
      })

      if (res.ok) {
        const data = await res.json()
        toast.success('Quotation converted to sale!')
        setShowConvertDialog(false)
        setSelectedQuotation(null)
        loadQuotations()
      } else {
        const data = await res.json()
        if (data.details && Array.isArray(data.details)) {
          toast.error(`Stock issues: ${data.details.join(', ')}`)
        } else {
          toast.error(data.error || 'Failed to convert quotation')
        }
      }
    } catch (error) {
      toast.error('Error converting quotation')
    }
    setConverting(false)
  }

  // Calculate stats
  const stats = {
    total: quotations.length,
    draft: quotations.filter(q => q.status === 'draft').length,
    sent: quotations.filter(q => q.status === 'sent').length,
    converted: quotations.filter(q => q.status === 'converted').length,
    totalValue: quotations.reduce((sum, q) => sum + q.total, 0),
    pendingValue: quotations
      .filter(q => ['draft', 'sent', 'accepted'].includes(q.status))
      .reduce((sum, q) => sum + q.total, 0),
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold truncate">Quotations</h1>
          <p className="text-muted-foreground hidden sm:block">Create and manage customer quotations</p>
        </div>
        <Button onClick={() => router.push('/dashboard/quotations/new')} className="shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          <span className="hidden sm:inline">New Quotation</span>
          <span className="sm:hidden">New</span>
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Quotations</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.draft + stats.sent}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Converted</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.converted}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">KSh {stats.pendingValue.toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
        <div className="sm:flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search quotations or customers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="converted">Converted</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Quotations list (cards) */}
      <Card>
        <CardContent className="p-2 sm:p-3">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading quotations...</div>
          ) : quotations.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No quotations found. Create your first quotation!
            </div>
          ) : (
            <div className="space-y-2">
              {quotations.map((quotation) => (
                <div
                  key={quotation._id}
                  onClick={() => router.push(`/dashboard/quotations/${quotation._id}`)}
                  className="border rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors flex flex-wrap items-center gap-x-3 gap-y-1.5 cursor-pointer"
                >
                  <span className="font-mono text-sm font-semibold shrink-0">{quotation.quotationNumber}</span>
                  {getStatusBadge(quotation.status)}
                  <div className="min-w-[110px] flex-1">
                    <div className="text-sm font-medium truncate">{quotation.customerName}</div>
                    {quotation.customerPhone && (
                      <div className="text-xs text-muted-foreground truncate">{quotation.customerPhone}</div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground hidden lg:block w-24 shrink-0">
                    {new Date(quotation.createdAt).toLocaleDateString()}
                  </div>
                  <div className="text-xs text-muted-foreground hidden lg:block w-28 shrink-0">
                    valid {new Date(quotation.validUntil).toLocaleDateString()}
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">{quotation.items.length} items</div>
                  <span className="font-semibold text-sm shrink-0">KSh {quotation.total.toLocaleString()}</span>
                  <div className="flex items-center gap-1 ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => handleViewDetails(quotation)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => handlePrint(quotation)}
                    >
                      <Printer className="h-4 w-4" />
                    </Button>
                    {quotation.status !== 'converted' && (
                      <Button
                        variant="default"
                        size="sm"
                        className="h-8"
                        onClick={() => handleAddToCart(quotation)}
                        disabled={quotation.status === 'expired'}
                      >
                        <ShoppingCart className="h-3.5 w-3.5 sm:mr-1.5" />
                        <span className="hidden sm:inline">Add to Cart</span>
                        <span className="sm:hidden">Cart</span>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Print View Dialog */}
      <Dialog open={showPrintView} onOpenChange={setShowPrintView}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogTitle>Print Quotation</DialogTitle>
          {selectedQuotation && (
            <QuotationPrintView quotation={selectedQuotation} />
          )}
        </DialogContent>
      </Dialog>

      {/* Details Dialog */}
      {selectedQuotation && !showPrintView && (
        <Dialog open={!!selectedQuotation} onOpenChange={() => setSelectedQuotation(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Quotation {selectedQuotation.quotationNumber}</DialogTitle>
              <DialogDescription>
                Created on {new Date(selectedQuotation.createdAt).toLocaleDateString()}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold mb-2">Customer</h4>
                <p>{selectedQuotation.customerName}</p>
                {selectedQuotation.customerPhone && <p className="text-sm text-muted-foreground">{selectedQuotation.customerPhone}</p>}
              </div>
              <div>
                <h4 className="font-semibold mb-2">Items</h4>
                <div className="space-y-2">
                  {selectedQuotation.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span>{item.productName} x {item.quantity}</span>
                      <span>KSh {item.lineTotal.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t pt-4">
                <div className="flex justify-between font-semibold">
                  <span>Total:</span>
                  <span>KSh {selectedQuotation.total.toLocaleString()}</span>
                </div>
              </div>
              <div className="flex gap-2">
                {selectedQuotation.status === 'draft' && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      handleStatusChange(selectedQuotation._id, 'sent')
                      setSelectedQuotation(null)
                    }}
                  >
                    Mark as Sent
                  </Button>
                )}
                {selectedQuotation.status === 'sent' && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      handleStatusChange(selectedQuotation._id, 'accepted')
                      setSelectedQuotation(null)
                    }}
                  >
                    Mark as Accepted
                  </Button>
                )}
                {selectedQuotation.status !== 'converted' && (
                  <Button
                    variant="destructive"
                    onClick={() => handleDelete(selectedQuotation._id)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Convert Confirmation Dialog */}
      <Dialog open={showConvertDialog} onOpenChange={setShowConvertDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert to Sale</DialogTitle>
            <DialogDescription>
              This will create a completed sale and deduct stock for all items in this quotation.
            </DialogDescription>
          </DialogHeader>
          {selectedQuotation && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">Quotation: {selectedQuotation.quotationNumber}</p>
                <p className="text-sm text-muted-foreground">Customer: {selectedQuotation.customerName}</p>
                <p className="text-lg font-semibold mt-2">Total: KSh {selectedQuotation.total.toLocaleString()}</p>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setShowConvertDialog(false)} disabled={converting}>
                  Cancel
                </Button>
                <Button onClick={handleConvert} disabled={converting}>
                  {converting ? 'Converting...' : 'Confirm Convert to Sale'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
