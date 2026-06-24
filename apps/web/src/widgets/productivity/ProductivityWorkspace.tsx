import { useState } from "react";
import { ProductivityTab } from "./ProductivityTab";
import { WorkOrderTab } from "./WorkOrderTab";
import { DailyAttendanceTab } from "./DailyAttendanceTab";

type SubTab = "productivity" | "workOrder" | "dailyAttendance";

type Props = {
  token: string | null;
  apiUrl: string;
  fetchWithSession: typeof fetch;
  warehouseId: string;
  section: "SS" | "EOM";
  warehouseName: string;
  canWrite: boolean;
  onUploadFile: (file: File) => Promise<void>;
  uploadBusy: boolean;
};

export function ProductivityWorkspace(props: Props) {
  const [subTab, setSubTab] = useState<SubTab>("productivity");

  return (
    <div className="productivityWorkspaceInner">
      <nav className="productivitySubTabs" aria-label="Разделы выработки">
        <button
          type="button"
          className={subTab === "productivity" ? "active" : ""}
          onClick={() => setSubTab("productivity")}
        >
          Выработка
        </button>
        <button type="button" className={subTab === "workOrder" ? "active" : ""} onClick={() => setSubTab("workOrder")}>
          Наряд-задание
        </button>
        <button
          type="button"
          className={subTab === "dailyAttendance" ? "active" : ""}
          onClick={() => setSubTab("dailyAttendance")}
        >
          Табель учёта
        </button>
      </nav>

      {subTab === "productivity" ? <ProductivityTab {...props} /> : null}
      {subTab === "workOrder" ? <WorkOrderTab {...props} /> : null}
      {subTab === "dailyAttendance" ? <DailyAttendanceTab {...props} /> : null}
    </div>
  );
}
