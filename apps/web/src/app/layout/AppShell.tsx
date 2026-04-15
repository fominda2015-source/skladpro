import type { ReactNode } from "react";

type AppShellProps = {
  sidebar: ReactNode;
  topbar: ReactNode;
  children: ReactNode;
};

export function AppShell({ sidebar, topbar, children }: AppShellProps) {
  return (
    <main className="shell">
      <aside className="sidebar">{sidebar}</aside>
      <section className="canvas">
        {topbar}
        {children}
      </section>
    </main>
  );
}
