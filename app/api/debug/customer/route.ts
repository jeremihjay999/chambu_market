import { getTenantDB } from '@/lib/tenant/get-db'
import { getAuthPayload } from '@/lib/jwt'
import { NextRequest, NextResponse } from 'next/server'
import { Types } from 'mongoose'

// GET /api/debug/customer?id=<customerId>
// Returns raw customer + their active deposits for diagnosis.
export async function GET(request: NextRequest) {
  try {
    const payload = await getAuthPayload()
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (!id || !Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Provide ?id=<customerId>' }, { status: 400 })
    }

    const { models } = await getTenantDB(request)
    const ownerId = payload.type === 'staff' && payload.adminId ? payload.adminId : payload.userId

    const customer = await models.Customer.findOne({ _id: id, userId: ownerId }).lean() as any
    if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const deposits = await models.Deposit.find({
      userId: ownerId,
      customerId: new Types.ObjectId(id),
    }).lean()

    const sales = await models.Sale.find({
      userId: ownerId,
      customerId: new Types.ObjectId(id),
      voidedAt: null,
    }).select('orderNumber total debt paymentStatus payments createdAt').lean()

    return NextResponse.json({
      customer: {
        _id:           customer._id,
        name:          customer.name,
        creditBalance: customer.creditBalance,
        depositBalance: customer.depositBalance,
        ledger:        customer.ledger,
      },
      deposits,
      sales,
    })
  } catch (err) {
    console.error('[debug/customer]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// PATCH /api/debug/customer?id=<customerId>
// Body: { creditBalance?: number, depositBalance?: number }
// Direct balance correction for data repair. Owner-only.
export async function PATCH(request: NextRequest) {
  try {
    const payload = await getAuthPayload()
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (payload.type === 'staff') return NextResponse.json({ error: 'Owner only' }, { status: 403 })

    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (!id || !Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Provide ?id=<customerId>' }, { status: 400 })
    }

    const { models } = await getTenantDB(request)
    const ownerId = payload.userId
    const body = await request.json()

    const customerUpdate: any = {}
    if (typeof body.creditBalance === 'number')  customerUpdate.creditBalance  = body.creditBalance
    if (typeof body.depositBalance === 'number') customerUpdate.depositBalance = body.depositBalance

    // consumeDeposit: marks a specific deposit as fully used and zeroes it
    // body.consumeDeposit = depositId string
    if (body.consumeDeposit && Types.ObjectId.isValid(body.consumeDeposit)) {
      const deposit = await models.Deposit.findOne({
        _id: new Types.ObjectId(body.consumeDeposit),
        userId: ownerId,
      })
      if (!deposit) return NextResponse.json({ error: `Deposit ${body.consumeDeposit} not found` }, { status: 404 })

      deposit.consumptions = deposit.consumptions || []
      deposit.consumptions.push({
        amount: deposit.balance,
        date: new Date(),
        consumedBy: new Types.ObjectId(payload.userId),
        consumedByModel: 'User',
        note: 'Manual repair — balance correction',
      })
      deposit.balance = 0
      deposit.status = 'used'
      await deposit.save()
      console.log(`[debug/customer] Deposit ${deposit.receiptNo} marked as used`)
    }

    if (Object.keys(customerUpdate).length === 0 && !body.consumeDeposit) {
      return NextResponse.json({ error: 'Provide creditBalance, depositBalance, and/or consumeDeposit' }, { status: 400 })
    }

    let customer = null
    if (Object.keys(customerUpdate).length > 0) {
      customer = await models.Customer.findOneAndUpdate(
        { _id: id, userId: ownerId },
        { $set: customerUpdate },
        { new: true }
      )
      if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      console.log(`[debug/customer] Balance corrected for ${customer.name}:`, customerUpdate)
    }

    return NextResponse.json({
      ok: true,
      customer: customer ? {
        _id: customer._id,
        name: customer.name,
        creditBalance: customer.creditBalance,
        depositBalance: customer.depositBalance,
      } : null,
    })
  } catch (err) {
    console.error('[debug/customer] PATCH error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
