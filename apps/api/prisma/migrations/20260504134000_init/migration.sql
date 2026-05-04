-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "StockMovementDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "IssueRequestStatus" AS ENUM ('DRAFT', 'ON_APPROVAL', 'APPROVED', 'REJECTED', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IssueBasisType" AS ENUM ('PROJECT_WORK', 'INTERNAL_NEED', 'EMERGENCY', 'OTHER');

-- CreateEnum
CREATE TYPE "IssueFlowType" AS ENUM ('REQUEST', 'DIRECT_ISSUE');

-- CreateEnum
CREATE TYPE "ToolStatus" AS ENUM ('IN_STOCK', 'ISSUED', 'IN_REPAIR', 'DAMAGED', 'LOST', 'WRITTEN_OFF', 'DISPUTED');

-- CreateEnum
CREATE TYPE "TransportWaybillStatus" AS ENUM ('DRAFT', 'FORMED', 'SHIPPED', 'RECEIVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MaterialMatchQueueStatus" AS ENUM ('PENDING', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IntegrationJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationLevel" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "ConversationKind" AS ENUM ('DM', 'FEEDBACK');

-- CreateEnum
CREATE TYPE "ObjectSection" AS ENUM ('SS', 'EOM');

-- CreateEnum
CREATE TYPE "ReceiptRequestStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LimitNodeType" AS ENUM ('GROUP', 'MATERIAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "roleId" TEXT NOT NULL,
    "customPermissions" JSONB,
    "positionId" TEXT,
    "activeWarehouseId" TEXT,
    "activeSection" "ObjectSection",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "projectId" TEXT,
    "warehouseId" TEXT,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWarehouseScope" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWarehouseScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWarehouseSectionScope" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "section" "ObjectSection" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWarehouseSectionScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProjectScope" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserProjectScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialMergeHistory" (
    "id" TEXT NOT NULL,
    "sourceMaterialId" TEXT NOT NULL,
    "targetMaterialId" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialMergeHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "direction" "StockMovementDirection" NOT NULL,
    "sourceDocumentType" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "operationId" TEXT,
    "issueRequestId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialSynonym" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialSynonym_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stock" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "section" "ObjectSection" NOT NULL DEFAULT 'SS',
    "quantity" DECIMAL(14,3) NOT NULL,
    "reserved" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "storageRoom" TEXT,
    "storageCell" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "section" "ObjectSection" NOT NULL DEFAULT 'SS',
    "warehouseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectWarehouse" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectWarehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectLimit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectLimitItem" (
    "id" TEXT NOT NULL,
    "projectLimitId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "plannedQty" DECIMAL(14,3) NOT NULL,
    "issuedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reservedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "sourceNodeId" TEXT,

    CONSTRAINT "ProjectLimitItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operation" (
    "id" TEXT NOT NULL,
    "type" "OperationType" NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "section" "ObjectSection" NOT NULL DEFAULT 'SS',
    "projectId" TEXT,
    "documentNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "operationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issueRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationItem" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "price" DECIMAL(14,2),

    CONSTRAINT "OperationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationDocument" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentFile" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "checksumSha256" TEXT,
    "createdBy" TEXT NOT NULL,
    "replacedById" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLink" (
    "id" TEXT NOT NULL,
    "documentFileId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "DocumentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialMatchQueue" (
    "id" TEXT NOT NULL,
    "rawName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "unit" TEXT,
    "article" TEXT,
    "status" "MaterialMatchQueueStatus" NOT NULL DEFAULT 'PENDING',
    "confidence" DOUBLE PRECISION,
    "suggestedMaterialId" TEXT,
    "resolvedMaterialId" TEXT,
    "source" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialMatchQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "IntegrationJobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "level" "NotificationLevel" NOT NULL DEFAULT 'INFO',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inventoryNumber" TEXT NOT NULL,
    "serialNumber" TEXT,
    "qrCode" TEXT NOT NULL,
    "status" "ToolStatus" NOT NULL DEFAULT 'IN_STOCK',
    "warehouseId" TEXT,
    "section" "ObjectSection" NOT NULL DEFAULT 'SS',
    "projectId" TEXT,
    "responsible" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolEvent" (
    "id" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" "ToolStatus" NOT NULL,
    "comment" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "kind" "ConversationKind" NOT NULL DEFAULT 'DM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "dataUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "IssueRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "flowType" "IssueFlowType" NOT NULL DEFAULT 'REQUEST',
    "basisType" "IssueBasisType" NOT NULL DEFAULT 'OTHER',
    "basisRef" TEXT,
    "responsibleName" TEXT,
    "warehouseId" TEXT NOT NULL,
    "section" "ObjectSection" NOT NULL DEFAULT 'SS',
    "projectId" TEXT,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectLimitTemplate" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "section" "ObjectSection" NOT NULL,
    "title" TEXT NOT NULL,
    "sourceFileName" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObjectLimitTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectLimitNode" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "parentId" TEXT,
    "orderNo" INTEGER NOT NULL DEFAULT 0,
    "nodeType" "LimitNodeType" NOT NULL DEFAULT 'GROUP',
    "indexLabel" TEXT,
    "title" TEXT NOT NULL,
    "materialName" TEXT,
    "unit" TEXT,
    "plannedQty" DECIMAL(14,3),
    "issuedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "materialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObjectLimitNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialMappingLibrary" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "section" "ObjectSection" NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUnit" TEXT NOT NULL DEFAULT '',
    "targetMaterialId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialMappingLibrary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "section" "ObjectSection" NOT NULL,
    "status" "ReceiptRequestStatus" NOT NULL DEFAULT 'NEW',
    "sourceFileName" TEXT,
    "createdById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptRequestItem" (
    "id" TEXT NOT NULL,
    "receiptRequestId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUnit" TEXT NOT NULL DEFAULT '╤И╤В',
    "quantity" DECIMAL(14,3) NOT NULL,
    "mappedMaterialId" TEXT,
    "acceptedQty" DECIMAL(14,3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueRequestItem" (
    "id" TEXT NOT NULL,
    "issueRequestId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "IssueRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportWaybill" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "TransportWaybillStatus" NOT NULL DEFAULT 'DRAFT',
    "fromWarehouseId" TEXT,
    "toLocation" TEXT NOT NULL,
    "sender" TEXT,
    "recipient" TEXT,
    "vehicle" TEXT,
    "driverName" TEXT,
    "route" TEXT,
    "operationId" TEXT,
    "issueRequestId" TEXT,
    "shippedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportWaybill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportWaybillItem" (
    "id" TEXT NOT NULL,
    "transportWaybillId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "TransportWaybillItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportWaybillEvent" (
    "id" TEXT NOT NULL,
    "transportWaybillId" TEXT NOT NULL,
    "status" "TransportWaybillStatus" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportWaybillEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Position_name_key" ON "Position"("name");

-- CreateIndex
CREATE UNIQUE INDEX "UserWarehouseScope_userId_warehouseId_key" ON "UserWarehouseScope"("userId", "warehouseId");

-- CreateIndex
CREATE INDEX "UserWarehouseSectionScope_warehouseId_section_idx" ON "UserWarehouseSectionScope"("warehouseId", "section");

-- CreateIndex
CREATE UNIQUE INDEX "UserWarehouseSectionScope_userId_warehouseId_section_key" ON "UserWarehouseSectionScope"("userId", "warehouseId", "section");

-- CreateIndex
CREATE UNIQUE INDEX "UserProjectScope_userId_projectId_key" ON "UserProjectScope"("userId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Material_sku_key" ON "Material"("sku");

-- CreateIndex
CREATE INDEX "MaterialMergeHistory_sourceMaterialId_createdAt_idx" ON "MaterialMergeHistory"("sourceMaterialId", "createdAt");

-- CreateIndex
CREATE INDEX "MaterialMergeHistory_targetMaterialId_createdAt_idx" ON "MaterialMergeHistory"("targetMaterialId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_warehouseId_materialId_createdAt_idx" ON "StockMovement"("warehouseId", "materialId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_operationId_idx" ON "StockMovement"("operationId");

-- CreateIndex
CREATE INDEX "StockMovement_issueRequestId_idx" ON "StockMovement"("issueRequestId");

-- CreateIndex
CREATE INDEX "StockMovement_sourceDocumentType_sourceDocumentId_idx" ON "StockMovement"("sourceDocumentType", "sourceDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialSynonym_materialId_value_key" ON "MaterialSynonym"("materialId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "Stock_warehouseId_materialId_section_key" ON "Stock"("warehouseId", "materialId", "section");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE INDEX "ProjectWarehouse_warehouseId_idx" ON "ProjectWarehouse"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectWarehouse_projectId_warehouseId_key" ON "ProjectWarehouse"("projectId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectLimitItem_projectLimitId_materialId_key" ON "ProjectLimitItem"("projectLimitId", "materialId");

-- CreateIndex
CREATE INDEX "DocumentFile_groupId_version_idx" ON "DocumentFile"("groupId", "version");

-- CreateIndex
CREATE INDEX "DocumentFile_entityType_entityId_idx" ON "DocumentFile"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "DocumentFile_checksumSha256_idx" ON "DocumentFile"("checksumSha256");

-- CreateIndex
CREATE INDEX "DocumentLink_entityType_entityId_idx" ON "DocumentLink"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLink_documentFileId_entityType_entityId_key" ON "DocumentLink"("documentFileId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "MaterialMatchQueue_status_idx" ON "MaterialMatchQueue"("status");

-- CreateIndex
CREATE INDEX "MaterialMatchQueue_normalizedName_idx" ON "MaterialMatchQueue"("normalizedName");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "IntegrationJob_kind_createdAt_idx" ON "IntegrationJob"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationJob_status_createdAt_idx" ON "IntegrationJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tool_inventoryNumber_key" ON "Tool"("inventoryNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Tool_qrCode_key" ON "Tool"("qrCode");

-- CreateIndex
CREATE INDEX "ConversationParticipant_userId_createdAt_idx" ON "ConversationParticipant"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationParticipant_conversationId_userId_key" ON "ConversationParticipant"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IssueRequest_number_key" ON "IssueRequest"("number");

-- CreateIndex
CREATE INDEX "ObjectLimitTemplate_warehouseId_section_createdAt_idx" ON "ObjectLimitTemplate"("warehouseId", "section", "createdAt");

-- CreateIndex
CREATE INDEX "ObjectLimitNode_templateId_parentId_orderNo_idx" ON "ObjectLimitNode"("templateId", "parentId", "orderNo");

-- CreateIndex
CREATE INDEX "MaterialMappingLibrary_warehouseId_section_createdAt_idx" ON "MaterialMappingLibrary"("warehouseId", "section", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialMappingLibrary_warehouseId_section_sourceName_sourc_key" ON "MaterialMappingLibrary"("warehouseId", "section", "sourceName", "sourceUnit");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptRequest_number_key" ON "ReceiptRequest"("number");

-- CreateIndex
CREATE INDEX "ReceiptRequest_warehouseId_section_status_createdAt_idx" ON "ReceiptRequest"("warehouseId", "section", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ReceiptRequestItem_receiptRequestId_idx" ON "ReceiptRequestItem"("receiptRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportWaybill_number_key" ON "TransportWaybill"("number");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeWarehouseId_fkey" FOREIGN KEY ("activeWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWarehouseScope" ADD CONSTRAINT "UserWarehouseScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWarehouseScope" ADD CONSTRAINT "UserWarehouseScope_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWarehouseSectionScope" ADD CONSTRAINT "UserWarehouseSectionScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWarehouseSectionScope" ADD CONSTRAINT "UserWarehouseSectionScope_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProjectScope" ADD CONSTRAINT "UserProjectScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProjectScope" ADD CONSTRAINT "UserProjectScope_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialMergeHistory" ADD CONSTRAINT "MaterialMergeHistory_sourceMaterialId_fkey" FOREIGN KEY ("sourceMaterialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialMergeHistory" ADD CONSTRAINT "MaterialMergeHistory_targetMaterialId_fkey" FOREIGN KEY ("targetMaterialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialMergeHistory" ADD CONSTRAINT "MaterialMergeHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_issueRequestId_fkey" FOREIGN KEY ("issueRequestId") REFERENCES "IssueRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialSynonym" ADD CONSTRAINT "MaterialSynonym_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectWarehouse" ADD CONSTRAINT "ProjectWarehouse_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectWarehouse" ADD CONSTRAINT "ProjectWarehouse_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLimit" ADD CONSTRAINT "ProjectLimit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLimitItem" ADD CONSTRAINT "ProjectLimitItem_projectLimitId_fkey" FOREIGN KEY ("projectLimitId") REFERENCES "ProjectLimit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLimitItem" ADD CONSTRAINT "ProjectLimitItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_issueRequestId_fkey" FOREIGN KEY ("issueRequestId") REFERENCES "IssueRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationItem" ADD CONSTRAINT "OperationItem_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationItem" ADD CONSTRAINT "OperationItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationDocument" ADD CONSTRAINT "OperationDocument_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionLog" ADD CONSTRAINT "ActionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_documentFileId_fkey" FOREIGN KEY ("documentFileId") REFERENCES "DocumentFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialMatchQueue" ADD CONSTRAINT "MaterialMatchQueue_suggestedMaterialId_fkey" FOREIGN KEY ("suggestedMaterialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialMatchQueue" ADD CONSTRAINT "MaterialMatchQueue_resolvedMaterialId_fkey" FOREIGN KEY ("resolvedMaterialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tool" ADD CONSTRAINT "Tool_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tool" ADD CONSTRAINT "Tool_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolEvent" ADD CONSTRAINT "ToolEvent_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueRequest" ADD CONSTRAINT "IssueRequest_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueRequest" ADD CONSTRAINT "IssueRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueRequest" ADD CONSTRAINT "IssueRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueRequest" ADD CONSTRAINT "IssueRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectLimitTemplate" ADD CONSTRAINT "ObjectLimitTemplate_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectLimitTemplate" ADD CONSTRAINT "ObjectLimitTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectLimitNode" ADD CONSTRAINT "ObjectLimitNode_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ObjectLimitTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectLimitNode" ADD CONSTRAINT "ObjectLimitNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ObjectLimitNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectLimitNode" ADD CONSTRAINT "ObjectLimitNode_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialMappingLibrary" ADD CONSTRAINT "MaterialMappingLibrary_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialMappingLibrary" ADD CONSTRAINT "MaterialMappingLibrary_targetMaterialId_fkey" FOREIGN KEY ("targetMaterialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialMappingLibrary" ADD CONSTRAINT "MaterialMappingLibrary_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptRequest" ADD CONSTRAINT "ReceiptRequest_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptRequest" ADD CONSTRAINT "ReceiptRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptRequestItem" ADD CONSTRAINT "ReceiptRequestItem_receiptRequestId_fkey" FOREIGN KEY ("receiptRequestId") REFERENCES "ReceiptRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptRequestItem" ADD CONSTRAINT "ReceiptRequestItem_mappedMaterialId_fkey" FOREIGN KEY ("mappedMaterialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueRequestItem" ADD CONSTRAINT "IssueRequestItem_issueRequestId_fkey" FOREIGN KEY ("issueRequestId") REFERENCES "IssueRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueRequestItem" ADD CONSTRAINT "IssueRequestItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportWaybill" ADD CONSTRAINT "TransportWaybill_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportWaybill" ADD CONSTRAINT "TransportWaybill_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportWaybill" ADD CONSTRAINT "TransportWaybill_issueRequestId_fkey" FOREIGN KEY ("issueRequestId") REFERENCES "IssueRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportWaybillItem" ADD CONSTRAINT "TransportWaybillItem_transportWaybillId_fkey" FOREIGN KEY ("transportWaybillId") REFERENCES "TransportWaybill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportWaybillItem" ADD CONSTRAINT "TransportWaybillItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportWaybillEvent" ADD CONSTRAINT "TransportWaybillEvent_transportWaybillId_fkey" FOREIGN KEY ("transportWaybillId") REFERENCES "TransportWaybill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

