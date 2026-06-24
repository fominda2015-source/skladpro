-- Field docs: work order, daily attendance, timesheet drafts/archives

CREATE TABLE "WorkOrderSheet" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "section" "ObjectSection" NOT NULL,
    "workDate" DATE NOT NULL,
    "objectTitle" TEXT NOT NULL,
    "foremanName" TEXT NOT NULL DEFAULT '',
    "responsibleItrName" TEXT NOT NULL DEFAULT '',
    "composedByItrName" TEXT NOT NULL DEFAULT '',
    "rows" JSONB NOT NULL DEFAULT '[]',
    "completedWorksNote" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrderSheet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyAttendanceSheet" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "section" "ObjectSection" NOT NULL,
    "workDate" DATE NOT NULL,
    "objectTitle" TEXT NOT NULL,
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyAttendanceSheet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TimesheetEmployeeDraft" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "section" "ObjectSection" NOT NULL,
    "month" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "position" TEXT NOT NULL DEFAULT '',
    "hireDate" TEXT,
    "marks" JSONB NOT NULL DEFAULT '{}',
    "savedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimesheetEmployeeDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TimesheetMonthArchive" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "section" "ObjectSection" NOT NULL,
    "month" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetMonthArchive_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkOrderSheet_warehouseId_section_workDate_key" ON "WorkOrderSheet"("warehouseId", "section", "workDate");
CREATE INDEX "WorkOrderSheet_warehouseId_section_workDate_idx" ON "WorkOrderSheet"("warehouseId", "section", "workDate");

CREATE UNIQUE INDEX "DailyAttendanceSheet_warehouseId_section_workDate_key" ON "DailyAttendanceSheet"("warehouseId", "section", "workDate");
CREATE INDEX "DailyAttendanceSheet_warehouseId_section_workDate_idx" ON "DailyAttendanceSheet"("warehouseId", "section", "workDate");

CREATE UNIQUE INDEX "TimesheetEmployeeDraft_warehouseId_section_month_staffUserId_key" ON "TimesheetEmployeeDraft"("warehouseId", "section", "month", "staffUserId");
CREATE INDEX "TimesheetEmployeeDraft_warehouseId_section_month_idx" ON "TimesheetEmployeeDraft"("warehouseId", "section", "month");

CREATE UNIQUE INDEX "TimesheetMonthArchive_warehouseId_section_month_key" ON "TimesheetMonthArchive"("warehouseId", "section", "month");
CREATE INDEX "TimesheetMonthArchive_warehouseId_section_closedAt_idx" ON "TimesheetMonthArchive"("warehouseId", "section", "closedAt");

ALTER TABLE "WorkOrderSheet" ADD CONSTRAINT "WorkOrderSheet_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkOrderSheet" ADD CONSTRAINT "WorkOrderSheet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkOrderSheet" ADD CONSTRAINT "WorkOrderSheet_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DailyAttendanceSheet" ADD CONSTRAINT "DailyAttendanceSheet_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyAttendanceSheet" ADD CONSTRAINT "DailyAttendanceSheet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TimesheetEmployeeDraft" ADD CONSTRAINT "TimesheetEmployeeDraft_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimesheetEmployeeDraft" ADD CONSTRAINT "TimesheetEmployeeDraft_savedById_fkey" FOREIGN KEY ("savedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TimesheetMonthArchive" ADD CONSTRAINT "TimesheetMonthArchive_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimesheetMonthArchive" ADD CONSTRAINT "TimesheetMonthArchive_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
