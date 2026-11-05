(async () => {
  let seq = -100;
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
  const wait = async (fn, label) => {
    for (let i = 0; i < 400; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(label);
  };
  const completed = [];
  try {
    const report = await window.wiiMerge.getReport(
      new URLSearchParams(location.search).get("report"),
    );
    await wait(
      () => document.querySelector(".archive-overview"),
      "Overview must be shown first",
    );
    if (document.querySelector(".merge-table"))
      throw new Error("File opened before overview");
    if (report.mode === "files" && report.items[0].type === "excel") {
      document.querySelector(".overview-table tbody button").click();
      await wait(
        () => document.querySelector(".excel-diff"),
        "XLS details missing",
      );
      const slider = document.querySelector(".map-track.map-right");
      if (!slider) throw new Error("Excel visual navigation missing");
      slider.dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      );
      await wait(
        () =>
          document
            .querySelector(".excel-diff .focused-row")
            ?.textContent.includes("新版末尾值"),
        "Excel visual jump failed",
      );
      completed.push(
        "XLS/XLSX cross-format comparison and visual cell navigation",
      );
    } else if (report.mode === "files") {
      document.querySelector(".overview-table tbody button").click();
      await wait(
        () => document.querySelector(".merge-table"),
        "Text diff window missing",
      );
      if (document.querySelectorAll(".hunk-navigation>button").length !== 2)
        throw new Error("Expected two navigation hunks");
      const slider = document.querySelector(".map-track.map-right");
      if (!slider) throw new Error("Text visual navigation missing");
      slider.dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      );
      await wait(
        () => slider.getAttribute("aria-valuenow") === "1851",
        "Text visual jump failed",
      );
      for (let n = 0; n < 2; n++) {
        [...document.querySelectorAll(".merge-toolbar button")]
          .find((b) => b.textContent.trim() === "使用左边")
          .click();
        await new Promise((r) => setTimeout(r, 100));
      }
      await wait(
        () => document.querySelector(".editor-equal"),
        "Adopt-left did not resolve hunks",
      );
      const save = document
        .querySelectorAll(".editor-sides>div")[1]
        .querySelector("button");
      if (save.disabled) throw new Error("Merged right side not dirty");
      save.click();
      await wait(
        () =>
          document
            .querySelector('[role="status"]')
            ?.textContent.includes("已保存"),
        "CAS save failed",
      );
      completed.push(
        "independent frameless window, hunk navigation, adopt-left and saved merge",
      );
    } else {
      await wait(
        () => document.querySelector(".tree-scroll"),
        "Archive tree missing",
      );
      const archive = [...document.querySelectorAll(".nav-tree-row")].find(
        (b) => b.textContent.includes("app.war"),
      );
      if (!archive) throw new Error("WAR container missing");
      archive.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await wait(
        () => document.querySelectorAll(".document-tabs>div").length >= 2,
        "Archive Tab missing",
      );
      const open = [...document.querySelectorAll(".overview-table tr")]
        .find((r) => r.textContent.includes("app.txt"))
        ?.querySelector("button");
      if (!open) throw new Error("Nested JAR file missing");
      open.click();
      await wait(
        () => document.querySelector(".merge-table"),
        "Nested entry diff missing",
      );
      if (
        !document.body.textContent.includes("before") ||
        !document.body.textContent.includes("after")
      )
        throw new Error("Archive contents missing");
      completed.push(
        "WAR/JAR double-click virtual extraction, new Tab and file details",
      );
      for (const text of ["HTML 报告", "Excel 报告"]) {
        [...document.querySelectorAll(".diff-topbar button")]
          .find((b) => b.textContent.trim() === text)
          .click();
        await wait(
          () =>
            document
              .querySelector('[role="status"]')
              ?.textContent.includes(
                text.startsWith("HTML") ? "report.html" : "report.xlsx",
              ),
          "Full report export failed",
        );
      }
      completed.push("full report overview and per-file export");
    }
    await control("test:capture");
    await control("test:finished", { completed });
  } catch (error) {
    await control("test:finished", {
      completed,
      error: error.message + "\n" + error.stack,
    });
  }
})();
