export type DailyAttendanceRow = {
  position: string;
  normQty: number;
  presentQty: number;
  nameReason: string;
};

export type DailyAttendanceBlock = {
  title: string;
  organization: string;
  rows: DailyAttendanceRow[];
};

const ROW_LIMITS: Record<"SS" | "EOM", number[]> = {
  EOM: [3, 9],
  SS: [3, 4]
};

export function emptyDailyAttendanceRow(): DailyAttendanceRow {
  return { position: "", normQty: 1, presentQty: 0, nameReason: "" };
}

export function defaultDailyAttendanceBlocks(section: "SS" | "EOM"): DailyAttendanceBlock[] {
  const limits = ROW_LIMITS[section];
  const titles =
    section === "EOM"
      ? [
          { title: "ИТР", organization: "" },
          { title: "ПНР", organization: "" }
        ]
      : [
          { title: "ИТР", organization: "" },
          { title: "Почасовая оплата", organization: "" }
        ];
  return titles.map((block, i) => ({
    ...block,
    rows: Array.from({ length: limits[i] ?? 3 }, () => emptyDailyAttendanceRow())
  }));
}

export function normalizeDailyAttendanceBlocks(
  section: "SS" | "EOM",
  blocks: DailyAttendanceBlock[]
): DailyAttendanceBlock[] {
  const defaults = defaultDailyAttendanceBlocks(section);
  const limits = ROW_LIMITS[section];
  return defaults.map((def, i) => {
    const src = blocks[i];
    const limit = limits[i] ?? def.rows.length;
    const rows = [...(src?.rows ?? [])];
    while (rows.length < limit) rows.push(emptyDailyAttendanceRow());
    return {
      title: src?.title?.trim() || def.title,
      organization: src?.organization ?? "",
      rows: rows.slice(0, limit)
    };
  });
}

export function rowLimits(section: "SS" | "EOM"): number[] {
  return ROW_LIMITS[section];
}
