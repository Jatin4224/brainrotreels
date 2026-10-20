/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: CreditsScreen, CreditBalanceCard, TopUpPacks,
 *   CreditLedgerTable, LEDGER_EXPLAINS_THE_BALANCE, NO_CARD_NO_PURCHASE,
 *   PACK_UNAVAILABLE_IS_SHOWN
 *
 * WHAT:  The credits screen: what you have, how to get more, and where it all
 *        went.
 *
 * WHY:   LEDGER_EXPLAINS_THE_BALANCE is why the table is here and not an
 *        afterthought. A credit balance goes DOWN ON ITS OWN while renders
 *        run, which no other number in this app does — so without a readable
 *        history the only answer a customer has to "where did my credits go"
 *        is a support ticket. Every row names its kind and, through its
 *        metadata, what it was for.
 *
 *        NO_CARD_NO_PURCHASE: a workspace with no saved card is sent to
 *        Billing rather than shown a dead button. The purchase flow is a
 *        PaymentIntent against an ALREADY-ATTACHED card (there is no Checkout
 *        route in this codebase), so "add a card" genuinely is a different
 *        screen and pretending otherwise would mean a second card-collection
 *        form for one product.
 *
 *        PACK_UNAVAILABLE_IS_SHOWN: a pack whose Stripe price is not
 *        configured renders disabled with the reason, rather than being
 *        filtered out — the same rule as the render panel's locked
 *        resolutions. An operator who configured two of three prices should
 *        SEE the third is missing, not wonder where it went.
 * WHERE: Rendered by /dashboard/settings/credits.
 */

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'

import { trpc } from '@/trpc/react-provider'
import { useActiveOrganization, useActiveOrganizationId } from '@/hooks/use-active-organization'
import { permissions } from '@/lib/permissions'
import { DataTable, type DataTableColumn } from '@/components/global/data-table'
import { PaymentMethodOption } from '@/components/global/billing'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { CreditLedgerKind, CreditPackKey } from '@/lib/types'

/**
 * SOURCE OF TRUTH KEYWORDS: LEDGER_KIND_COPY
 *
 * WHAT:  What each ledger kind says to a customer, and how it reads.
 * WHY:   A full record over CreditLedgerKind, so adding a kind is a compile
 *        error here rather than a raw database word like `commit` appearing in
 *        somebody's billing history. The tone matters as much as the label:
 *        `hold` is not a charge and must not look like one, or every customer
 *        with a render in flight thinks they have been billed twice.
 * WHERE: The ledger table below.
 */
const LEDGER_KIND_COPY: Readonly<
  Record<CreditLedgerKind, { label: string; tone: 'default' | 'secondary' | 'destructive' }>
> = {
  purchase: { label: 'Top-up', tone: 'default' },
  grant: { label: 'Granted', tone: 'default' },
  hold: { label: 'Reserved', tone: 'secondary' },
  commit: { label: 'Used', tone: 'secondary' },
  release: { label: 'Returned', tone: 'default' },
}

function toLedgerKind(value: string): CreditLedgerKind {
  return value in LEDGER_KIND_COPY ? (value as CreditLedgerKind) : 'commit'
}

