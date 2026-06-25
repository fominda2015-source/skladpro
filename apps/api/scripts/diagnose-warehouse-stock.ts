/**
 * Диагностика: почему на складе пусто, а в выдачах материал виден.
 *
 * Запуск из apps/api:
 *   npx tsx scripts/diagnose-warehouse-stock.ts
 *   npx tsx scripts/diagnose-warehouse-stock.ts "Речники"
 *   npx tsx scripts/diagnose-warehouse-stock.ts "Речники" SS
 */
import { prisma } from "../src/lib/prisma.js";

const warehouseNameArg = process.argv[2]?.trim() || "Речники";
const sectionArg = (process.argv[3]?.trim().toUpperCase() || "SS") as "SS" | "EOM";

async function main() {
  console.log(`\n=== Диагностика склада: объект «${warehouseNameArg}», раздел ${sectionArg} ===\n`);

  const warehouse = await prisma.warehouse.findFirst({
    where: { name: { contains: warehouseNameArg, mode: "insensitive" } },
    select: { id: true, name: true }
  });

  if (!warehouse) {
    console.log("Объект не найден. Доступные склады:");
    const all = await prisma.warehouse.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
    for (const w of all) console.log(`  - ${w.name} (${w.id})`);
    return;
  }

  console.log(`Объект: ${warehouse.name}`);
  console.log(`ID:     ${warehouse.id}\n`);

  const stocks = await prisma.stock.findMany({
    where: { warehouseId: warehouse.id, section: sectionArg },
    include: {
      material: {
        select: { id: true, name: true, unit: true, kind: true, toolCatalogSection: true, category: true }
      }
    },
    orderBy: { updatedAt: "desc" }
  });

  console.log(`--- Stock (таблица Stock), всего строк: ${stocks.length} ---`);
  if (!stocks.length) {
    console.log("  (пусто — API /api/stocks вернёт [] для этого объекта/раздела)\n");
  } else {
    for (const s of stocks) {
      const qty = Number(s.quantity);
      const res = Number(s.reserved);
      const avail = qty - res;
      const hiddenTool = s.material.toolCatalogSection ? ` [toolCatalog=${s.material.toolCatalogSection}]` : "";
      console.log(
        `  qty=${qty} avail=${avail} | ${s.material.name.slice(0, 70)}${hiddenTool}`
      );
      console.log(`    materialId=${s.materialId} stockId=${s.id}`);
    }
    console.log("");
  }

  const receipts = await prisma.receiptRequest.findMany({
    where: {
      warehouseId: warehouse.id,
      section: sectionArg,
      status: { not: "CANCELLED" }
    },
    include: {
      items: {
        include: { mappedMaterial: { select: { id: true, name: true } } }
      }
    },
    orderBy: { updatedAt: "desc" },
    take: 10
  });

  console.log(`--- Приходные заявки (последние ${receipts.length}) ---`);
  for (const r of receipts) {
    const acceptedItems = r.items.filter((it) => Number(it.acceptedQty) > 0);
    if (!acceptedItems.length && r.status !== "RECEIVED") continue;
    console.log(`\n  ${r.number} | status=${r.status}`);
    for (const it of r.items) {
      const acc = Number(it.acceptedQty);
      const plan = Number(it.quantity);
      const stockForMat = stocks.find((s) => s.materialId === it.mappedMaterialId);
      const stockQty = stockForMat ? Number(stockForMat.quantity) : null;
      const flag =
        acc > 0 && stockQty === null
          ? " ⚠ ПРИНЯТО, НО STOCK НЕТ"
          : acc > 0 && stockQty === 0
            ? " ⚠ STOCK=0"
            : acc > 0
              ? " ✓"
              : "";
      console.log(
        `    ${flag} ${it.sourceName.slice(0, 55)}`
      );
      console.log(
        `      plan=${plan} accepted=${acc} | mappedMaterialId=${it.mappedMaterialId ?? "NULL"} | stock=${stockQty ?? "—"}`
      );
      if (it.mappedMaterial && it.mappedMaterial.name !== it.sourceName) {
        console.log(`      card name: ${it.mappedMaterial.name.slice(0, 55)}`);
      }
      if (it.factLabel) console.log(`      factLabel: ${it.factLabel.slice(0, 55)}`);
    }
  }

  const orphanAccepted = await prisma.receiptRequestItem.findMany({
    where: {
      acceptedQty: { gt: 0 },
      receiptRequest: { warehouseId: warehouse.id, section: sectionArg, status: { not: "CANCELLED" } }
    },
    select: {
      id: true,
      sourceName: true,
      acceptedQty: true,
      mappedMaterialId: true,
      receiptRequest: { select: { number: true } }
    }
  });

  const missingStock = orphanAccepted.filter((it) => {
    if (!it.mappedMaterialId) return true;
    const row = stocks.find((s) => s.materialId === it.mappedMaterialId);
    return !row || Number(row.quantity) <= 0;
  });

  console.log(`\n--- Итог ---`);
  console.log(`  Принятых позиций: ${orphanAccepted.length}`);
  console.log(`  Без остатка на складе: ${missingStock.length}`);
  if (missingStock.length) {
    console.log("\n  Позиции без stock (нужна повторная приёмка БЕЗ «Без прихода на склад»):");
    for (const it of missingStock) {
      console.log(`    - ${it.receiptRequest.number}: ${it.sourceName.slice(0, 50)} (accepted=${it.acceptedQty})`);
    }
  }

  const incomeOps = await prisma.operation.findMany({
    where: {
      type: "INCOME",
      warehouseId: warehouse.id,
      section: sectionArg,
      status: "POSTED"
    },
    include: { items: { include: { material: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 5
  });
  console.log(`\n--- Последние приходные операции (INCOME): ${incomeOps.length} ---`);
  for (const op of incomeOps) {
    console.log(`  ${op.documentNumber ?? op.id} | ${op.createdAt.toISOString().slice(0, 10)}`);
    for (const li of op.items) {
      console.log(`    + ${Number(li.quantity)} | ${li.material.name.slice(0, 60)}`);
    }
  }

  console.log("\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
