import React from "react";
import "./native-bridge.js";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import DiffWindow from "./DiffWindow.jsx";
import "./styles.css";
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {new URLSearchParams(location.search).get("view") === "diff" ? (
      <DiffWindow />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