export function CreditsScreen() {
  const organizationId = useActiveOrganizationId()
  const { hasPermission } = useActiveOrganization()
  const enabled = organizationId !== undefined
  const canPurchase = hasPermission(permissions.CREDITS_PURCHASE)

  if (!enabled) return <Skeleton className="h-64 w-full rounded-xl" />

  return (
    <div className="flex flex-col gap-6">
      <CreditBalanceCard organizationId={organizationId} />
      {canPurchase ? <TopUpPacks organizationId={organizationId} /> : null}
      <CreditLedgerTable organizationId={organizationId} />
    </div>
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: CreditBalanceCard, BALANCE_IS_SPENDABLE
 *
 * WHY:   BALANCE_IS_SPENDABLE — the number shown already has holds deducted,
 *        because a hold IS a negative ledger row. That is the honest number to
 *        put in front of somebody about to start a render, and it is why the
 *        caption says "available" rather than "balance".
 */
function CreditBalanceCard({ organizationId }: { organizationId: string }) {
  const query = trpc.credits.getBalance.useQuery({ organizationId }, { retry: false })

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end justify-between gap-4 py-6">
        <div>
          <p className="text-sm text-muted-foreground">Credits available</p>
          {query.data === undefined ? (
            <Skeleton className="mt-2 h-9 w-24" />
          ) : (
            <p className="mt-1 text-3xl font-semibold text-foreground">
              {query.data.balance.toLocaleString('en-US')}
            </p>
          )}
        </div>
        <p className="max-w-sm text-xs text-muted-foreground">
          Credits are reserved when a render starts and charged at what it
          actually cost. A render that fails returns its credits automatically.
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: TopUpPacks, NO_CARD_NO_PURCHASE, ONE_CLICK_TOP_UP
 *
 * WHY:   ONE_CLICK_TOP_UP. The card is chosen first and the pack second, so a
 *        purchase is one click on the pack rather than a dialog — a top-up is
 *        something people do mid-task, between deciding to render and
 *        rendering, and a modal in that moment is a modal they abandon.
 */
function TopUpPacks({ organizationId }: { organizationId: string }) {
  const utils = trpc.useUtils()
  const [selectedCard, setSelectedCard] = React.useState<string | null>(null)
  const [buying, setBuying] = React.useState<CreditPackKey | null>(null)

  const packs = trpc.credits.getPacks.useQuery({ organizationId }, { retry: false })
  const methods = trpc.billing.getPaymentMethods.useQuery({ organizationId }, { retry: false })

  const purchase = trpc.credits.purchase.useMutation({
    onSuccess: (result) => {
      toast.success(`${result.credits.toLocaleString('en-US')} credits added`, {
        description: `You now have ${result.balance.toLocaleString('en-US')} credits.`,
      })
      void utils.credits.invalidate()
    },
    onError: (error) => {
      toast.error('That top-up did not go through', { description: error.message })
    },
    onSettled: () => setBuying(null),
  })

  /* The default card, preselected — the one Stripe would charge anyway. A
   * `useState` seeded from a query would be stale on first paint, so the
   * choice is DERIVED and an explicit click wins. Same pattern and same reason
   * as CHOICE_IS_DERIVED_NOT_SYNCED on the render panel. */
  const cards = methods.data ?? []
  const activeCard = selectedCard ?? cards.find((card) => card.isDefault)?.id ?? cards[0]?.id ?? null

  if (methods.isPending || packs.isPending) {
    return <Skeleton className="h-48 w-full rounded-xl" />
  }

  /* NO_CARD_NO_PURCHASE — a different screen, said plainly. */
  if (cards.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buy credits</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">
            Add a payment method before buying credits.
          </p>
          {/* A styled Link rather than <Button asChild> — this Button has no
              `asChild`, and the element has to be a real anchor so the route
              prefetches like every other internal link. */}
          <Link
            href="/dashboard/settings/billing"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Go to Billing
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Buy credits</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">Pay with</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {cards.map((card) => (
              <PaymentMethodOption
                key={card.id}
                method={card}
                selected={activeCard === card.id}
                onSelect={setSelectedCard}
              />
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {(packs.data ?? []).map((pack) => (
            <div
              key={pack.key}
              className="flex flex-col gap-3 rounded-xl border border-border p-4"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{pack.label}</p>
                <p className="text-2xl font-semibold text-foreground">
                  {pack.credits.toLocaleString('en-US')}
                </p>
                <p className="text-xs text-muted-foreground">credits</p>
              </div>

              <Button
                size="sm"
                /* PACK_UNAVAILABLE_IS_SHOWN — disabled with the reason, not
                   hidden. An operator missing one price should see which. */
                disabled={!pack.available || activeCard === null || buying !== null}
                onClick={() => {
                  if (activeCard === null) return
                  setBuying(pack.key)
                  purchase.mutate({
                    organizationId,
                    packKey: pack.key,
                    paymentMethodId: activeCard,
                  })
                }}
              >
                {buying === pack.key ? 'Charging…' : 'Buy'}
              </Button>

              {!pack.available ? (
                <p className="text-xs text-muted-foreground">
                  Not configured for purchase yet.
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: CreditLedgerTable, LEDGER_EXPLAINS_THE_BALANCE
 *
 * WHY:   Built on the Phase 00 `<DataTable>` rather than a bespoke table, so
 *        pagination, loading, empty and error states are the ones every other
 *        list in this app already has. The columns are the only thing this
 *        screen contributes.
 */
function CreditLedgerTable({ organizationId }: { organizationId: string }) {
  const [page, setPage] = React.useState(1)

  const query = trpc.credits.listLedger.useQuery(
    { organizationId, page },
    { retry: false, placeholderData: (previous) => previous },
  )

  type Row = NonNullable<typeof query.data>['rows'][number]

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'kind',
      header: 'Event',
      cell: (row) => {
        const copy = LEDGER_KIND_COPY[toLedgerKind(row.kind)]
        return <Badge variant={copy.tone}>{copy.label}</Badge>
      },
    },
    {
      id: 'detail',
      header: 'Detail',
      cell: (row) => <span className="text-muted-foreground">{describeRow(row)}</span>,
    },
    {
      id: 'delta',
      header: 'Credits',
      cell: (row) => (
        /* The sign is kept rather than rendered as "added/removed", because a
         * ledger that shows signed numbers can be checked by adding them up —
         * which is exactly what somebody querying their balance wants to do. */
        <span
          className={row.delta >= 0 ? 'font-medium text-foreground' : 'text-muted-foreground'}
        >
          {row.delta > 0 ? `+${row.delta}` : row.delta}
        </span>
      ),
    },
    {
      id: 'createdAt',
      header: 'When',
      cell: (row) => (
        <span className="text-muted-foreground">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={query.data?.rows ?? []}
      getRowId={(row) => row.id}
      total={query.data?.total ?? 0}
      page={page}
      pageSize={20}
      totalPages={query.data?.totalPages ?? 1}
      onPageChange={setPage}
      isLoading={query.isPending}
      isFetching={query.isFetching}
      error={query.error?.message ?? null}
      countLabel={['entry', 'entries']}
      empty={
        <>
          <p className="font-medium text-foreground">No credit activity yet</p>
          <p className="mt-1">Every top-up and every render will appear here.</p>
        </>
      }
    />
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: describeRow, METADATA_MAKES_A_ROW_READABLE
 *
 * WHAT:  The one-line explanation of a ledger row.
 * WHY:   METADATA_MAKES_A_ROW_READABLE. Without this a customer sees "-12"
 *        and has no way to connect it to anything they did. The metadata is
 *        written by whatever moved the credits, so this reads it defensively —
 *        it is JSON from the database, it may have been written by an older
 *        release, and a missing field must degrade to a vaguer sentence rather
 *        than crash the table.
 * WHERE: The `detail` column above.
 */
function describeRow(row: { kind: string; metadata: unknown; refId: string | null }): string {
  const meta = isRecord(row.metadata) ? row.metadata : {}

  const packKey = typeof meta['packKey'] === 'string' ? meta['packKey'] : null
  if (packKey !== null) return `${packKey} pack`

  const reason = typeof meta['reason'] === 'string' ? meta['reason'] : null
  if (reason !== null) return reason

  const kind = typeof meta['kind'] === 'string' ? meta['kind'] : null
  const resolution = typeof meta['resolution'] === 'string' ? meta['resolution'] : null
  if (kind === 'render') {
    return resolution !== null ? `Render at ${resolution}` : 'Render'
  }

  if (row.refId !== null) return `Reference ${row.refId.slice(0, 12)}`
  return '—'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
