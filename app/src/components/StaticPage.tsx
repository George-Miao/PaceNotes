import type { ReactNode } from "react";

export function StaticPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main className="static-page">
      <header className="site-header">
        <a className="brand" href="/">
          PaceNotes
        </a>
        <a href="/">Back to home</a>
      </header>
      <article>
        <span className="eyebrow">PaceNotes</span>
        <h1>{title}</h1>
        <p className="lead">{intro}</p>
        {children}
      </article>
      <footer className="site-footer">
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/license">License</a>
        <a href="/roadmap">Roadmap</a>
      </footer>
    </main>
  );
}
