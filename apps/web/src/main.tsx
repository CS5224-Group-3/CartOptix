// Bootstraps React and mounts the web application.

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("CartOptix root element was not found.");
}

createRoot(rootElement).render(<App />);
