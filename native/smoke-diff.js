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
    if (document.querySelector(".diff-explorer"))
      throw new Error("Redundant file sidebar is still visible");
    const search = async (value) => {
      const input = document.querySelector('input[aria-label="搜索文件"]');
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
    };
    const fullscreen = async () => {
      if (document.querySelector(".text-navigation[open]"))
        throw new Error("Text navigation must default to collapsed");
      document
        .querySelector(".diff-map")
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await wait(
        () => document.querySelector(".map-fullscreen"),
        "Fullscreen navigation missing",
      );
      const slider = document.querySelector(".map-fullscreen .map-right");
      slider.dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      );
      await wait(
        () => slider.getAttribute("aria-valuenow") === "1851",
        "Fullscreen navigation lost jump behavior",
      );
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await wait(
        () => !document.querySelector(".map-fullscreen"),
        "Fullscreen navigation did not close",
      );
    };
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
      await fullscreen();
      completed.push(
        "XLS/XLSX cross-format comparison and visual cell navigation",
      );
    } else if (report.mode === "files") {
      document.querySelector(".overview-table tbody button").click();
      await wait(
        () => document.querySelector(".merge-table"),
        "Text diff window missing",
      );
      if (document.querySelector(".diff-map")?.dataset.differenceCount !== "2")
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
      await fullscreen();
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
      const archive = [
        ...document.querySelectorAll(".overview-table tbody tr"),
      ].find((r) => r.textContent.includes("app.war"));
      if (!archive) throw new Error("WAR container missing");
      archive.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await wait(
        () => document.querySelectorAll(".document-tabs>div").length >= 2,
        "Archive Tab missing",
      );
      await search("app.txt");
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
      [...document.querySelectorAll(".document-tabs>div>button:first-child")]
        .find((button) => button.textContent.trim() === "app.war")
        .click();
      await wait(
        () => document.querySelector(".overview-table"),
        "Archive overview missing",
      );
      await search("app.txt");
      const duplicate = [
        ...document.querySelectorAll(".overview-table tbody tr"),
      ].find((row) => row.textContent.includes("同名#2"));
      if (!duplicate) throw new Error("Duplicate JAR version missing");
      duplicate.querySelector("button").click();
      await wait(
        () =>
          document
            .querySelector(".merge-table")
            ?.textContent.includes("before-second") &&
          document
            .querySelector(".merge-table")
            ?.textContent.includes("after-second"),
        "Duplicate JAR opened the wrong occurrence",
      );
      if (!document.querySelector(".archive-warnings"))
        throw new Error("Duplicate notice missing");
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
