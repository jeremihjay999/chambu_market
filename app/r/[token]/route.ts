import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getAdminModels } from '@/lib/admin-models'
import { connectTenantDB } from '@/lib/db-tenant'
import { isMongoOfflineError } from '@/lib/tenant/get-db'
import { connectDB } from '@/lib/db'
import { getModels } from '@/lib/tenant/get-models'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { ReceiptDocument } from '@/lib/pdf/receipt-document'
import { resolveMediaUrl } from '@/lib/media-url'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    // Resolve token → tenant connection
    const { SaleShare } = await getAdminModels()
    const share = (await SaleShare.findOne({ shareToken: token }).lean()) as any
    if (!share) {
      return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
    }

    let conn: mongoose.Connection
    if (share.mongoUri) {
      try {
        conn = await connectTenantDB(share.mongoUri)
      } catch (err) {
        if (isMongoOfflineError(err) && share.mongoUriFallback) {
          conn = await connectTenantDB(share.mongoUriFallback)
        } else {
          throw err
        }
      }
    } else {
      await connectDB()
      conn = mongoose.connection
    }

    const models = getModels(conn)
    const sale = (await models.Sale.findById(share.saleId).lean()) as any
    if (!sale) {
      return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
    }

    // Shop info from owner settings
    const user    = (await models.User.findById(sale.userId).lean()) as any
    const s: any  = user?.settings || {}
    const general = s.general || s.shop || {}
    const payment = s.payment  || {}
    const features = s.features || {}

    // Branch info — use branch phone/address over global settings when available
    let branchName = ''
    let branchPhone = ''
    let branchAddress = ''
    if (sale.branchId) {
      const branch = (await models.Branch.findById(sale.branchId).lean()) as any
      if (branch) {
        branchName    = branch.name    || ''
        branchPhone   = branch.phone   || (branch.phones?.[0] ?? '') || ''
        branchAddress = branch.address || ''
      }
    }

    const shop = {
      shopName:           general.shopName || user?.shopName || '',
      logo:               general.logo ? resolveMediaUrl(general.logo) : '',
      // Branch contact takes priority over global settings
      phone:              branchPhone  || general.phone  || user?.phone  || '',
      email:              general.email  || user?.email  || '',
      address:            branchAddress || general.address || '',
      mpesaPaybill:       payment.mpesaPaybill       || s.mpesaPaybill       || '',
      mpesaAccountNumber: payment.mpesaAccountNumber || s.mpesaAccountNumber || '',
      termsEnabled:       !!features.termsEnabled,
      termsText:          features.termsText || '',
    }

    // Cashier name
    let cashierName = shop.shopName
    if (sale.staffId) {
      const staff = (await conn.db.collection('staff').findOne({ _id: sale.staffId })) as any
      if (staff) {
        cashierName = [staff.firstName, staff.lastName].filter(Boolean).join(' ') || staff.name || cashierName
      }
    }

    const pdfData = {
      orderNumber:    sale.orderNumber || sale._id.toString().slice(-8).toUpperCase(),
      date:           sale.createdAt?.toISOString?.() || new Date().toISOString(),
      customerName:   sale.customerName || undefined,
      customerPhone:  (sale.customerId as any)?.phone || undefined,
      branchName,
      items: (sale.items || []).map((i: any) => ({
        productName: i.productName,
        brand:       i.brand   || '',
        model:       i.model   || '',
        variant:     i.variant || '',
        quantity:    i.quantity,
        price:       i.price,
        discount:    i.discount || 0,
        total:       i.price * i.quantity - (i.discount || 0),
      })),
      subtotal:       sale.subtotal ?? sale.total,
      discount:       sale.discount || 0,
      total:          sale.total,
      payments:       sale.payments || [],
      paymentMethod:  sale.paymentMethod || '',
      cashierName,
      shop,
    }

    const buffer = await renderToBuffer(
      React.createElement(ReceiptDocument, { data: pdfData })
    )

    const filename = `Receipt-${pdfData.orderNumber}.pdf`

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length':      String(buffer.byteLength),
        'Cache-Control':       'public, max-age=3600',
      },
    })
  } catch (error: any) {
    console.error('[/r/[token] PDF]', error)
    return NextResponse.json(
      { error: 'Failed to generate receipt PDF' },
      { status: 500 }
    )
  }
}
