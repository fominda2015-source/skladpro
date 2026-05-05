import bcrypt from "bcryptjs";
import { PrismaClient, UserStatus } from "@prisma/client";

const prisma = new PrismaClient();

const ADMIN_EMAIL = "admin@skladpro.local";
const ADMIN_PASSWORD = "1111";
const ADMIN_NAME = "System Admin";

async function main() {
  console.log("Reset users start");

  const adminRole = await prisma.role.upsert({
    where: { name: "ADMIN" },
    update: { permissions: ["*"] },
    create: { name: "ADMIN", permissions: ["*"] }
  });

  await prisma.$transaction(async (tx) => {
    await tx.userWarehouseSectionScope.deleteMany({});
    await tx.userWarehouseScope.deleteMany({});
    await tx.userProjectScope.deleteMany({});
    await tx.staffTask.deleteMany({});
    await tx.notification.deleteMany({});
    await tx.user.deleteMany({});
  });

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const admin = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      fullName: ADMIN_NAME,
      passwordHash,
      roleId: adminRole.id,
      status: UserStatus.ACTIVE
    }
  });

  console.log("Reset users done. Admin id:", admin.id);
  console.log(`Login: ${ADMIN_EMAIL}`);
  console.log(`Password: ${ADMIN_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
