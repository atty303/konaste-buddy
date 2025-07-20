for (const window of workspace.stackingOrder) {
  if (window.resourceClass === "com.obsproject.Studio") {
    window.closeWindow();
  }
}
