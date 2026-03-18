export type WorkspaceLocale = "zh-CN" | "en-US";

export const workspaceLocaleOptions: Array<{
  code: WorkspaceLocale;
  label: string;
}> = [
  { code: "zh-CN", label: "中文" },
  { code: "en-US", label: "English" }
];

export const workspaceCopy: Record<
  WorkspaceLocale,
  {
    tabs: {
      api: string;
      db: string;
      ssh: string;
      tools: string;
    };
    actions: {
      donate: string;
      language: string;
      expandSidebar: string;
      collapseSidebar: string;
      switchToLightMode: string;
      switchToDarkMode: string;
      openSettings: string;
    };
  }
> = {
  "zh-CN": {
    tabs: {
      api: "API",
      db: "数据库",
      ssh: "SSH",
      tools: "工具"
    },
    actions: {
      donate: "赞助",
      language: "语言",
      expandSidebar: "展开侧栏",
      collapseSidebar: "收起侧栏",
      switchToLightMode: "切换到浅色模式",
      switchToDarkMode: "切换到深色模式",
      openSettings: "打开设置"
    }
  },
  "en-US": {
    tabs: {
      home: "Home",
      api: "API",
      db: "DB",
      ssh: "SSH",
      tools: "Tools"
    },
    actions: {
      donate: "Donate",
      language: "Language",
      expandSidebar: "Expand sidebar",
      collapseSidebar: "Collapse sidebar",
      switchToLightMode: "Switch to light mode",
      switchToDarkMode: "Switch to dark mode",
      openSettings: "Open settings"
    }
  }
};
