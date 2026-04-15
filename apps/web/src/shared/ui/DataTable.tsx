import type { ReactNode } from "react";

type DataTableProps = {
  headers: ReactNode[];
  children: ReactNode;
  className?: string;
};

export function DataTable({ headers, children, className }: DataTableProps) {
  return (
    <table className={className}>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={i}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
