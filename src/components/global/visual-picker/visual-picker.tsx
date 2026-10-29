/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: VisualPicker, VisualPickerProps, VisualRow,
 *   SwapDrawer, ONE_ROW_PER_PARAGRAPH, SELECTION_IS_THE_SERVER_S,
 *   LICENCE_IS_ON_EVERY_TILE, FOUR_SOURCES_ONE_WRITE,
 *   UNAVAILABLE_IS_EXPLAINED, GLOBAL_MEANS_CONFIGURABLE
 *
 * WHAT:  The per-paragraph visual list and the drawer that changes one: search
 *        stock again, describe an image, upload your own, or fall back to the
 *        styled background.
 *
 * WHY:   ONE_ROW_PER_PARAGRAPH. The list is built from the SCRIPT, so a
 *        five-paragraph script always shows five rows — including the ones
 *        playing on the background. A list of only the paragraphs that got a
 *        picture is the version a customer reads as broken, because the thing
 *        they came here to fix is precisely the paragraph that has none.
 *
 *        SELECTION_IS_THE_SERVER_S, the same rule the background picker
 *        follows. There is no local "chosen" state: every row renders what
 *        `aiImages.list` says, and a swap invalidates the query. A local
 *        optimistic selection would be the one thing capable of disagreeing
 *        with the video — and here it would disagree while an ingest is still
 *        running, which is exactly when a customer is watching.
 *
 *        LICENCE_IS_ON_EVERY_TILE is the phase's step 8 ("show the licence on
 *        each candidate"), and it is free to honour because `license` is a
 *        REQUIRED field on a candidate — a tile cannot be built without one.
 *        The same string is shown on the ROW afterwards, so the answer to
 *        "what am I allowed to do with this" survives past the moment of
 *        choosing.
 *
 *        FOUR_SOURCES_ONE_WRITE. The drawer's four tabs all end in the same
 *        `setBlockVisual` call with a different `choice`, which is what keeps
 *        the four paths honest: there is no tab that writes a row by a
 *        different route, so the server's checks apply identically to all of
 *        them (SET_IS_THE_BOUNDARY).
 *
 *        UNAVAILABLE_IS_EXPLAINED. When a deployment has no stock key the
 *        search tab says so instead of showing an empty grid, and the image tab
 *        does the same — because "no clips match your search" and "this
 *        deployment cannot search" are different sentences and a component
 *        cannot tell them apart from an empty array. The server reports both
 *        flags for that reason (AVAILABILITY_IS_TOLD_NOT_GUESSED).
 *
 *        GLOBAL_MEANS_CONFIGURABLE: `onSelect` is the slot that matters.
 *        Without it this component owns the write, which is what the generate
 *        screen wants; with it the caller does, which is what Phase 15's editor
 *        will want when it has a document in hand and its own revision rules.
 *        `actions` is a second slot for whatever a host screen needs in the
 *        header. Nothing here is project-shaped beyond the two ids.
 * WHERE: src/components/global/visual-picker. Mounted by the generate screen,
 *        `src/app/(dashboard)/dashboard/projects/[id]/generate`.
 */

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ImageIcon,
  LoaderIcon,
  SearchIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { trpc } from "@/trpc/react-provider";
