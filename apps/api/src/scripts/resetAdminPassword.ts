import bcrypt from "bcryptjs";
import { UserStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const email = process.argv[2] || process.env.ADMIN_EMAIL || "admin@skladpro.local";
const password = process.argv[3] || process.env.ADMIN_PASSWORD;
const fullName = process.env.ADMIN_NAME || "System Admin";

if (!password || password.length < 4) {
  console.error("Usage: npm run admin:reset-password -- <email> <new-password>");
  process.exit(1);
}

const newPassword = password;

async function main() {
  const adminRole = await prisma.role.findUnique({ where: { name: "ADMIN" } });
  if (!adminRole) {
    throw new Error("ADMIN role not found. Run seed/migrations before resetting admin password.");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      status: UserStatus.ACTIVE,
      roleId: adminRole.id
    },
    create: {
      email,
      fullName,
      passwordHash,
      status: UserStatus.ACTIVE,
      roleId: adminRole.id
    }
  });

  console.log(`Admin password reset for ${user.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
