// Runs only when the native launcher was explicitly given --smoke-fixtures.
// All comparisons and exports still use the production bridge and service.
(async () => {
  const completed = [];
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const wait = async (predicate, message) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(message + " | " + document.body.innerText.slice(-500));
  };
  const click = (text, selector = "button", prefix = false) => {
    const element = [...document.querySelectorAll(selector)].find((e) =>
      prefix
        ? e.textContent.trim().startsWith(text)
        : e.textContent.trim() === text,
    );
    assert(element && !element.disabled, "Missing enabled control: " + text);
    element.click();
  };
  const setValue = (element, value) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const mode = async (text) => {
    click(text, '[role="tab"]');
    await new Promise((resolve) => setTimeout(resolve, 80));
  };
  const choose = async (index, suffix) => {
    document.querySelectorAll(".browse-button")[index].click();
    await wait(
      () =>
        document
          .querySelectorAll(".path-field input")
          [index].value.endsWith(suffix),
      "Native file chooser did not resolve: " + suffix,
    );
  };
  let sequence = -1;
  const control = (method, args = {}) =>
    new Promise((resolve, reject) => {
      const id = sequence--;
      const listener = ({ data }) => {
        if (data.id !== id) return;
        window.chrome.webview.removeEventListener("message", listener);
        data.error ? reject(new Error(data.error)) : resolve(data.result);
      };
      window.chrome.webview.addEventListener("message", listener);
      window.chrome.webview.postMessage({ id, method, args });
    });
  try {
    await wait(
      () => window.wiiMerge && document.querySelector(".sample-link"),
      "React application did not load",
    );
    click("用一段示例体验文本比较");
    await wait(
      () => document.getElementById("text-left"),
      "Sample text editor did not open",
    );
    click("开始比较");
    await wait(
      () => document.querySelectorAll(".text-diff tr.changed").length === 3,
      "Text diff did not render expected changes",
    );
    completed.push("text comparison and character highlights");

    click("比较规则", "button", true);
    await wait(
      () => document.querySelector('[role="dialog"]'),
      "Rules panel missing",
    );
    setValue(document.querySelector('input[placeholder="例如 A 或 A,B"]'), "A");
    await new Promise((resolve) => setTimeout(resolve, 60));
    click("保存规则");
    await wait(
      () => !document.querySelector('[role="dialog"]'),
      "Rules did not persist",
    );
    assert(
      document.body.textContent.includes("输入或规则已更改"),
      "Old report did not become stale",
    );
    completed.push("persisted rules and stale-report protection");

    await mode("文件比较");
    await choose(0, "a.xlsx");
    await choose(1, "b.xlsx");
    click("开始比较");
    await wait(
      () => document.querySelectorAll(".excel-diff tbody tr").length === 1,
      "Keyed Excel comparison failed",
    );
    assert(
      document.querySelector(".excel-diff").textContent.includes("220"),
      "Excel value missing",
    );
    completed.push("native file selection and keyed Excel rows");
    for (const [label, suffix] of [
      ["HTML 报告", "report.html"],
      ["Excel 报告", "report.xlsx"],
    ]) {
      click("导出报告");
      click(label, ".export-menu button", true);
      await wait(
        () => document.querySelector(".toast")?.textContent.includes(suffix),
        "Native report export failed: " + suffix,
      );
    }
    completed.push("HTML and Excel native save operations");

    await mode("文件夹比较");
    await choose(0, "before");
    await choose(1, "after");
    click("开始比较");
    await wait(
      () => document.querySelectorAll(".file-item").length === 2,
      "Folder comparison failed",
    );
    assert(
      document.querySelector(".file-list").textContent.includes("app.txt"),
      "Nested archive was not expanded",
    );
    await control("test:capture");
    completed.push("folder selection and nested WAR/JAR comparison");

    let denied = false;
    try {
      await window.wiiMerge.compare({
        mode: "files",
        left: "C:\\Windows\\win.ini",
        right: "C:\\Windows\\win.ini",
      });
    } catch {
      denied = true;
    }
    assert(denied, "Unselected path was readable");
    const deniedGrant = await fetch("/native/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "C:\\Windows\\win.ini" }),
    });
    assert(
      deniedGrant.status === 403,
      "Renderer could grant native filesystem access",
    );
    completed.push("unauthorized path and privilege-boundary rejection");

    const input = document.createElement("input");
    input.type = "file";
    input.id = "native-host-file-test";
    document.body.append(input);
    await control("test:attachFile");
    const dropped = await window.wiiMerge.droppedPath(input.files[0]);
    assert(
      dropped.path.toLowerCase().endsWith("a.xlsx"),
      "WebView2 File object did not resolve",
    );
    completed.push(
      "real WebView2 additional File object and path authorization",
    );

    await mode("文件比较");
    await choose(0, "long-a.txt");
    await choose(1, "long-b.txt");
    click("开始比较");
    await wait(
      () =>
        [...document.querySelectorAll("button")].some(
          (e) => e.textContent.trim() === "取消比较",
        ),
      "Cancel control missing",
    );
    click("取消比较");
    await wait(
      () =>
        document
          .querySelector('[role="alert"]')
          ?.textContent.includes("已取消"),
      "Task cancellation failed",
    );
    completed.push("background task cancellation");
    await control("test:finished", { completed, droppedPath: dropped.path });
  } catch (error) {
    await control("test:finished", {
      completed,
      error: error.message + "\n" + error.stack,
    });
  }
})();
