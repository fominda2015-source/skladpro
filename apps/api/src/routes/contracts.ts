import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const contractsRouter = Router();

contractsRouter.get("/meta", (_req, res) => {
  res.json({
    name: "SkladPro API contract",
    version: "2026-04-15.2",
    format: "openapi-3.1",
    endpoints: {
      health: "/api/health",
      authMe: "/api/auth/me",
      materials: "/api/materials",
      stocks: "/api/stocks",
      dashboard: "/api/dashboard/summary",
      issues: "/api/issues",
      operations: "/api/operations",
      documents: "/api/documents",
      materialMatch: "/api/material-match/queue",
      materialMerge: "/api/materials/merge",
      integrationJobs: "/api/integrations/jobs",
      notifications: "/api/notifications"
    }
  });
});

contractsRouter.get("/openapi.json", (_req, res) => {
  const doc = {
    openapi: "3.1.0",
    info: {
      title: "SkladPro API",
      version: "2026-04-15.2",
      description:
        "Formalized API contract for core warehouse flows: auth, materials, stocks, issues, documents, integrations and notifications."
    },
    servers: [{ url: "/", description: "Same-origin API server" }],
    tags: [
      { name: "health" },
      { name: "auth" },
      { name: "materials" },
      { name: "stocks" },
      { name: "issues" },
      { name: "documents" },
      { name: "integrations" },
      { name: "notifications" },
      { name: "contracts" }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: { error: { type: "string" } },
          required: ["error"]
        },
        HealthResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            service: { type: "string" },
            ts: { type: "string", format: "date-time" }
          },
          required: ["ok", "service", "ts"]
        },
        MeResponse: {
          type: "object",
          properties: {
            id: { type: "string" },
            email: { type: "string" },
            fullName: { type: "string" },
            role: { type: "string" },
            permissions: { type: "array", items: { type: "string" } }
          },
          required: ["id", "email", "fullName", "role", "permissions"]
        },
        Material: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            sku: { type: ["string", "null"] },
            unit: { type: "string" },
            category: { type: ["string", "null"] },
            mergedIntoId: { type: ["string", "null"] }
          },
          required: ["id", "name", "unit"]
        },
        StockRow: {
          type: "object",
          properties: {
            id: { type: "string" },
            warehouseId: { type: "string" },
            materialId: { type: "string" },
            quantity: { type: "number" },
            reserved: { type: "number" },
            available: { type: "number" },
            warehouseName: { type: "string" },
            materialName: { type: "string" },
            materialSku: { type: ["string", "null"] },
            materialUnit: { type: "string" }
          },
          required: [
            "id",
            "warehouseId",
            "materialId",
            "quantity",
            "reserved",
            "available",
            "warehouseName",
            "materialName",
            "materialUnit"
          ]
        },
        IssueRequest: {
          type: "object",
          properties: {
            id: { type: "string" },
            number: { type: "string" },
            status: {
              type: "string",
              enum: ["DRAFT", "ON_APPROVAL", "APPROVED", "REJECTED", "ISSUED", "CANCELLED"]
            },
            basisType: {
              type: "string",
              enum: ["PROJECT_WORK", "INTERNAL_NEED", "EMERGENCY", "OTHER"]
            },
            basisRef: { type: ["string", "null"] },
            note: { type: ["string", "null"] },
            warehouseId: { type: "string" },
            projectId: { type: ["string", "null"] },
            requestedById: { type: "string" },
            approvedById: { type: ["string", "null"] },
            createdAt: { type: "string", format: "date-time" }
          },
          required: ["id", "number", "status", "basisType", "warehouseId", "requestedById", "createdAt"]
        },
        DocumentFile: {
          type: "object",
          properties: {
            id: { type: "string" },
            groupId: { type: ["string", "null"] },
            version: { type: "integer" },
            entityType: { type: "string" },
            entityId: { type: "string" },
            type: { type: "string" },
            fileName: { type: "string" },
            filePath: { type: "string" },
            mimeType: { type: ["string", "null"] },
            size: { type: ["integer", "null"] },
            checksumSha256: { type: ["string", "null"] },
            replacedById: { type: ["string", "null"] },
            isDeleted: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            matchedLinkId: { type: ["string", "null"] }
          },
          required: ["id", "version", "entityType", "entityId", "type", "fileName", "filePath", "createdAt"]
        },
        IntegrationJob: {
          type: "object",
          properties: {
            id: { type: "string" },
            kind: { type: "string" },
            status: { type: "string", enum: ["PENDING", "RUNNING", "SUCCESS", "FAILED"] },
            payload: { type: ["object", "array", "string", "number", "boolean", "null"] },
            result: { type: ["object", "array", "string", "number", "boolean", "null"] },
            error: { type: ["string", "null"] },
            startedAt: { type: ["string", "null"], format: "date-time" },
            finishedAt: { type: ["string", "null"], format: "date-time" },
            requestedBy: { type: ["string", "null"] },
            createdAt: { type: "string", format: "date-time" }
          },
          required: ["id", "kind", "status", "createdAt"]
        },
        Notification: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            message: { type: "string" },
            level: { type: "string", enum: ["INFO", "WARNING", "ERROR"] },
            isRead: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            entityType: { type: ["string", "null"] },
            entityId: { type: ["string", "null"] }
          },
          required: ["id", "title", "message", "level", "isRead", "createdAt"]
        },
        DashboardSummary: {
          type: "object",
          properties: {
            role: { type: "string" },
            generatedAt: { type: "string", format: "date-time" },
            scoped: { type: "boolean" },
            warehouse: {
              type: "object",
              properties: {
                receiptsToday: { type: "integer" },
                issuesOperationsToday: { type: "integer" },
                issuesRequestsIssuedToday: { type: "integer" },
                transfersToday: { type: "integer" },
                pendingApprovals: { type: "integer" },
                lowStockLines: { type: "integer" },
                staleOpenIssues: { type: "integer" },
                toolsInRepair: { type: "integer" },
                waybillsOpen: { type: "integer" },
                matchQueuePending: { type: "integer" },
                failedIntegrations24h: { type: "integer" },
                unreadNotifications: { type: "integer" },
                errorNotifications24h: { type: "integer" }
              }
            }
          },
          required: ["role", "generatedAt", "warehouse"]
        },
        MaterialMatchQueueItem: {
          type: "object",
          properties: {
            id: { type: "string" },
            rawName: { type: "string" },
            normalizedName: { type: "string" },
            status: { type: "string", enum: ["PENDING", "RESOLVED", "REJECTED"] },
            confidence: { type: ["number", "null"] },
            suggestedMaterialId: { type: ["string", "null"] },
            resolvedMaterialId: { type: ["string", "null"] },
            source: { type: ["string", "null"] },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" }
          },
          required: ["id", "rawName", "normalizedName", "status", "createdAt", "updatedAt"]
        }
      }
    },
    paths: {
      "/api/health": {
        get: {
          tags: ["health"],
          summary: "Service health",
          responses: {
            "200": {
              description: "Service is healthy",
              content: { "application/json": { schema: { $ref: "#/components/schemas/HealthResponse" } } }
            }
          }
        }
      },
      "/api/auth/me": {
        get: {
          tags: ["auth"],
          summary: "Current user profile",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Current user data",
              content: { "application/json": { schema: { $ref: "#/components/schemas/MeResponse" } } }
            },
            "401": {
              description: "Unauthorized",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
            }
          }
        }
      },
      "/api/materials": {
        get: {
          tags: ["materials"],
          summary: "List materials",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "category", in: "query", schema: { type: "string" } },
            { name: "unit", in: "query", schema: { type: "string" } },
            { name: "includeMerged", in: "query", schema: { type: "string", enum: ["0", "1"] } }
          ],
          responses: {
            "200": {
              description: "Material list",
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/Material" } }
                }
              }
            }
          }
        }
      },
      "/api/stocks": {
        get: {
          tags: ["stocks"],
          summary: "List stock balances",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "q", in: "query", schema: { type: "string" } }],
          responses: {
            "200": {
              description: "Stock rows",
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/StockRow" } }
                }
              }
            }
          }
        }
      },
      "/api/dashboard/summary": {
        get: {
          tags: ["stocks"],
          summary: "Dashboard summary for current role and scope",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Summary payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/DashboardSummary" }
                }
              }
            }
          }
        }
      },
      "/api/issues": {
        get: {
          tags: ["issues"],
          summary: "List issue requests",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "status",
              in: "query",
              schema: {
                type: "string",
                enum: ["DRAFT", "ON_APPROVAL", "APPROVED", "REJECTED", "ISSUED", "CANCELLED"]
              }
            },
            {
              name: "basisType",
              in: "query",
              schema: { type: "string", enum: ["PROJECT_WORK", "INTERNAL_NEED", "EMERGENCY", "OTHER"] }
            }
          ],
          responses: {
            "200": {
              description: "Issue requests",
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/IssueRequest" } }
                }
              }
            }
          }
        },
        post: {
          tags: ["issues"],
          summary: "Create issue request",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["warehouseId", "items"],
                  properties: {
                    warehouseId: { type: "string" },
                    projectId: { type: "string" },
                    note: { type: "string" },
                    basisType: {
                      type: "string",
                      enum: ["PROJECT_WORK", "INTERNAL_NEED", "EMERGENCY", "OTHER"]
                    },
                    basisRef: { type: "string" },
                    items: {
                      type: "array",
                      minItems: 1,
                      items: {
                        type: "object",
                        required: ["materialId", "quantity"],
                        properties: {
                          materialId: { type: "string" },
                          quantity: { type: "number" }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            "201": {
              description: "Issue request created",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/IssueRequest" } }
              }
            }
          }
        }
      },
      "/api/documents": {
        get: {
          tags: ["documents"],
          summary: "List documents",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "entityType", in: "query", schema: { type: "string" } },
            { name: "entityId", in: "query", schema: { type: "string" } },
            { name: "type", in: "query", schema: { type: "string" } },
            { name: "includeDeleted", in: "query", schema: { type: "string", enum: ["0", "1"] } }
          ],
          responses: {
            "200": {
              description: "Document files",
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/DocumentFile" } }
                }
              }
            }
          }
        }
      },
      "/api/material-match/queue": {
        get: {
          tags: ["materials"],
          summary: "List material matching queue",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "status", in: "query", schema: { type: "string" } }],
          responses: {
            "200": {
              description: "Matching queue rows",
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/MaterialMatchQueueItem" } }
                }
              }
            }
          }
        }
      },
      "/api/material-match/try": {
        post: {
          tags: ["materials"],
          summary: "Try to match incoming material",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["rawName"],
                  properties: {
                    rawName: { type: "string" },
                    unit: { type: "string" },
                    article: { type: "string" },
                    enqueue: { type: "boolean" },
                    source: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Matching result payload" }
          }
        }
      },
      "/api/integrations/jobs": {
        get: {
          tags: ["integrations"],
          summary: "List integration jobs",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "status", in: "query", schema: { type: "string", enum: ["PENDING", "RUNNING", "SUCCESS", "FAILED"] } },
            { name: "kind", in: "query", schema: { type: "string" } }
          ],
          responses: {
            "200": {
              description: "Integration jobs",
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/IntegrationJob" } }
                }
              }
            }
          }
        },
        post: {
          tags: ["integrations"],
          summary: "Create integration job",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["kind"],
                  properties: {
                    kind: { type: "string" },
                    payload: { type: ["object", "array", "string", "number", "boolean", "null"] }
                  }
                }
              }
            }
          },
          responses: {
            "201": {
              description: "Job created",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/IntegrationJob" } }
              }
            }
          }
        }
      },
      "/api/integrations/jobs/{id}/run": {
        patch: {
          tags: ["integrations"],
          summary: "Run integration job",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "Job finished",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/IntegrationJob" } }
              }
            },
            "404": {
              description: "Not found",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
            }
          }
        }
      },
      "/api/notifications": {
        get: {
          tags: ["notifications"],
          summary: "List notifications for current user",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "unreadOnly", in: "query", schema: { type: "string", enum: ["0", "1"] } }],
          responses: {
            "200": {
              description: "Notifications",
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/Notification" } }
                }
              }
            }
          }
        }
      },
      "/api/notifications/read": {
        patch: {
          tags: ["notifications"],
          summary: "Mark notifications as read",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["ids"],
                  properties: {
                    ids: { type: "array", minItems: 1, items: { type: "string" } }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean" } },
                    required: ["ok"]
                  }
                }
              }
            }
          }
        }
      },
      "/api/contracts/meta": {
        get: {
          tags: ["contracts"],
          summary: "Contract metadata",
          responses: { "200": { description: "Meta info" } }
        }
      },
      "/api/contracts/readiness": {
        get: {
          tags: ["contracts"],
          summary: "Readiness checklist before full test run",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Readiness status",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      checks: {
                        type: "object",
                        properties: {
                          hasRoles: { type: "boolean" },
                          hasUsers: { type: "boolean" },
                          hasWarehouses: { type: "boolean" },
                          hasMaterials: { type: "boolean" },
                          hasIssueRequests: { type: "boolean" },
                          hasDocumentFiles: { type: "boolean" },
                          hasIntegrationJobs: { type: "boolean" },
                          hasNotifications: { type: "boolean" }
                        }
                      }
                    },
                    required: ["ok", "checks"]
                  }
                }
              }
            }
          }
        }
      },
      "/api/contracts/openapi.json": {
        get: {
          tags: ["contracts"],
          summary: "OpenAPI document",
          responses: { "200": { description: "OpenAPI JSON" } }
        }
      }
    }
  };
  res.json(doc);
});

