/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: VoiceCasting, SpeakerPanel, VoicePicker, VoiceCard,
 *   LOCKED_NOT_HIDDEN, PREVIEWS_ARE_NEVER_GATED, NAME_THE_UNASSIGNED,
 *   POLL_WHILE_NARRATING, ONE_AUDIO_AT_A_TIME
 *
 * WHAT:  The casting screen: who speaks, which voice they get, and the
 *        narration those choices produce.
 *
 * WHY:   LOCKED_NOT_HIDDEN. Every voice in the catalogue is rendered; the ones
 *        the plan does not include carry a lock badge and open the upgrade
 *        modal instead of assigning. A voice a customer never sees is one they
 *        have no reason to pay for — and the server refuses the assignment
 *        anyway, so the badge is an affordance rather than the boundary.
 *
 *        PREVIEWS_ARE_NEVER_GATED is the deliberate consequence: a free
 *        workspace can PLAY every premium voice. Hearing what you cannot yet
 *        use is the upsell, and the preview is a pre-rendered asset so it
 *        costs nothing to serve.
 *
 *        NAME_THE_UNASSIGNED — the narrate button is disabled with the
 *        speakers LISTED, which is the phase's own requirement. "Assign a
 *        voice to OP and A" is actionable; "something is wrong" is a support
 *        ticket.
 *
 *        ONE_AUDIO_AT_A_TIME: starting a preview stops the one already
 *        playing. Without it, clicking through a grid of forty voices layers
 *        them, which is both unusable and the kind of thing that only shows up
 *        when somebody actually browses the catalogue.
 * WHERE: Rendered by /dashboard/projects/[id]/voices.
 */

import * as React from "react";
import { toast } from "sonner";

import { trpc } from "@/trpc/react-provider";
import {
  useActiveOrganization,
  useActiveOrganizationId,
} from "@/hooks/use-active-organization";
import { useUpgradeModal } from "@/components/global/upgrade-modal";
import { permissions } from "@/lib/permissions";
import {
  VOICE_ACCENTS,
  VOICE_FILTER_ALL,
  VOICE_FILTER_DEFAULTS,
  VOICE_GENDERS,
  VOICE_TONES,
  normalizeVoiceFilters,
  type VoiceFilterValues,
} from "@/lib/types/voice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

/** Two seconds, matching every other polled surface in this app. */
const NARRATING_POLL_MS = 2000;

