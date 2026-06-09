import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { getEffectivePermissions } from "../lib/access.js";
import { isAdminEquivalent, OPEN_ACCESS_ALL } from "../lib/openAccess.js";
import { hasPermission } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import type { JwtPayload } from "../types.js";

export type AuthedRequest = Request & { user?: JwtPayload };

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.replace("Bearer ", "") : undefined;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export async function loadUserPermissions(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: { select: { permissions: true } } }
  });
  if (!user) return [];
  return getEffectivePermissions(user.role.permissions);
}

export function requirePermission(permission: string) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const permissions = await loadUserPermissions(req.user.userId);
      req.user.permissions = permissions;
      if (!hasPermission(permissions, permission)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      return next();
    } catch (e) {
      console.error("requirePermission failed:", e);
      return res.status(500).json({ error: "Ошибка проверки доступа" });
    }
  };
}

/** Только роль ADMIN (вкладка «Доступы», управление пользователями). */
export function requireAdminRole(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!isAdminEquivalent(req.user.role)) {
    return res.status(403).json({ error: "Только для администратора" });
  }
  return next();
}

export { OPEN_ACCESS_ALL };