contractsRouter.get("/readiness", async (_req, res) => {
  const [
    rolesCount,
    usersCount,
    warehousesCount,
    materialsCount,
    issuesCount,
    docsCount,
    integrationJobsCount,
    notificationsCount
  ] = await Promise.all([
    prisma.role.count(),
    prisma.user.count(),
    prisma.warehouse.count(),
    prisma.material.count(),
    prisma.issueRequest.count(),
    prisma.documentFile.count(),
    prisma.integrationJob.count(),
    prisma.notification.count()
  ]);

  const checks = {
    hasRoles: rolesCount > 0,
    hasUsers: usersCount > 0,
    hasWarehouses: warehousesCount > 0,
    hasMaterials: materialsCount > 0,
    hasIssueRequests: issuesCount > 0,
    hasDocumentFiles: docsCount > 0,
    hasIntegrationJobs: integrationJobsCount > 0,
    hasNotifications: notificationsCount > 0
  };
  const ok = Object.values(checks).every(Boolean);

  return res.json({
    ok,
    checks,
    counts: {
      roles: rolesCount,
      users: usersCount,
      warehouses: warehousesCount,
      materials: materialsCount,
      issueRequests: issuesCount,
      documentFiles: docsCount,
      integrationJobs: integrationJobsCount,
      notifications: notificationsCount
    },
    countsByCheck: {
      hasRoles: rolesCount,
      hasUsers: usersCount,
      hasWarehouses: warehousesCount,
      hasMaterials: materialsCount,
      hasIssueRequests: issuesCount,
      hasDocumentFiles: docsCount,
      hasIntegrationJobs: integrationJobsCount,
      hasNotifications: notificationsCount
    }
  });
});
