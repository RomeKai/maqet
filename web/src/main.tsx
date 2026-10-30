import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource-variable/archivo";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/caveat/400.css";
import "./theme.css";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing #root element");
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
