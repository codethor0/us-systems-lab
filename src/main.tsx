import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { App } from "./ui/App";

const root = document.getElementById("root");
if (root === null) throw new Error('missing root element with id "root"');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
