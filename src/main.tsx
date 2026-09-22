import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { BlockApp } from "./ui/blocks/BlockApp";

const root = document.getElementById("root");
if (root === null) throw new Error('missing root element with id "root"');
createRoot(root).render(
  <StrictMode>
    <BlockApp />
  </StrictMode>,
);
