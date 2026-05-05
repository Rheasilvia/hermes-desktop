/* @refresh reload */
import { render } from "solid-js/web";
import { bootstrapApi } from "./services/api";
import App from "./App";

const apiMode = import.meta.env.VITE_API_MODE === "mock" ? "mock" : "http";
bootstrapApi(apiMode);

const root = document.getElementById("root");

if (!root) throw new Error("Root element not found");

render(() => <App />, root);
