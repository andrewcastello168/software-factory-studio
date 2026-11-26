import type { ReactNode } from 'react';
import './business.css';

export function BusinessShell({ children }: { children: ReactNode }) {
  return <div className="business-workspace" data-theme={@@BRANDTHEME@@}>
    <header className="business-header">
      <a href="/" aria-label="Workspace home"><span className="business-mark" aria-hidden="true">{@@BRANDMARK@@}</span>
        <strong>{@@TITLE@@}</strong></a>
    </header>
    <div className="business-layout">
      <aside><nav aria-label="Application"><a aria-current="page" href="/">Workspace</a></nav></aside>
      <div className="business-content">{children}</div>
    </div>
  </div>;
}
