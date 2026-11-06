(async () => {
  const completed = [];
  const wait = async (fn, label) => {
    for (let i = 0; i < 400; i++) {
      const result = await fn();
      if (result) return result;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(label);
  };
  const click = (text) => {
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === text && !b.disabled,
    );
    if (!button) throw new Error("Missing button: " + text);
    button.click();
  };
  let seq = -1;
  const control = (method, args = {}) =>
    new Promise((resolve, reject) => {
      const id = seq--;
      const listener = ({ data }) => {
        if (data.id !== id) return;
        window.chrome.webview.removeEventListener("message", listener);
        data.error ? reject(new Error(data.error)) : resolve(data.result);
      };
      window.chrome.webview.addEventListener("message", listener);
      window.chrome.webview.postMessage({ id, method, args });
    });
  const choose = async (index, suffix) => {
    document.querySelectorAll(".browse-button")[index].click();
    await wait(
      () =>
        document
          .querySelectorAll(".path-field input")
          [index].value.endsWith(suffix),
      "Chooser failed",
    );
  };
  const child = async () => {
    await control("test:resetChild");
    click("打开独立差分窗口");
    const result = await wait(
      () => control("test:childStatus"),
      "Separate diff window did not finish",
    );
    if (result.error) throw new Error(result.error);
    if (!result.frameless) throw new Error("System titlebar still visible");
    if (!result.borderless || !result.shadowEnabled)
      throw new Error(
        "Diff window must use a DWM shadow without border padding",
      );
    completed.push(...result.completed);
  };
  try {
    await wait(
      () => window.wiiMerge && document.querySelector(".browse-button"),
      "Application missing",
    );
    await choose(0, "a.txt");
    await choose(1, "b.txt");
    click("开始比较");
    await wait(
      () =>
        document
          .querySelector(".comparison-overview .overview-table")
          ?.textContent.includes("b.txt"),
      "Overview missing",
    );
    await child();
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.id = "native-host-file-test";
    document.body.append(input);
    await control("test:dropPair");
    const pair = await window.wiiMerge.droppedPaths([...input.files]);
    if (pair.length !== 2) throw new Error("Two-path drop failed");
    completed.push("native two-file drag authorization");
    const folder = [...document.querySelectorAll('[role="tab"]')].find(
      (b) => b.textContent === "文件夹比较",
    );
    folder.click();
    await new Promise((r) => setTimeout(r, 80));
    await choose(0, "before");
    await choose(1, "after");
    click("开始比较");
    await wait(
      () =>
        document
          .querySelector(".comparison-overview .overview-table")
          ?.textContent.includes("app.war"),
      "Folder overview missing",
    );
    await child();
    [...document.querySelectorAll('[role="tab"]')]
      .find((b) => b.textContent === "文件比较")
      .click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await choose(0, "legacy.xls");
    await choose(1, "modern.xlsx");
    click("开始比较");
    await wait(
      () =>
        document
          .querySelector(".comparison-overview .overview-table")
          ?.textContent.includes("modern.xlsx"),
      "XLS overview missing",
    );
    await child();
    await window.wiiMerge.windowAction("maximize");
    await wait(
      () => document.documentElement.classList.contains("window-maximized"),
      "Maximized state missing",
    );
    const geometry = await control("test:windowGeometry");
    const { bounds, work } = geometry;
    if (
      bounds.x < work.x - 2 ||
      bounds.y < work.y - 2 ||
      bounds.x + bounds.width > work.x + work.width + 2 ||
      bounds.y + bounds.height > work.y + work.height + 2
    )
      throw new Error(
        "Maximized window escaped the current display work area: " +
          JSON.stringify(geometry),
      );
    const expected = [
      { x: 0, y: 0, width: 2560, height: 1400 },
      { x: 40, y: 0, width: 1880, height: 1080 },
      { x: 0, y: 40, width: 2560, height: 1400 },
      { x: 0, y: 0, width: 2560, height: 1400 },
    ];
    if (JSON.stringify(geometry.cases) !== JSON.stringify(expected))
      throw new Error(
        "Multi-monitor coordinate regression: " +
          JSON.stringify(geometry.cases),
      );
    await window.wiiMerge.windowAction("maximize");
    await wait(
      () => !document.documentElement.classList.contains("window-maximized"),
      "Restored state missing",
    );
    if (document.querySelectorAll(".window-resize-handles>div").length !== 8)
      throw new Error("Borderless resize handles missing");
    completed.push("integrated window controls");
    await control("test:capture");
    await control("test:finished", { completed });
  } catch (error) {
    await control("test:finished", {
      completed,
      error: error.message + "\n" + error.stack,
    });
  }
})();