export function VoiceCasting({ projectId }: { projectId: string }) {
  const organizationId = useActiveOrganizationId();
  const { hasPermission } = useActiveOrganization();
  const enabled = organizationId !== undefined;

  const canAssign = hasPermission(permissions.VOICES_ASSIGN);

  const [selectedSpeakerId, setSelectedSpeakerId] = React.useState<
    string | null
  >(null);

  const speakers = trpc.voices.speakers.useQuery(
    { organizationId: organizationId ?? "", projectId },
    {
      enabled,
      retry: false,
      placeholderData: (previous) => previous,
      /* POLL_WHILE_NARRATING — the fan-out writes line rows as it goes and
       * nothing pushes that to the browser. Stops by itself when no line is
       * still pending. */
      refetchInterval: (query) =>
        (query.state.data?.narration.pending ?? 0) > 0
          ? NARRATING_POLL_MS
          : false,
    },
  );

  if (!enabled || speakers.isPending) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  const cast = speakers.data?.speakers ?? [];
  const assignments = speakers.data?.assignments;
  const narration = speakers.data?.narration;

  /* The first unassigned speaker is the one somebody most likely wants to
   * cast, so it is preselected — derived rather than synced into state, the
   * same pattern as the render panel's resolution. */
  const activeSpeakerId =
    selectedSpeakerId ??
    cast.find((speaker) => speaker.voiceId === null)?.id ??
    cast[0]?.id ??
    null;

  return (
    <div className="flex flex-col gap-6">
      <SpeakerPanel
        organizationId={organizationId}
        projectId={projectId}
        speakers={cast}
        assignments={assignments}
        narration={narration}
        activeSpeakerId={activeSpeakerId}
        onSelect={setSelectedSpeakerId}
        canAssign={canAssign}
      />

      {cast.length > 0 ? (
        <VoicePicker
          organizationId={organizationId}
          activeSpeakerId={activeSpeakerId}
          canAssign={canAssign}
          onAssigned={() => void speakers.refetch()}
        />
      ) : null}
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: SpeakerPanel, NAME_THE_UNASSIGNED,
 *   ASSIGNMENT_BLOCKS_GENERATION
 */
function SpeakerPanel({
  organizationId,
  projectId,
  speakers,
  assignments,
  narration,
  activeSpeakerId,
  onSelect,
  canAssign,
}: {
  organizationId: string;
  projectId: string;
  speakers: readonly {
    id: string;
    tag: string;
    voiceId: string | null;
    state: string;
  }[];
  assignments:
    | { ok: boolean; unassigned: string[]; hasSpeakers: boolean }
    | undefined;
  narration:
    | { total: number; ready: number; failed: number; pending: number; durationSec: number }
    | undefined;
  activeSpeakerId: string | null;
  onSelect: (id: string) => void;
  canAssign: boolean;
}) {
  const utils = trpc.useUtils();

  const narrate = trpc.voices.narrate.useMutation({
    onSuccess: () => {
      toast.success("Recording your narration", {
        description: "Lines you have not changed are reused and cost nothing.",
      });
      void utils.voices.invalidate();
    },
    onError: (error) =>
      toast.error("Narration could not be started", {
        description: error.message,
      }),
  });

  if (speakers.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No speakers yet</p>
          <p className="mt-1">
            Write a script first — the speakers come from it.
          </p>
        </CardContent>
      </Card>
    );
  }

  const blocked = assignments?.ok !== true;
  const working = (narration?.pending ?? 0) > 0 || narrate.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cast</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {speakers.map((speaker) => (
            <Button
              key={speaker.id}
              type="button"
              size="sm"
              variant={speaker.id === activeSpeakerId ? "default" : "outline"}
              onClick={() => onSelect(speaker.id)}
            >
              {speaker.tag}
              {speaker.voiceId === null ? (
                <span className="ml-1.5 text-xs">· not cast</span>
              ) : null}
            </Button>
          ))}
        </div>

        {/* NAME_THE_UNASSIGNED — the speakers, by name, not a generic error. */}
        {blocked && (assignments?.unassigned.length ?? 0) > 0 ? (
          <Alert>
            <AlertTitle>
              {assignments?.unassigned.length === 1
                ? "One speaker still needs a voice"
                : "Some speakers still need a voice"}
            </AlertTitle>
            <AlertDescription>
              Assign a voice to {assignments?.unassigned.join(", ")} before
              recording.
            </AlertDescription>
          </Alert>
        ) : null}

        {narration !== undefined && narration.total > 0 ? (
          <p className="text-sm text-muted-foreground">
            {narration.ready} of {narration.total} lines recorded
            {narration.failed > 0 ? ` · ${narration.failed} failed` : ""}
            {narration.durationSec > 0
              ? ` · about ${narration.durationSec.toFixed(1)}s`
              : ""}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={!canAssign || blocked || working}
            onClick={() => narrate.mutate({ organizationId, projectId })}
          >
            {working ? "Recording…" : "Record narration"}
          </Button>

          {!canAssign ? (
            <p className="text-xs text-muted-foreground">
              You do not have permission to cast voices in this workspace.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: VoicePicker, LOCKED_NOT_HIDDEN,
 *   CLIENT_SERVER_MIRROR
 */
function VoicePicker({
  organizationId,
  activeSpeakerId,
  canAssign,
  onAssigned,
}: {
  organizationId: string;
  activeSpeakerId: string | null;
  canAssign: boolean;
  onAssigned: () => void;
}) {
  const upgradeModal = useUpgradeModal();
  const utils = trpc.useUtils();
  const [filters, setFilters] = React.useState<VoiceFilterValues>(
    VOICE_FILTER_DEFAULTS,
  );

  /* CLIENT_SERVER_MIRROR — the sentinel never reaches the wire. */
  const query = trpc.voices.list.useQuery(
    normalizeVoiceFilters(organizationId, filters),
    { retry: false, placeholderData: (previous) => previous },
  );

  const assign = trpc.voices.assign.useMutation({
    onSuccess: () => {
      toast.success("Voice assigned");
      onAssigned();
    },
    onError: (error) =>
      toast.error("That voice could not be assigned", {
        description: error.message,
      }),
  });

  /* ONE_AUDIO_AT_A_TIME — a single element, reused, so starting a preview
   * stops the previous one instead of layering it. */
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = React.useState<string | null>(
    null,
  );

  const voices = query.data?.voices ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Voices</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2 sm:grid-cols-4">
          <Input
            placeholder="Search voices…"
            value={filters.search}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                search: event.target.value,
              }))
            }
            aria-label="Search voices"
          />

          <FilterSelect
            label="Gender"
            value={filters.gender}
            options={VOICE_GENDERS}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                gender: value as VoiceFilterValues["gender"],
              }))
            }
          />
          <FilterSelect
            label="Accent"
            value={filters.accent}
            options={VOICE_ACCENTS}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                accent: value as VoiceFilterValues["accent"],
              }))
            }
          />
          <FilterSelect
            label="Tone"
            value={filters.tone}
            options={VOICE_TONES}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                tone: value as VoiceFilterValues["tone"],
              }))
            }
          />
        </div>

        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : voices.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {filters.search.length > 0 ||
            filters.gender !== VOICE_FILTER_ALL ||
            filters.accent !== VOICE_FILTER_ALL ||
            filters.tone !== VOICE_FILTER_ALL
              ? "No voices match those filters."
              : "The voice catalogue is empty. An operator needs to sync it from the portal."}
          </p>
        ) : (
          <div
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            role="radiogroup"
            aria-label="Voice catalogue"
          >
            {voices.map((voice) => (
              <VoiceCard
                key={voice.id}
                voice={voice}
                disabled={!canAssign || activeSpeakerId === null}
                assigning={assign.isPending}
                playing={playingVoiceId === voice.id}
                onPlay={async () => {
                  /* Fetched on demand through the tRPC client, not embedded in
                   * the list payload: the URL is signed per request and short
                   * lived, so forty of them in a list would mostly be expired
                   * by the time anybody clicked one. */
                  const preview = (
                    await utils.voices.preview.fetch({
                      organizationId,
                      voiceId: voice.id,
                    })
                  ).url;
                  if (preview === null) {
                    toast.message("No preview for that voice yet");
                    return;
                  }
                  audioRef.current?.pause();
                  const audio = new Audio(preview);
                  audioRef.current = audio;
                  setPlayingVoiceId(voice.id);
                  audio.addEventListener("ended", () =>
                    setPlayingVoiceId(null),
                  );
                  void audio.play().catch(() => setPlayingVoiceId(null));
                }}
                onAssign={() => {
                  if (activeSpeakerId === null) return;
                  if (voice.locked) {
                    upgradeModal.open({
                      resource: "premiumVoices",
                      ...(query.data?.upgradeMessage !== undefined
                        ? { upgradeMessage: query.data.upgradeMessage }
                        : {}),
                    });
                    return;
                  }
                  assign.mutate({
                    organizationId,
                    speakerId: activeSpeakerId,
                    voiceId: voice.id,
                  });
                }}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      /* The primitive can emit null when a selection is cleared; these filters
       * have no cleared state — "any" is an option — so null collapses back to
       * the sentinel rather than leaving the filter undefined. */
      onValueChange={(next) => onChange(next ?? VOICE_FILTER_ALL)}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={VOICE_FILTER_ALL}>{label}: any</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option.charAt(0).toUpperCase() + option.slice(1)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: VoiceCard, LOCKED_NOT_HIDDEN,
 *   PREVIEWS_ARE_NEVER_GATED
 *
 * WHY:   The play button is NOT disabled when the voice is locked — that is
 *        the upsell. Only the assign action is gated, and clicking it opens
 *        the upgrade modal rather than doing nothing.
 */
function VoiceCard({
  voice,
  disabled,
  assigning,
  playing,
  onPlay,
  onAssign,
}: {
  voice: {
    id: string;
    name: string;
    gender: string;
    accent: string;
    tone: string;
    locked: boolean;
    hasPreview: boolean;
  };
  disabled: boolean;
  assigning: boolean;
  playing: boolean;
  onPlay: () => void;
  onAssign: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">{voice.name}</p>
          <p className="text-xs text-muted-foreground">
            {voice.gender} · {voice.accent} · {voice.tone}
          </p>
        </div>
        {voice.locked ? <Badge variant="secondary">Locked</Badge> : null}
      </div>

      <div className="flex items-center gap-2">
        {/* Never gated — see PREVIEWS_ARE_NEVER_GATED. */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!voice.hasPreview}
          onClick={onPlay}
          aria-label={`Play a sample of ${voice.name}`}
        >
          {playing ? "Playing…" : voice.hasPreview ? "Play" : "No sample"}
        </Button>

        <Button
          type="button"
          size="sm"
          disabled={disabled || assigning}
          onClick={onAssign}
          aria-label={
            voice.locked
              ? `${voice.name} requires an upgrade`
              : `Use ${voice.name}`
          }
        >
          {voice.locked ? "Upgrade" : "Use"}
        </Button>
      </div>
    </div>
  );
}
