import { Prisma } from "@prisma/client";

export function handlePrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return { status: 409, body: { error: "Duplicate value", code: "DUPLICATE", meta: error.meta } };
    }
    if (error.code === "P2025") {
      return { status: 404, body: { error: "Entity not found", code: "NOT_FOUND" } };
    }
  }
  return { status: 500, body: { error: "Internal server error" } };
}
