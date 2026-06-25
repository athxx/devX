import { render } from "solid-js/web";
import "./setup";
import { WorkspacePage } from "../app/workspace-page";

const root = document.getElementById("root");

if (!root) {
  throw new Error("App root element not found");
}

const validTabs = ["home", "api", "db", "tools", "ssh", "settings", "vault"] as const;
const tabParam = new URLSearchParams(window.location.search).get("tab");
const initialTab = validTabs.includes(tabParam as any) ? tabParam as any : undefined;

render(() => <WorkspacePage platform="extension" initialTab={initialTab} />, root);
