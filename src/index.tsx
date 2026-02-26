import { render } from "preact";
import { App } from "./components/App";
import { parseStoryData } from "./parser";
import { useStoryStore } from "./store";
import { installStoryAPI } from "./story-api";
import { executeStoryInit } from "./story-init";
import "./styles.css";

function boot() {
  const storyData = parseStoryData();

  // Install Story API before author script runs
  installStoryAPI();

  // Apply author CSS
  if (storyData.userCSS) {
    const style = document.createElement("style");
    style.textContent = storyData.userCSS;
    document.head.appendChild(style);
  }

  // Execute author JavaScript
  if (storyData.userScript) {
    try {
      new Function(storyData.userScript)();
    } catch (err) {
      console.error("react-twine: Error in story JavaScript:", err);
    }
  }

  useStoryStore.getState().init(storyData);

  // Execute StoryInit passage if it exists
  executeStoryInit();

  const root = document.getElementById("root");
  if (!root) {
    throw new Error('react-twine: No <div id="root"> element found.');
  }

  render(<App />, root);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
