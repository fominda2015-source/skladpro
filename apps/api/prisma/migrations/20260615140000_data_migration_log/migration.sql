CREATE TABLE "DataMigration" (
    "id" TEXT NOT NULL,
    "summary" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataMigration_pkey" PRIMARY KEY ("id")
);