import { useActiveOrganization } from "@/hooks/use-active-organization";
import { MediaUpload } from "@/components/global/media-upload";
import { useUpgradeModal } from "@/components/global/upgrade-modal";
import { permissions } from "@/lib/permissions";
import type { PlanKey } from "@/lib/config/plans";
import {
  VISUAL_PROMPT_MAX_CHARS,
  VISUAL_QUERY_MAX_CHARS,
  maxUploadBytesForPlan,
  type StockCandidate,
  type VisualChoice,
  type VisualSource,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

/**
 * SOURCE OF TRUTH KEYWORDS: VisualPickerProps, GLOBAL_MEANS_CONFIGURABLE
 *
 * WHAT:  Everything a caller can steer, and nothing it has to.
 * WHY:   See GLOBAL_MEANS_CONFIGURABLE in the file header.
 * WHERE: The generate screen passes the two ids and `disabled`.
 */
export interface VisualPickerProps {
  organizationId: string;
  projectId: string;
  /** True while a generation is running — a change cannot take effect yet. */
  disabled?: boolean;
  title?: string;
  description?: string;
  className?: string;
  /** Replaces the built-in write. See GLOBAL_MEANS_CONFIGURABLE. */
  onSelect?: (blockId: string, choice: VisualChoice) => void;
  /** A slot for whatever a host screen wants beside the heading. */
  actions?: React.ReactNode;
}

/**
 * SOURCE OF TRUTH KEYWORDS: SOURCE_LABELS, A_BADGE_SAYS_WHERE_IT_CAME_FROM
 *
 * What each source is called on a row. A full `Record` over the union, so a
 * fifth source cannot ship without somebody deciding what a customer sees —
 * and worded as provenance rather than as mechanism: "Generated" rather than
 * "ai_image", because the question a customer is answering when they look at
 * this badge is whether they may publish it.
 */
const SOURCE_LABELS: Readonly<Record<VisualSource, string>> = {
  stock: "Stock clip",
  ai_image: "Generated",
  upload: "Your file",
  background: "Background",
};

/* The two inline forms. Both are zod-validated per CLAUDE.md rule 5, and both
 * mirror the server's own caps so a refusal happens before a request. */
const searchFormSchema = z.object({
  query: z.string().trim().min(2).max(VISUAL_QUERY_MAX_CHARS),
});

const promptFormSchema = z.object({
  prompt: z.string().trim().min(8).max(VISUAL_PROMPT_MAX_CHARS),
});

export function VisualPicker({
  organizationId,
  projectId,
  disabled = false,
  title = "Visuals",
  description = "What appears on screen behind each paragraph. Change any of them before you generate.",
  className,
  onSelect,
  actions,
}: VisualPickerProps) {
  const { hasPermission } = useActiveOrganization();
  const canChange = hasPermission(permissions.AI_IMAGES_GENERATE);

  const utils = trpc.useUtils();
  const [openBlockId, setOpenBlockId] = React.useState<string | null>(null);

  const listInput = { organizationId, projectId };
  const list = trpc.aiImages.list.useQuery(listInput, { retry: false });

  const setVisual = trpc.aiImages.setBlockVisual.useMutation({
    onSuccess: async (result) => {
      setOpenBlockId(null);
      /* SELECTION_IS_THE_SERVER_S — the row re-renders from the server, which
       * is also how a `pending` status (an ingest still running) shows up. */
      await utils.aiImages.list.invalidate(listInput);
      toast.success(
        result.status === "pending"
          ? "Fetching that visual — it will appear here in a moment."
          : "That paragraph will play on the styled background.",
      );
    },
    onError: (error) => toast.error(error.message),
  });

  const openBlock =
    list.data?.blocks.find((block) => block.blockId === openBlockId) ?? null;

  function choose(blockId: string, choice: VisualChoice) {
    if (onSelect !== undefined) {
      onSelect(blockId, choice);
      setOpenBlockId(null);
      return;
    }
    setVisual.mutate({ organizationId, projectId, blockId, choice });
  }

  return (
    <Card className={className}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          {actions}
        </div>

        {list.data !== undefined && (
          <VisualCostLine
            cost={list.data.cost}
            imagesRemaining={list.data.imagesRemaining}
            imagesLimit={list.data.imagesLimit}
            imagesUsed={list.data.imagesUsed}
          />
        )}
      </CardHeader>

      <CardContent className="space-y-2">
        {list.isPending && (
          <div className="space-y-2">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-20 w-full" />
            ))}
          </div>
        )}

        {list.error !== null && !list.isPending && (
          <p className="text-sm text-muted-foreground">
            The visuals for this project could not be loaded.
          </p>
        )}

        {list.data?.blocks.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Write a script first — visuals are chosen per paragraph.
          </p>
        )}

        {list.data?.blocks.map((block) => (
          <VisualRow
            key={block.blockId}
            block={block}
            disabled={disabled || !canChange || setVisual.isPending}
            onChange={() => setOpenBlockId(block.blockId)}
          />
        ))}
      </CardContent>

      <Dialog
        open={openBlock !== null}
        onOpenChange={(next) => {
          if (!next) setOpenBlockId(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {openBlock !== null && list.data !== undefined && (
            <SwapDrawer
              organizationId={organizationId}
              projectId={projectId}
              block={openBlock}
              stockAvailable={list.data.stockAvailable}
              imagesAvailable={list.data.imagesAvailable}
              imagesRemaining={list.data.imagesRemaining}
              upgradeMessage={list.data.upgradeMessage}
              plan={list.data.plan}
              pending={setVisual.isPending}
              onChoose={choose}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: VisualCostLine, COST_ON_THE_BUTTON
 *
 * WHAT:  The itemised cost of the images this project will generate, and how
 *        many the plan has left.
 * WHY:   COST_ON_THE_BUTTON is the phase's step 9 — the review step "itemises
 *        'N images' in the breakdown" — and the lines come from the server,
 *        which built them with the SAME estimator that holds and settles the
 *        credits. A total computed in this component would be a second price.
 *
 *        It renders nothing at all when there is nothing to charge, which is
 *        the common case: a script whose every paragraph matched a stock clip
 *        costs no credits, and a "0 credits" row is a line a customer has to
 *        stop and interpret.
 * WHERE: The card header.
 */
function VisualCostLine({
  cost,
  imagesRemaining,
  imagesLimit,
  imagesUsed,
}: {
  cost: { total: number; lines: readonly { label: string; credits: number }[] };
  imagesRemaining: number;
  imagesLimit: number | null;
  imagesUsed: number;
}) {
  const allowance =
    imagesLimit === null
      ? null
      : `${Math.max(0, imagesLimit - imagesUsed)} of ${imagesLimit} images left this month`;

  if (cost.total === 0 && allowance === null) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {cost.lines.map((line) => (
        <span key={line.label}>
          {line.label} · {line.credits} credits
        </span>
      ))}
      {cost.total > 0 && (
        <span className="font-medium text-foreground">
          {cost.total} credits
        </span>
      )}
      {allowance !== null && <span>{allowance}</span>}
      {imagesRemaining === 0 && imagesLimit !== null && imagesLimit > 0 && (
        <span>Top up to generate more.</span>
      )}
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: VisualRow, A_ROW_IS_A_PARAGRAPH,
 *   STATUS_IS_VISIBLE
 *
 * WHAT:  One paragraph: its poster, which paragraph it is, where the picture
 *        came from, and what to do about it.
 *
 * WHY:   STATUS_IS_VISIBLE. A `pending` row says it is being fetched and a
 *        `failed` row says why, because both are states a customer will see:
 *        the ingest runs after the swap returns, so a row is briefly pending
 *        every single time, and a refused prompt or an unreachable clip leaves
 *        one failed. A row that showed only the happy state would make an
 *        ordinary two-second wait look like a bug.
 * WHERE: The card body.
 */
function VisualRow({
  block,
  disabled,
  onChange,
}: {
  block: {
    blockId: string;
    position: number;
    excerpt: string;
    source: VisualSource;
    status: "pending" | "ready" | "failed";
    license: string | null;
    attribution: string | null;
    error: string | null;
    posterUrl: string | null;
  };
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <div className="relative flex h-20 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
        {block.posterUrl !== null ? (
          /* eslint-disable-next-line @next/next/no-img-element -- a signed,
             short-lived URL from our own bucket; next/image would proxy it. */
          <img
            src={block.posterUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : block.status === "pending" ? (
          <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <ImageIcon className="size-4 text-muted-foreground" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            Paragraph {block.position}
          </span>
          <Badge variant="secondary">{SOURCE_LABELS[block.source]}</Badge>
          {block.status === "pending" && (
            <span className="text-xs text-muted-foreground">Fetching…</span>
          )}
        </div>

        <p className="truncate text-sm text-muted-foreground">
          {block.excerpt}
        </p>

        {/* LICENCE_IS_ON_EVERY_TILE, kept past the moment of choosing. */}
        {block.license !== null && (
          <p className="text-xs text-muted-foreground">
            {block.license}
            {block.attribution !== null ? ` · ${block.attribution}` : ""}
          </p>
        )}

        {block.status === "failed" && block.error !== null && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <TriangleAlertIcon className="mt-0.5 size-3 shrink-0" />
            {block.error}
          </p>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onChange}
        disabled={disabled}
      >
        Change
      </Button>
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: SwapDrawer, FOUR_SOURCES_ONE_WRITE,
 *   UNAVAILABLE_IS_EXPLAINED, SWAP_IS_ONE_BLOCK
 *
 * WHAT:  The four ways to change one paragraph's visual.
 *
 * WHY:   FOUR_SOURCES_ONE_WRITE — the tabs are the phase's own list ("re-search
 *        stock, re-prompt the image, upload their own, or fall back to the
 *        background") and all four end in one `onChoose` call. The component
 *        has no idea what the write does, which is what lets the picker be
 *        mounted over a caller's own mutation (GLOBAL_MEANS_CONFIGURABLE).
 *
 *        SWAP_IS_ONE_BLOCK is visible in the signature: this drawer is
 *        constructed for ONE block and has no way to address another, so
 *        "changing one paragraph leaves the others alone" is not something it
 *        could get wrong.
 *
 *        The search box is seeded with the query the automatic plan proposed
 *        and the prompt box with its prompt, because the most common edit is a
 *        tweak of what the model suggested rather than a blank start — and
 *        re-deriving either would mean a second model call to ask the same
 *        question twice.
 * WHERE: The dialog in `VisualPicker`.
 */
function SwapDrawer({
  organizationId,
  projectId,
  block,
  stockAvailable,
  imagesAvailable,
  imagesRemaining,
  upgradeMessage,
  plan,
  pending,
  onChoose,
}: {
  organizationId: string;
  projectId: string;
  block: {
    blockId: string;
    position: number;
    excerpt: string;
    query: string | null;
    prompt: string | null;
  };
  stockAvailable: boolean;
  imagesAvailable: boolean;
  imagesRemaining: number;
  upgradeMessage: string;
  plan: PlanKey;
  pending: boolean;
  onChoose: (blockId: string, choice: VisualChoice) => void;
}) {
  const upgradeModal = useUpgradeModal();

  const searchForm = useForm<z.infer<typeof searchFormSchema>>({
    resolver: zodResolver(searchFormSchema),
    defaultValues: { query: block.query ?? "" },
  });
  const promptForm = useForm<z.infer<typeof promptFormSchema>>({
    resolver: zodResolver(promptFormSchema),
    defaultValues: { prompt: block.prompt ?? "" },
  });

  /* Submitted query rather than the field's live value: a search per keystroke
   * is a request per keystroke against a shared third-party quota. */
  const [query, setQuery] = React.useState(block.query ?? "");

  const search = trpc.aiImages.searchStock.useQuery(
    { organizationId, projectId, blockId: block.blockId, query },
    { enabled: stockAvailable && query.trim().length >= 2, retry: false },
  );

  const maxBytes = maxUploadBytesForPlan(plan);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Paragraph {block.position}</DialogTitle>
        <DialogDescription>{block.excerpt}</DialogDescription>
      </DialogHeader>

      <Tabs defaultValue="stock" className="mt-2">
        <TabsList>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="image">Generate</TabsTrigger>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="background">Background</TabsTrigger>
        </TabsList>

        {/* ── STOCK ─────────────────────────────────────────────────────── */}
        <TabsContent value="stock" className="space-y-3">
          {!stockAvailable ? (
            /* UNAVAILABLE_IS_EXPLAINED — not an empty grid. */
            <p className="text-sm text-muted-foreground">
              Stock footage is not configured on this deployment. Generate an
              image instead, upload your own, or leave the paragraph on the
              styled background.
            </p>
          ) : (
            <>
              <Form {...searchForm}>
                <form
                  onSubmit={searchForm.handleSubmit((values) =>
                    setQuery(values.query),
                  )}
                  className="flex items-start gap-2"
                >
                  <FormField
                    control={searchForm.control}
                    name="query"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="city traffic night"
                            maxLength={VISUAL_QUERY_MAX_CHARS}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" variant="secondary">
                    <SearchIcon className="size-4" />
                    Search
                  </Button>
                </form>
              </Form>

              {search.isFetching && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[0, 1, 2, 3, 4, 5].map((key) => (
                    <Skeleton key={key} className="aspect-[9/16] w-full" />
                  ))}
                </div>
              )}

              {!search.isFetching && search.data?.candidates.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nothing matched those words. Try fewer, plainer nouns.
                </p>
              )}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {search.data?.candidates.map((candidate) => (
                  <CandidateTile
                    key={`${candidate.provider}-${candidate.providerId}`}
                    candidate={candidate}
                    disabled={pending}
                    onPick={() =>
                      onChoose(block.blockId, {
                        source: "stock",
                        ...candidate,
                      })
                    }
                  />
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* ── GENERATE ──────────────────────────────────────────────────── */}
        <TabsContent value="image" className="space-y-3">
          {!imagesAvailable ? (
            <p className="text-sm text-muted-foreground">
              Image generation is not configured on this deployment.
            </p>
          ) : imagesRemaining === 0 ? (
            /* LOCKED_NOT_HIDDEN, applied to a counter: the tab stays, says why,
               and offers the upgrade — a hidden tab is an upsell nobody sees. */
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {upgradeMessage}
              </p>
              <Button
                variant="secondary"
                onClick={() => upgradeModal.open({ resource: "aiImages" })}
              >
                <SparklesIcon className="size-4" />
                See plans
              </Button>
            </div>
          ) : (
            <Form {...promptForm}>
              <form
                onSubmit={promptForm.handleSubmit((values) =>
                  onChoose(block.blockId, {
                    source: "ai_image",
                    prompt: values.prompt,
                    /* The server recomputes the cache key and ignores this —
                     * a client that could choose it could point this paragraph
                     * at another prompt's image. Sent because the contract
                     * requires it; never trusted. */
                    promptHash: "pending",
                  }),
                )}
                className="space-y-3"
              >
                <FormField
                  control={promptForm.control}
                  name="prompt"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={4}
                          maxLength={VISUAL_PROMPT_MAX_CHARS}
                          placeholder="A lone researcher at a desk lit by three monitors, late at night, shot from behind."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  No real people, brands or logos — the model is asked for a
                  generic subject, and prompts are checked before they are sent.
                </p>
                <Button type="submit" disabled={pending}>
                  <SparklesIcon className="size-4" />
                  Generate this image
                </Button>
              </form>
            </Form>
          )}
        </TabsContent>

        {/* ── UPLOAD ────────────────────────────────────────────────────── */}
        <TabsContent value="upload">
          {/* UPLOAD_TILE_IS_THE_SHARED_COMPONENT — the same drop zone the
              background picker uses, which already carries the storage gate,
              the accept list and the refusal copy. */}
          <MediaUpload
            organizationId={organizationId}
            maxBytes={maxBytes}
            kind="image"
            title="Upload a picture or clip for this paragraph"
            onUploaded={(assetId) =>
              onChoose(block.blockId, { source: "upload", assetId })
            }
          />
        </TabsContent>

        {/* ── BACKGROUND ────────────────────────────────────────────────── */}
        <TabsContent value="background" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This paragraph plays over the project&apos;s background — the
            footage you chose, or the styled gradient if you chose none. It
            costs nothing and always works.
          </p>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              onChoose(block.blockId, { source: "background" })
            }
          >
            Use the background
          </Button>
        </TabsContent>
      </Tabs>
    </>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: CandidateTile, LICENCE_IS_ON_EVERY_TILE
 *
 * WHAT:  One search result: its poster, its licence, and who to credit.
 * WHY:   The licence is rendered on the TILE rather than in a tooltip or a
 *        details panel, because the phase asks for it on each candidate and
 *        because it is the one thing a customer needs BEFORE choosing — a
 *        licence discovered after the clip is in a published video is a licence
 *        discovered too late.
 * WHERE: The stock tab's grid.
 */
function CandidateTile({
  candidate,
  disabled,
  onPick,
}: {
  candidate: StockCandidate;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className={cn(
        "group overflow-hidden rounded-md border text-left transition-colors",
        "hover:border-primary focus-visible:border-primary focus-visible:outline-none",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <div className="aspect-[9/16] w-full bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- a third
            party's poster frame; next/image would proxy somebody else's CDN. */}
        <img
          src={candidate.previewUrl}
          alt=""
          className="h-full w-full object-cover"
        />
      </div>
      <div className="space-y-0.5 p-2">
        <p className="truncate text-xs font-medium">{candidate.license}</p>
        {candidate.attribution !== undefined && (
          <p className="truncate text-xs text-muted-foreground">
            {candidate.attribution}
          </p>
        )}
        {candidate.durationSec !== undefined && (
          <p className="text-xs text-muted-foreground">
            {Math.round(candidate.durationSec)}s
          </p>
        )}
      </div>
    </button>
  );
}
