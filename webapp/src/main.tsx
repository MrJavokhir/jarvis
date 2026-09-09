import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initTelegram } from "./telegram";
import "./styles.css";

// Tema va viewport'ni React ishga tushishidan oldin sozlaymiz —
// shunda birinchi kadr ham to'g'ri ranglarda chiziladi.
initTelegram();

const container = document.getElementById("root");

if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
