/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: ComposerScreen, THE_COMPOSER_IS_ONE_FIELD,
 *   composerSchema, projects.create, scripts.generate, scripts.estimateCost,
 *   COST_ON_THE_BUTTON, WRITE_IT_FOR_ME, THIS_IS_MY_SCRIPT, FeatureGate
 *
 * WHAT:  The "What's your video about?" screen — one big field for a script
 *        or an idea, the length and tone it should be written to, and the two
 *        ways out: have it written, or keep what you pasted.
 *
 * WHY:   THE_COMPOSER_IS_ONE_FIELD. This replaces a side sheet that asked for
 *        a title, a format, an aspect ratio and a source URL before anything
 *        happened — four questions, none of which is the one the customer
 *        arrived with. The title is derived from what they type, the format
 *        came from the card they clicked, and the aspect has a sensible
 *        default, so the screen asks only what it genuinely cannot infer.
 *
 *        TWO ACTIONS, BOTH REAL, and the difference between them is who
 *        writes the words:
 *        WRITE_IT_FOR_ME creates the project and runs `scripts.generate` over
 *        the text as a source — this is the one that costs credits.
 *        THIS_IS_MY_SCRIPT creates the project and stores what was pasted
 *        VERBATIM as the first script block, then opens the editor. It costs
 *        nothing and calls no model. It is three round trips (create, add an
 *        empty block, fill it) because the API has no "import a script"
 *        endpoint; one endpoint would make it one, and that is the obvious
 *        next backend change.
 *
 *        COST_ON_THE_BUTTON: the price is read from `scripts.estimateCost`,
 *        the SAME estimator the server charges from, and it re-reads when the
 *        length changes because the cost is derived from the word budget.
 *        A hardcoded "100 credits" would be a number that silently stops
 *        being true. The button also knows whether the workspace can afford
 *        it, so the refusal happens before the project is created rather than
 *        halfway through.
 *
 *        THE PROJECT IS CREATED FIRST, and that ordering is deliberate: both
 *        actions commit a draft before doing anything slow or expensive, so a
 *        generation that fails leaves a project the customer can retry from
 *        instead of losing what they typed.
 *
 * WHERE: Rendered by src/app/(dashboard)/dashboard/new/page.tsx, which is
 *        where the home screen's format cards now navigate. Format copy comes
 *        from src/lib/config/formats.ts.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { ArrowLeftIcon, CircleHelpIcon, Loader2Icon } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { FORMATS } from "@/lib/config";
import { ROUTES } from "@/lib/config";
import { permissions } from "@/lib/permissions";
import {
  COMPOSER_LENGTHS,
  composerSchema,
  type ComposerValues,
  type CreatableProjectKind,
} from "@/lib/types";
import {
  useActiveOrganization,
  useActiveOrganizationId,
} from "@/hooks/use-active-organization";
import { trpc } from "@/trpc/react-provider";
import { FeatureGate } from "@/components/feature-gate";
import { AuthError } from "@/components/global/auth/auth-error";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { CATEGORY_CLASSES } from "../../_components";
import { ComposerSettingPill } from "./composer-setting-pill";
import { TRY_ONE_PROMPTS } from "./composer-content";
import { HowItWorksDialog } from "./how-it-works-dialog";
import { YourVideos } from "./your-videos";

/** How each length reads in the pill. Derived keys, so the two cannot drift. */
const LENGTH_LABELS: Record<(typeof COMPOSER_LENGTHS)[number], string> = {
  30: "Up to 30s",
  60: "Up to 1 min",
  90: "Up to 90s",
  180: "Up to 3 min",
};

/* The four tones `scripts.generate` accepts, in plain words. The VALUES are
 * the enum; only the labels live here (see the note on composerSchema). */
const TONE_LABELS = {
  casual: "Casual",
  educational: "Educational",
  dramatic: "Dramatic",
  hype: "Hype",
} as const;

export interface ComposerScreenProps {
  kind: CreatableProjectKind;
}

