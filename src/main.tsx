import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";
import "./themes.css";
import "./app/shell.css";
import "./app/product.css";
import { SettingsProvider } from "./app/SettingsContext";
import { StorageGate } from "./app/StorageGate";
import { WindowTitleBar } from "./app/WindowTitleBar";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WindowTitleBar />
    <StorageGate>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </StorageGate>
  </React.StrictMode>,
);
