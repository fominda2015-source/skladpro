CREATE TABLE "DataJobRun" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "deployVersion" TEXT,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "error" TEXT,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "triggeredById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DataJobRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataJobRun_jobId_startedAt_idx" ON "DataJobRun"("jobId", "startedAt");
CREATE INDEX "DataJobRun_jobId_deployVersion_status_idx" ON "DataJobRun"("jobId", "deployVersion", "status");

ALTER TABLE "DataJobRun" ADD CONSTRAINT "DataJobRun_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
