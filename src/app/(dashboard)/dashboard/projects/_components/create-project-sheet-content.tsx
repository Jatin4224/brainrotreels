/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: CreateProjectSheetContent, createProjectSchema,
 *   zodResolver, RHF_SHARED_SCHEMA, SOURCE_REF_PER_KIND
 *
 * WHAT:  The new-project form: title, format, aspect, and the one source field
 *        the chosen format needs.
 * WHY:   RHF_SHARED_SCHEMA — the resolver uses createProjectSchema, the SAME
 *        object the router validates with, so the form cannot accept something
 *        the server will reject or vice versa.
 *        SOURCE_REF_PER_KIND: `sourceRef` is one column serving four formats,
 *        so its label and placeholder change with the format and it is hidden
 *        for the one format that has no source. Four nullable columns was the
 *        alternative and it would have meant a schema change per format.
 *        Errors render into local state rather than being thrown, which is what
 *        keeps a refused plan limit a message in the sheet instead of an error
 *        boundary.
 * WHERE: Mounted inside the <Sheet> opened by CreateProjectButton.
 */

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { trpc } from "@/trpc/react-provider";
import {
  ASPECT_RATIOS,
  PROJECT_KINDS,
  createProjectSchema,
  type CreateProjectValues,
  type ProjectKind,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PROJECT_KIND_LABEL } from "./project-filters";

/**
 * SOURCE OF TRUTH KEYWORDS: SOURCE_REF_PER_KIND, SOURCE_FIELD_BY_KIND
 *
 * WHAT:  What `sourceRef` means for each format, as copy — and `null` for the
 *        format that does not use it.
 * WHY:   A full Record over ProjectKind, so a new format cannot ship without
 *        someone deciding what its source is. `motion` is null because a motion
 *        piece is written from a brief in the editor, not generated from a
 *        source — Phase 16 owns that flow.
 * WHERE: The conditional field below.
 */
const SOURCE_FIELD_BY_KIND: Readonly<
  Record<
    ProjectKind,
    { label: string; placeholder: string; description: string } | null
  >
> = {
  "reddit-story": {
    label: "Reddit post URL",
    placeholder: "https://www.reddit.com/r/AmItheAsshole/comments/...",
    description:
      "The post to narrate. You can paste the story text instead later.",
  },
  voiceover: {
    label: "Topic or article URL",
    placeholder: "Why most morning routines fail",
    description: "A topic to write from, or a link to summarise.",
  },
  quiz: {
    label: "Quiz topic",
    placeholder: "Capital cities of South America",
    description: "The subject the questions are generated from.",
  },
  motion: null,
};

const ASPECT_LABEL: Readonly<Record<(typeof ASPECT_RATIOS)[number], string>> = {
  "9:16": "9:16 — vertical (TikTok, Reels, Shorts)",
  "1:1": "1:1 — square",
  "16:9": "16:9 — landscape",
};

export function CreateProjectSheetContent({
  organizationId,
  onClose,
}: {
  organizationId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const create = trpc.projects.create.useMutation();
  const [error, setError] = React.useState<string | null>(null);

  const form = useForm<CreateProjectValues>({
    resolver: zodResolver(createProjectSchema),
    mode: "onTouched",
    defaultValues: {
      organizationId,
      title: "",
      kind: "reddit-story",
      aspect: "9:16",
      sourceRef: "",
    },
  });

  /* useWatch, not form.watch(): the React Compiler refuses to memoize a
   * component that calls watch(), because it hands back a function whose
   * result it cannot track (see the react-hooks/incompatible-library rule).
   * useWatch is a hook returning a value, so the subscription is safe. */
  const kind = useWatch({ control: form.control, name: "kind" });
  const sourceField = SOURCE_FIELD_BY_KIND[kind];

  async function onSubmit(values: CreateProjectValues) {
    setError(null);
    try {
      /* A blank source is sent as absent rather than as an empty string: the
       * column is nullable and `''` is not a source. */
      const sourceRef = values.sourceRef?.trim();
      const project = await create.mutateAsync({
        organizationId: values.organizationId,
        title: values.title,
        kind: values.kind,
        aspect: values.aspect,
        ...(sourceRef !== undefined && sourceRef.length > 0
          ? { sourceRef }
          : {}),
      });
      await utils.projects.list.invalidate();
      /* The usage counter the factory bumped drives the plan cards and the
       * create button's own gate, so it has to be refetched too. */
      await utils.usage.invalidate();
      toast.success(`"${project.title}" created`);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create this project.",
      );
    }
  }

  return (
    <SheetContent className="flex flex-col gap-0 sm:max-w-md">
      <SheetHeader>
        <SheetTitle>New project</SheetTitle>
        <SheetDescription>
          Pick a format and we will set the timeline up for it.
        </SheetDescription>
      </SheetHeader>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-2"
          noValidate
        >
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="Gerald the sourdough"
                    autoFocus
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="kind"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Format</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(next) => field.onChange(next ?? field.value)}
                >
                  <FormControl>
                    <SelectTrigger aria-label="Project format">
                      <SelectValue>
                        {(value) =>
                          typeof value === "string"
                            ? kindLabelOf(value)
                            : "Choose a format"
                        }
                      </SelectValue>
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {PROJECT_KINDS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {PROJECT_KIND_LABEL[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="aspect"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Aspect</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(next) => field.onChange(next ?? field.value)}
                >
                  <FormControl>
                    <SelectTrigger aria-label="Aspect ratio">
                      <SelectValue>
                        {(value) =>
                          typeof value === "string"
                            ? aspectLabelOf(value)
                            : "Choose an aspect"
                        }
                      </SelectValue>
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ASPECT_RATIOS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {ASPECT_LABEL[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {sourceField !== null ? (
            <FormField
              control={form.control}
              name="sourceRef"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{sourceField.label}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      placeholder={sourceField.placeholder}
                    />
                  </FormControl>
                  <FormDescription>{sourceField.description}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}

          {error !== null ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </Form>

      <SheetFooter>
        <Button variant="outline" onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button
          onClick={form.handleSubmit(onSubmit)}
          disabled={create.isPending}
        >
          {create.isPending ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : null}
          Create project
        </Button>
      </SheetFooter>
    </SheetContent>
  );
}

/* Widened lookups — see the same note in project-filters.tsx. */
const KIND_LOOKUP: Readonly<Record<string, string>> = PROJECT_KIND_LABEL;
const ASPECT_LOOKUP: Readonly<Record<string, string>> = ASPECT_LABEL;

function kindLabelOf(value: string): string {
  return KIND_LOOKUP[value] ?? value;
}

function aspectLabelOf(value: string): string {
  return ASPECT_LOOKUP[value] ?? value;
}
