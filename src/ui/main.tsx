import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import { connect } from "./client.ts";

connect();
createRoot(document.getElementById("root")!).render(<App />);
