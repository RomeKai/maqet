import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { clearProject, loadProject } from "./persist/projectStore";
import "@fontsource-variable/archivo";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/caveat/400.css";
import "./theme.css";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing #root element");
}

/** Resumes the project saved on the phone; "New project" drops it and remounts a blank app on the method list. */
function Root() {
  const [session, setSession] = useState(() => ({ id: 0, restored: loadProject(), fresh: false }));
  return (
    <App
      key={session.id}
      restored={session.restored}
      initialView={session.fresh ? "method" : undefined}
      onNewProject={() => {
        clearProject();
        setSession((s) => ({ id: s.id + 1, restored: null, fresh: true }));
      }}
    />
  );
}

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
