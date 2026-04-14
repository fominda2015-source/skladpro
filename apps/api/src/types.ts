/** Роли из seed; JWT хранит строку name из БД. */
export type RoleName =
  | "ADMIN"
  | "WAREHOUSE_MANAGER"
  | "VIEWER"
  | "CHIEF_WAREHOUSE"
  | "STOREKEEPER"
  | "FOREMAN"
  | "PROJECT_MANAGER"
  | "ACCOUNTING"
  | "MANAGEMENT";

export type JwtPayload = {
  userId: string;
  role: RoleName;
  email: string;
  permissions: string[];
};
