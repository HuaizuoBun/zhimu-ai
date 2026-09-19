import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "../../app/page";
import "./desktop.css";

// Desktop renderer entry: mounts the original page component without the
// server-side layout used by the web build. Only one React runtime is bundled.
const container = document.getElementById("root");
if (!container) throw new Error("找不到 #root 挂载点");
createRoot(container).render(
  <StrictMode>
    <Home />
  </StrictMode>
);