export function ComposerScreen({ kind }: ComposerScreenProps) {
  const router = useRouter();
  const organizationId = useActiveOrganizationId();
  const { hasPermission } = useActiveOrganization();
  const format = FORMATS[kind];
  const category = CATEGORY_CLASSES[format.category];

  const [howItWorksOpen, setHowItWorksOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"write" | "mine" | null>(null);

  const form = useForm<ComposerValues>({
    resolver: zodResolver(composerSchema),
    mode: "onSubmit",
    defaultValues: { prompt: "", targetSeconds: 180, tone: "educational" },
  });

  /* useWatch, not form.watch(): the React Compiler refuses to memoize a
   * component that calls watch(), because it hands back a function whose
   * result it cannot track. The same note is on the create-project sheet. */
  const targetSeconds = useWatch({
    control: form.control,
    name: "targetSeconds",
  });
  const tone = useWatch({ control: form.control, name: "tone" });

  const createProject = trpc.projects.create.useMutation();
  const generateScript = trpc.scripts.generate.useMutation();
  const addBlock = trpc.scripts.addBlock.useMutation();
  const updateBlock = trpc.scripts.updateBlock.useMutation();

  /* COST_ON_THE_BUTTON — the same estimator the server charges from, so the
   * price on the button and the amount actually taken cannot disagree.
   *
   * The placeholder `projectId` is load-bearing to understand: the price is a
   * function of `targetSeconds` ALONE (scriptCostFor), the handler never
   * loads the project, and the procedure factory gates on organizationId and
   * permissions rather than on any project. There is no project yet at this
   * point in the flow — it is created when the button is pressed — so there
   * is nothing honest to send. If `estimateCost` ever starts reading the
   * project, this call has to become a plain cost query instead. */
  const { data: estimate } = trpc.scripts.estimateCost.useQuery(
    {
      organizationId: organizationId ?? "",
      projectId: "estimate",
      targetSeconds,
    },
    { enabled: organizationId !== undefined, staleTime: 60 * 1000 },
  );

  const canCreate = hasPermission(permissions.PROJECTS_CREATE);
  const affordable = estimate?.affordable ?? true;

  /* The project's title. A video is remembered by what it is ABOUT, so the
   * first line of the prompt is a far better name than "Untitled project" —
   * and asking for one up front is the question this screen exists to remove.
   * Trimmed to the column's limit; the editor can rename it. */
  function titleFrom(prompt: string): string {
    const firstLine = prompt.split("\n").find((line) => line.trim().length > 0);
    const candidate = (firstLine ?? prompt).trim();
    return candidate.length > 80 ? `${candidate.slice(0, 77)}…` : candidate;
  }

  async function startProject(values: ComposerValues) {
    if (!organizationId) return null;
    return createProject.mutateAsync({
      organizationId,
      title: titleFrom(values.prompt),
      kind,
      aspect: "9:16",
    });
  }

  async function onWriteItForMe(values: ComposerValues) {
    if (!organizationId || busy !== null) return;
    setError(null);
    setBusy("write");
    try {
      const project = await startProject(values);
      if (!project) return;
      /* A pasted link is a URL source; anything else is text. Deciding here
       * rather than asking means the field accepts both without a mode
       * switch, which is what makes it ONE field. */
      const value = values.prompt.trim();
      const isUrl = /^https?:\/\/\S+$/i.test(value);
      await generateScript.mutateAsync({
        organizationId,
        projectId: project.id,
        source: isUrl ? { kind: "url", value } : { kind: "text", value },
        tone: values.tone,
        targetSeconds: values.targetSeconds,
      });
      router.push(`/dashboard/projects/${project.id}/script` as Route);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not start that video. Try again.",
      );
      setBusy(null);
    }
  }

  async function onThisIsMyScript(values: ComposerValues) {
    if (!organizationId || busy !== null) return;
    setError(null);
    setBusy("mine");
    try {
      const project = await startProject(values);
      if (!project) return;
      /* Verbatim, as one block. Splitting it into hook/body/cta is a judgement
       * only the writer can make, and guessing at paragraph breaks would
       * silently restructure somebody's script. The editor splits it. */
      const block = await addBlock.mutateAsync({
        organizationId,
        projectId: project.id,
        sectionType: "body",
      });
      await updateBlock.mutateAsync({
        organizationId,
        id: block.id,
        narrationText: values.prompt.trim(),
      });
      router.push(`/dashboard/projects/${project.id}/script` as Route);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save that script. Try again.",
      );
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-7">
      {/* ── Breadcrumb ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 text-sm"
        >
          <Link
            href={ROUTES.dashboard}
            className="inline-flex items-center gap-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ArrowLeftIcon className="size-4" aria-hidden="true" />
            Formats
          </Link>
          <span aria-hidden="true" className="text-muted-foreground-2">
            /
          </span>
          <span className="inline-flex items-center gap-2 font-medium text-foreground">
            <span
              aria-hidden="true"
              className={cn("size-2 rounded-[2px]", category.dot)}
            />
            {format.label}
          </span>
        </nav>

        {/* EXPLAINER_IS_ON_DEMAND — opposite the breadcrumb, where it is out
            of the way of the field but always in the same corner. */}
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => setHowItWorksOpen(true)}
          className="h-10 gap-2 rounded-full px-4 text-sm font-medium"
        >
          <CircleHelpIcon className="size-4" aria-hidden="true" />
          How it works
        </Button>
      </div>

      <HowItWorksDialog
        open={howItWorksOpen}
        onOpenChange={setHowItWorksOpen}
      />

      <h1 className="font-display text-[2.75rem] font-extrabold leading-none tracking-tight text-foreground lg:text-[3.25rem]">
        What&apos;s your video{" "}
        <span className="relative inline-block px-3 py-0.5">
          <span
            aria-hidden="true"
            className="brand-highlight absolute inset-0 rounded-xl"
          />
          <span className="relative text-brand-accent-foreground">about</span>
        </span>
        ?
      </h1>

      <Form {...form}>
        <form className="flex flex-col gap-5">
          {/* ── The composer card ────────────────────────────────────── */}
          <div className="rounded-[22px] border border-border bg-card p-5">
            <FormField
              control={form.control}
              name="prompt"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={6}
                      aria-label="Your script or idea"
                      placeholder="Paste your script, or describe an idea."
                      disabled={busy !== null}
                      className="min-h-44 resize-none border-0 bg-transparent px-1 text-lg leading-relaxed text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0 md:text-lg"
                    />
                  </FormControl>
                  <FormMessage className="px-1" />
                </FormItem>
              )}
            />

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <ComposerSettingPill
                label="Length"
                value={LENGTH_LABELS[targetSeconds]}
                options={COMPOSER_LENGTHS.map((seconds) => ({
                  value: String(seconds),
                  label: LENGTH_LABELS[seconds],
                }))}
                selected={String(targetSeconds)}
                onSelect={(next) =>
                  form.setValue(
                    "targetSeconds",
                    Number(next) as ComposerValues["targetSeconds"],
                  )
                }
                disabled={busy !== null}
              />
              <ComposerSettingPill
                label="Tone"
                value={TONE_LABELS[tone]}
                options={Object.entries(TONE_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
                selected={tone}
                onSelect={(next) =>
                  form.setValue("tone", next as ComposerValues["tone"])
                }
                disabled={busy !== null}
              />
            </div>

            <AuthError error={error} />

            {canCreate ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  onClick={() => void form.handleSubmit(onThisIsMyScript)()}
                  disabled={busy !== null}
                  className="h-11 rounded-xl px-4 text-[15px] font-medium text-foreground"
                >
                  {busy === "mine" ? (
                    <Loader2Icon
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  This is my script
                </Button>

                <FeatureGate resource="projects">
                  <Button
                    type="button"
                    size="lg"
                    onClick={() => void form.handleSubmit(onWriteItForMe)()}
                    disabled={busy !== null || !affordable}
                    aria-busy={busy === "write"}
                    className="h-11 gap-2.5 rounded-xl bg-primary px-4 text-[15px] font-semibold text-primary-foreground"
                  >
                    {busy === "write" ? (
                      <Loader2Icon
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : null}
                    Write it for me
                    {estimate ? (
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 text-[13px] font-medium",
                          affordable
                            ? "bg-black/20 text-primary-foreground"
                            : "bg-destructive/20 text-primary-foreground",
                        )}
                      >
                        {estimate.cost.total} credits
                      </span>
                    ) : null}
                  </Button>
                </FeatureGate>

                {!affordable && estimate ? (
                  <p className="text-sm text-muted-foreground">
                    You have {estimate.balance.toLocaleString()} credits.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* ── Try one ──────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-sm text-muted-foreground">Try one:</span>
            {TRY_ONE_PROMPTS[kind].map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() =>
                  form.setValue("prompt", suggestion, {
                    shouldValidate: true,
                  })
                }
                disabled={busy !== null}
                className="rounded-full border border-border-strong px-4 py-2.5 text-sm text-foreground-2 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </form>
      </Form>

      <YourVideos />
    </div>
  );
}
