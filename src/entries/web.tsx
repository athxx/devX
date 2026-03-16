import { render } from "solid-js/web";
import "@unocss/reset/tailwind.css";
import "uno.css";
import { WorkspacePage } from "../app/workspace-page";
import "../styles/main.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Web root element not found");
}

render(() => <WorkspacePage platform="web" />, root);

