import { Prisma } from "@prisma/client";
import { config } from "../config.js";

export function handlePrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = error.meta?.target;
      const fields = Array.isArray(target) ? target : [];
      if (fields.includes("number") || fields.includes("warehouseId")) {
        return {
          status: 409,
          body: {
            error: "DUPLICATE_ORDER",
            message: "Заявка с таким номером уже есть на этом объекте."
          }
        };
      }
      return { status: 409, body: { error: "Duplicate value", code: "DUPLICATE", meta: error.meta } };
    }
    if (error.code === "P2003") {
      return {
        status: 400,
        body: {
          error: "INVALID_REFERENCE",
          message: "Объект или связанная запись не найдены. Выберите склад в шапке и проверьте миграции БД."
        }
      };
    }
    if (error.code === "P2021" || error.code === "P2022") {
      return {
        status: 500,
        body: {
          error: "SCHEMA_OUTDATED",
          message: config.isProduction
            ? "База данных не обновлена. Обратитесь к администратору."
            : `Схема БД устарела (${error.code}): выполните prisma migrate deploy`
        }
      };
    }
    if (error.code === "P2025") {
      return { status: 404, body: { error: "Entity not found", code: "NOT_FOUND" } };
    }
    if (error.code === "P2028") {
      return {
        status: 503,
        body: {
          error: "TRANSACTION_TIMEOUT",
          message:
            "Операция заняла слишком много времени. Попробуйте принять без документов или меньше позиций за раз."
        }
      };
    }
  }
  if (error instanceof Error && !config.isProduction) {
    return { status: 500, body: { error: "Internal server error", message: error.message } };
  }
  return { status: 500, body: { error: "Internal server error" } };
}
