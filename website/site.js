const $ = (selector) => document.querySelector(selector);
const menuToggle = $(".menu-toggle");
const navigation = $("#main-nav");
function closeMenu() {
  navigation.classList.remove("is-open");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "展开导航菜单");
}
menuToggle.addEventListener("click", () => {
  const open = !navigation.classList.contains("is-open");
  navigation.classList.toggle("is-open", open);
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute("aria-label", open ? "收起导航菜单" : "展开导航菜单");
});
navigation.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeMenu();
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".site-header")) closeMenu();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && navigation.classList.contains("is-open")) {
    closeMenu();
    menuToggle.focus();
  }
});
window.matchMedia("(min-width:681px)").addEventListener("change", (event) => {
  if (event.matches) closeMenu();
});

const before = [
  "app:",
  "  name: wiiMerge",
  "  version: 0.5.0",
  "compare:",
  "  types: [text, excel]",
  "  ignoreSpaces: false",
  "export:",
  "  format: html",
];
const after = [
  "app:",
  "  name: wiiMerge",
  "  version: {{VERSION}}",
  "compare:",
  "  types: [text, excel, zip]",
  "  ignoreSpaces: true",
  "export:",
  "  format: html",
];
let left = [...before],
  right = [...after],
  selected = -1;
function drawDemo(message) {
  const lines = $("#demo-lines");
  lines.replaceChildren();
  let differences = 0;
  left.forEach((line, index) => {
    const row = document.createElement("div");
    const changed = line !== right[index];
    row.className = `demo-line${changed ? " is-different" : ""}${selected === index ? " is-selected" : ""}`;
    row.dataset.line = String(index);
    if (changed) differences++;
    [line, right[index]].forEach((value) => {
      const cell = document.createElement("div");
      cell.className = "demo-cell";
      const number = document.createElement("span");
      number.className = "demo-number";
      number.textContent = String(index + 1);
      const content = document.createElement("span");
      content.textContent = value;
      content.title = value;
      cell.append(number, content);
      row.append(cell);
    });
    lines.append(row);
  });
  const status = $("#demo-status");
  status.replaceChildren();
  status.classList.toggle("is-equal", differences === 0);
  if (differences) {
    const dot = document.createElement("i");
    dot.className = "change-dot";
    status.append(dot);
  }
  status.append(
    document.createTextNode(
      message || (differences ? `${differences} 处差异` : "两侧内容一致"),
    ),
  );
  document.querySelectorAll("[data-merge]").forEach((button) => {
    button.disabled = differences === 0;
  });
  document.querySelectorAll("[data-jump]").forEach((button) => {
    const index = Number(button.dataset.jump);
    button.hidden = left[index] === right[index];
  });
}
document.querySelectorAll("[data-merge]").forEach((button) =>
  button.addEventListener("click", () => {
    if (button.dataset.merge === "left") {
      right = [...left];
      drawDemo("已采用左侧 · 内容一致");
    } else {
      left = [...right];
      drawDemo("已采用右侧 · 内容一致");
    }
  }),
);
$(".demo-reset").addEventListener("click", () => {
  left = [...before];
  right = [...after];
  selected = -1;
  drawDemo();
});
document.querySelectorAll("[data-jump]").forEach((button) =>
  button.addEventListener("click", () => {
    selected = Number(button.dataset.jump);
    drawDemo();
  }),
);
drawDemo();

const screens = {
  tree: {
    src: "assets/workspace-tree.png",
    width: 1440,
    height: 940,
    alt: "wiiMerge 树形差分一览，展开差异目录并隐藏一致项",
    caption: "展开所有差异，保留完整目录路径，也能隐藏一致项。",
  },
  text: {
    src: "assets/workspace-text.png",
    width: 1440,
    height: 940,
    alt: "wiiMerge 两行紧凑工作区，单条图形导航和左右文本差分",
    caption: "两行紧凑工具栏，沿着单条位置图跳转，再按块采用左侧或右侧内容。",
  },
  excel: {
    src: "assets/workspace-excel.png",
    width: 1050,
    height: 720,
    alt: "wiiMerge 比较 XLS 与 XLSX 文件，显示工作表和单元格差异",
    caption: "XLS 与 XLSX 直接比较，保留工作表、单元格地址与左右两侧数据。",
  },
};
const screenTabs = [...document.querySelectorAll("[data-screen]")];
function chooseScreen(tab) {
  const screen = screens[tab.dataset.screen],
    image = $("#workspace-image");
  screenTabs.forEach((button) => {
    const active = button === tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  image.src = screen.src;
  image.alt = screen.alt;
  image.width = screen.width;
  image.height = screen.height;
  $("#workspace-caption").textContent = screen.caption;
  $("#workspace-panel").setAttribute("aria-labelledby", tab.id);
}
screenTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => chooseScreen(tab));
  tab.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % screenTabs.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + screenTabs.length) % screenTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = screenTabs.length - 1;
    else return;
    event.preventDefault();
    chooseScreen(screenTabs[next]);
    screenTabs[next].focus();
  });
});
const dialog = $("#screenshot-dialog");
$("#open-screenshot").addEventListener("click", () => {
  const source = $("#workspace-image"),
    image = $("#dialog-image");
  image.src = source.src;
  image.alt = source.alt;
  image.width = source.width;
  image.height = source.height;
  dialog.showModal();
  document.body.classList.add("dialog-open");
});
$("#close-screenshot").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      dialog.close();
  }
});
dialog.addEventListener("close", () => {
  document.body.classList.remove("dialog-open");
  $("#open-screenshot").focus();
});
$("#copy-package").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText("wiiMerge-WebView2-Windows-x64");
    $("#copy-status").textContent = "包名已复制";
  } catch {
    $("#copy-status").textContent = "请选择并复制左侧包名";
  }
});
