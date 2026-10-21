-- CreateTable
CREATE TABLE "alignment" (
    "projectId" TEXT NOT NULL,
    "words" JSONB NOT NULL,
    "audioHash" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alignment_pkey" PRIMARY KEY ("projectId")
);

-- CreateIndex
CREATE INDEX "alignment_audioHash_idx" ON "alignment"("audioHash");

-- AddForeignKey
ALTER TABLE "alignment" ADD CONSTRAINT "alignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
