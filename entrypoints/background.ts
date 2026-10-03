export default defineBackground(() => {
  if (import.meta.env.FIREFOX) {
    // Firefox has no openPanelOnActionClick equivalent; toggle the sidebar on action click.
    // sidebarAction is Firefox-only and absent from the Chrome-derived browser types.
    const { sidebarAction } = browser as unknown as { sidebarAction: { toggle(): Promise<void> } };
    browser.browserAction.onClicked.addListener(() => sidebarAction.toggle());
  } else {
    browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});
