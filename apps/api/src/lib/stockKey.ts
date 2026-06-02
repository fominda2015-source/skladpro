import { StockCondition, type ObjectSection } from "@prisma/client";

export function stockUniqueKey(
  warehouseId: string,
  materialId: string,
  section: ObjectSection,
  condition: StockCondition = StockCondition.NEW
) {
  return {
    warehouseId_materialId_section_condition: {
      warehouseId,
      materialId,
      section,
      condition
    }
  };
}

export const stockNewCondition = StockCondition.NEW;
