import { render } from "solid-js/web";
import "./setup";
import { WorkspacePage } from "../app/workspace-page";

const root = document.getElementById("root");

if (!root) {
  throw new Error("App root element not found");
}

render(() => <WorkspacePage platform="extension" />, root);
