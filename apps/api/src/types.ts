export type RoleName = "ADMIN" | "WAREHOUSE_MANAGER" | "VIEWER";

export type JwtPayload = {
  userId: string;
  role: RoleName;
  email: string;
  permissions: string[];
};
