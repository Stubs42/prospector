import "./data.browser.js"; // inject engine data before anything else
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { applyTheme, theme } from "./theme.js";

applyTheme(theme); // all colour tokens live in theme.ts — see its own comment for how

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
