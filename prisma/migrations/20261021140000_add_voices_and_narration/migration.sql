-- CreateTable
CREATE TABLE "voice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "accent" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "providerVoiceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'elevenlabs',
    "minPlan" TEXT NOT NULL DEFAULT 'free',
    "previewAssetId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "speaker" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "voiceId" TEXT,
    "avatarId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'unassigned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "speaker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "narration_line" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "speakerTag" TEXT NOT NULL,
    "voiceId" TEXT,
    "text" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "audioAssetId" TEXT,
    "durationSec" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "narration_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_provider_providerVoiceId_key" ON "voice"("provider", "providerVoiceId");

-- CreateIndex
CREATE INDEX "voice_minPlan_idx" ON "voice"("minPlan");

-- CreateIndex
CREATE INDEX "voice_isActive_idx" ON "voice"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "speaker_projectId_tag_key" ON "speaker"("projectId", "tag");

-- CreateIndex
CREATE INDEX "speaker_organizationId_idx" ON "speaker"("organizationId");

-- CreateIndex
CREATE INDEX "narration_line_organizationId_idx" ON "narration_line"("organizationId");

-- CreateIndex
CREATE INDEX "narration_line_projectId_position_idx" ON "narration_line"("projectId", "position");

-- CreateIndex
CREATE INDEX "narration_line_textHash_voiceId_idx" ON "narration_line"("textHash", "voiceId");

-- AddForeignKey
ALTER TABLE "speaker" ADD CONSTRAINT "speaker_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "speaker" ADD CONSTRAINT "speaker_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "narration_line" ADD CONSTRAINT "narration_line_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "narration_line" ADD CONSTRAINT "narration_line_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
