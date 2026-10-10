import { createRoot } from "react-dom/client";
import App from "./app/App";
import { memoryPort } from "../tests/browser/support/memoryPort";
import "./styles/demo.css";
import "./styles/app.css";
createRoot(document.getElementById("root")!).render(
  <App
    port={memoryPort(
      new URLSearchParams(location.search).has("import"),
      new URLSearchParams(location.search).get("scenario") ?? "",
    )}
    testMode
  />,
);
