import type { ReactNode } from "react";
export function AppShell({
  mode,
  count,
  onLibrary,
  onSettings,
  children,
}: {
  mode: "library" | "reader" | "settings";
  count: number;
  onLibrary: () => void;
  onSettings: () => void;
  children: ReactNode;
}) {
  if (mode === "reader")
    return <div className="app is-reading">{children}</div>;
  return (
    <div className="app">
      <aside className="sidebar" data-testid="library-sidebar">
        <div className="brand">▤ AsterinBook</div>
        <div className="brand-note">把故事，留在身边</div>
        <nav className="nav">
          <button
            className={`nav-button ${mode === "library" ? "active" : ""}`}
            onClick={onLibrary}
          >
            ▤ 我的书架 <span>{count}</span>
          </button>
          <button
            className={`nav-button ${mode === "settings" ? "active" : ""}`}
            onClick={onSettings}
          >
            ⚙ 设置
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="tiny-label">A LITTLE TIME FOR STORIES</div>
          <p className="side-quote">
            灯下翻书，
            <br />
            日子缓缓。
          </p>
          <div className="side-rule" />
          <div className="status">
            <i />
            本地书库 · 离线阅读
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            AsterinBook <span>/</span>
            <strong>{mode === "library" ? "我的书架" : "设置"}</strong>
          </div>
          <button
            className="button mobile-nav"
            onClick={mode === "library" ? onSettings : onLibrary}
          >
            {mode === "library" ? "设置" : "书架"}
          </button>
        </header>
        {children}
      </main>
    </div>
  );
}
