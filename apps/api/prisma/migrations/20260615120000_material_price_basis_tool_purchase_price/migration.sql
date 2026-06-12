-- Material.unitPrice = сумма за priceBasisQty единиц (не цена за 1 шт.)
ALTER TABLE "Material" ADD COLUMN "priceBasisQty" DECIMAL(14,3);

-- Tool.purchasePrice = стоимость учётной единицы (сумма за 1 инструмент/СИЗ)
ALTER TABLE "Tool" ADD COLUMN "purchasePrice" DECIMAL(14,2);
