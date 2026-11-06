using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Linq;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace WiiMerge {
  static class Program {
    [STAThread]
    static void Main(string[] args) {
      Application.EnableVisualStyles();
      Application.SetCompatibleTextRenderingDefault(false);
      try { Application.Run(new MainWindow(args)); }
      catch (Exception error) {
        foreach (string arg in args) if (arg.StartsWith("--smoke-fixtures=", StringComparison.Ordinal)) File.WriteAllText(Path.Combine(Path.GetDirectoryName(arg.Substring(17)), "host-error.txt"), error.ToString());
        MessageBox.Show(error.Message, "wiiMerge 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
      }
    }
  }

  sealed class MainWindow : Form {
    readonly WebView2 view = new WebView2();
    readonly JavaScriptSerializer serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
    readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    readonly string fixtureFile;
    string profile;
    string token;
    readonly HttpClient client = new HttpClient(new HttpClientHandler { UseProxy = false }) { Timeout = System.Threading.Timeout.InfiniteTimeSpan, MaxResponseContentBufferSize = int.MaxValue };
    Process engine;
    Uri origin;
    int openIndex, saveIndex;
    bool testStarted;
    MainWindow sharedOwner;
    readonly List<MainWindow> children = new List<MainWindow>();
    CoreWebView2Environment browserEnvironment;
    string launchUrl, detailQuery = "", reportId;
    bool dirty, discardClosing, shadowEnabled;
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l);
    [StructLayout(LayoutKind.Sequential)] struct NativePoint { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct NativeRect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MinMaxInfo { public NativePoint Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize; }
    [StructLayout(LayoutKind.Sequential)] struct MonitorInfo { public int Size; public NativeRect Monitor, Work; public uint Flags; }
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    // WM_GETMINMAXINFO positions are relative to the monitor, not the virtual desktop.
    static Rectangle MaximizeArea(Rectangle monitor, Rectangle work) {
      return new Rectangle(work.Left - monitor.Left, work.Top - monitor.Top, work.Width, work.Height);
    }
    void ApplyMonitorBounds(IntPtr pointer) {
      var monitor = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
      if (!GetMonitorInfo(MonitorFromWindow(Handle, 2), ref monitor)) return;
      var area = MaximizeArea(Rectangle.FromLTRB(monitor.Monitor.Left, monitor.Monitor.Top, monitor.Monitor.Right, monitor.Monitor.Bottom),
        Rectangle.FromLTRB(monitor.Work.Left, monitor.Work.Top, monitor.Work.Right, monitor.Work.Bottom));
      var limits = (MinMaxInfo)Marshal.PtrToStructure(pointer, typeof(MinMaxInfo));
      limits.MaxPosition = new NativePoint { X = area.X, Y = area.Y };
      limits.MaxSize = new NativePoint { X = area.Width, Y = area.Height };
      limits.MaxTrackSize = limits.MaxSize;
      limits.MinTrackSize.X = Math.Min(limits.MinTrackSize.X, area.Width);
      limits.MinTrackSize.Y = Math.Min(limits.MinTrackSize.Y, area.Height);
      Marshal.StructureToPtr(limits, pointer, false);
    }
    void ToggleMaximize() {
      if (WindowState != FormWindowState.Maximized) { WindowState = FormWindowState.Maximized; SendWindowState(); return; }
      WindowState = FormWindowState.Normal;
      // A monitor may have been disconnected while maximized. Keep the titlebar reachable.
      if (!Screen.AllScreens.Any(screen => Rectangle.Intersect(new Rectangle(Bounds.X, Bounds.Y, Bounds.Width, 40), screen.WorkingArea).Width >= 100)) {
        var work = Screen.FromHandle(Handle).WorkingArea;
        Size = new Size(Math.Min(Width, work.Width), Math.Min(Height, work.Height));
        Location = new Point(work.Left + (work.Width - Width) / 2, work.Top + (work.Height - Height) / 2);
      }
      SendWindowState();
    }
    [StructLayout(LayoutKind.Sequential)] struct Margins { public int Left, Right, Top, Bottom; }
    [DllImport("dwmapi.dll")] static extern int DwmIsCompositionEnabled(out bool enabled);
    [DllImport("dwmapi.dll")] static extern int DwmExtendFrameIntoClientArea(IntPtr h, ref Margins margins);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attribute, ref int value, int size);

    protected override CreateParams CreateParams {
      get { var p = base.CreateParams; p.Style |= 0x00040000 | 0x00020000 | 0x00010000 | 0x00080000; p.ExStyle &= ~0x00000200; return p; }
    }
    void ConfigureShadow() {
      bool enabled;
      if (!IsHandleCreated || DwmIsCompositionEnabled(out enabled) != 0 || !enabled) return;
      int policy = 2, border = unchecked((int)0xfffffffe);
      DwmSetWindowAttribute(Handle, 2, ref policy, sizeof(int));
      // Windows 11 can suppress the accent outline independently of the shadow.
      // Older Windows versions ignore this attribute and still use the DWM frame.
      DwmSetWindowAttribute(Handle, 34, ref border, sizeof(int));
      var margins = new Margins { Left = 1, Right = 1, Top = 1, Bottom = 1 };
      shadowEnabled = DwmExtendFrameIntoClientArea(Handle, ref margins) == 0;
    }
    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); ConfigureShadow(); }
    void SendWindowState() {
      if (!view.IsDisposed && view.CoreWebView2 != null)
        view.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new { type = "window-state", maximized = WindowState == FormWindowState.Maximized }));
    }
    protected override void OnSizeChanged(EventArgs e) {
      base.OnSizeChanged(e);
      // ShowWindow can resize synchronously before WinForms commits WindowState.
      if (view != null && IsHandleCreated && !IsDisposed) BeginInvoke(new Action(SendWindowState));
    }

    public MainWindow(string[] args) {
      Text = "wiiMerge";
      FormBorderStyle = FormBorderStyle.None; Padding = Padding.Empty; BackColor = Color.White;
      Width = 1440; Height = 940; MinimumSize = new Size(1050, 720);
      StartPosition = FormStartPosition.CenterScreen;
      Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
      foreach (string arg in args) {
        if (arg.StartsWith("--smoke-fixtures=", StringComparison.Ordinal)) fixtureFile = Path.GetFullPath(arg.Substring(17));
        else if (arg.StartsWith("--profile=", StringComparison.Ordinal)) profile = Path.GetFullPath(arg.Substring(10));
      }
      if (profile == null) profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "wiimerge");
      Trace("window constructed");
      byte[] key = new byte[32]; using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(key);
      token = BitConverter.ToString(key).Replace("-", "").ToLowerInvariant();
      Controls.Add(view); view.Dock = DockStyle.Fill;
      Shown += async (_, __) => await Start();
      FormClosing += (_, e) => {
        if (!discardClosing && (dirty || children.Any(c => c.dirty)) && MessageBox.Show(this, "存在未保存的合并内容，仍要关闭窗口吗？", "未保存改动", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) { e.Cancel = true; return; }
        foreach (var child in children.ToArray()) { child.discardClosing = true; child.Close(); }
      };
      FormClosed += (_, __) => Stop();
    }

    async Task Start() {
      try {
        Trace("window shown; checking WebView2 runtime");
        try { CoreWebView2Environment.GetAvailableBrowserVersionString(); }
        catch (WebView2RuntimeNotFoundException) {
          if (fixtureFile != null) throw new Exception("Microsoft Edge WebView2 Runtime is missing on the test machine.");
          MessageBox.Show("此精简版需要 Microsoft Edge WebView2 Runtime。\n\nWindows 11 通常已自带。请从微软官网安装 Evergreen WebView2 Runtime 后重新运行：\nhttps://developer.microsoft.com/microsoft-edge/webview2/\n\n也可使用自带运行时的 wiiMerge 兼容版。", "需要 WebView2", MessageBoxButtons.OK, MessageBoxIcon.Information);
          Close(); return;
        }
        Trace("WebView2 runtime available; starting comparison engine");
        if (sharedOwner == null) {
        var start = new ProcessStartInfo {
          FileName = Path.Combine(root, "runtime", "node.exe"),
          Arguments = "\"" + Path.Combine(root, "app", "server.cjs") + "\"",
          WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
          RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        };
        start.EnvironmentVariables["WIIMERGE_NATIVE_TOKEN"] = token;
        start.EnvironmentVariables["WIIMERGE_DATA_DIR"] = profile;
        // Node remains a private comparison engine; user Node options must not
        // redirect the trusted child process or enable remote debugging on it.
        start.EnvironmentVariables.Remove("NODE_OPTIONS");
        engine = Process.Start(start);
        engine.ErrorDataReceived += (_, __) => { }; engine.BeginErrorReadLine();
        var reading = engine.StandardOutput.ReadLineAsync();
        if (await Task.WhenAny(reading, Task.Delay(20000)) != reading) throw new Exception("本地比较引擎启动超时。");
        string line = await reading;
        if (line == null) throw new Exception("本地比较引擎未能启动，请重新解压完整安装包。");
        var ready = serializer.Deserialize<Dictionary<string, object>>(line);
        Trace("comparison engine ready");
        launchUrl = (string)ready["launchURL"];
        origin = new Uri((string)ready["origin"]);
        if (origin.Scheme != "http" || origin.Host != "127.0.0.1") throw new Exception("无效的本地引擎地址。");
        client.BaseAddress = origin; client.DefaultRequestHeaders.Add("X-WiiMerge-Native", token);
        Trace("creating browser environment");
        browserEnvironment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(profile, "WebView2"));
        Trace("browser environment ready; creating view");
        } else { origin = sharedOwner.origin; launchUrl = sharedOwner.launchUrl; browserEnvironment = sharedOwner.browserEnvironment; client.BaseAddress = origin; client.DefaultRequestHeaders.Add("X-WiiMerge-Native", token); }
        await view.EnsureCoreWebView2Async(browserEnvironment);
        Trace("view ready");
        view.CoreWebView2.Settings.AreDevToolsEnabled = fixtureFile != null;
        view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
        view.CoreWebView2.Settings.IsStatusBarEnabled = false;
        view.CoreWebView2.NavigationStarting += (_, e) => {
          Uri target;
          if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out target) || target.Scheme != origin.Scheme || target.Host != origin.Host || target.Port != origin.Port) e.Cancel = true;
        };
        view.CoreWebView2.NewWindowRequested += (_, e) => e.Handled = true;
        view.CoreWebView2.DownloadStarting += (_, e) => e.Cancel = true;
        view.CoreWebView2.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        view.CoreWebView2.WebMessageReceived += Message;
        view.CoreWebView2.NavigationCompleted += async (_, e) => {
          if (e.IsSuccess) SendWindowState();
          if ((fixtureFile == null && sharedOwner?.fixtureFile == null) || testStarted || !e.IsSuccess) return;
          Uri current;
          if (!Uri.TryCreate(view.CoreWebView2.Source, UriKind.Absolute, out current) || current.Host != origin.Host || current.Port != origin.Port || current.AbsolutePath != "/") return;
          testStarted = true;
          Trace("document loaded; running native UI checks");
          try { await view.CoreWebView2.ExecuteScriptAsync(File.ReadAllText(Fixture(sharedOwner == null ? "script" : "diffScript"))); }
          catch (Exception error) { File.WriteAllText(Fixture(sharedOwner == null ? "result" : "diffResult"), serializer.Serialize(new { error = error.ToString() })); }
        };
        view.CoreWebView2.Navigate(launchUrl + detailQuery);
        Trace("navigation requested");
      } catch (Exception error) {
        if (fixtureFile != null) File.WriteAllText(Path.Combine(Path.GetDirectoryName(fixtureFile), "host-error.txt"), error.ToString());
        MessageBox.Show(error.Message, "wiiMerge 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error); Close();
      }
    }

    void Trace(string stage) {
      if (fixtureFile != null) File.AppendAllText(Path.Combine(Path.GetDirectoryName(fixtureFile), "host-state.txt"), stage + Environment.NewLine);
    }

    async Task<object> Post(string route, object data) {
      using (var response = await client.PostAsync(route, new StringContent(serializer.Serialize(data), System.Text.Encoding.UTF8, "application/json"))) {
        var result = serializer.DeserializeObject(await response.Content.ReadAsStringAsync());
        if (!response.IsSuccessStatusCode) {
          var values = result as Dictionary<string, object>;
          throw new Exception(values != null && values.ContainsKey("error") ? (string)values["error"] : "本地引擎请求失败。");
        }
        return result;
      }
    }

    string Fixture(string key) {
      var file = fixtureFile ?? sharedOwner?.fixtureFile;
      if (file == null) return null;
      var values = serializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(file));
      if (!values.ContainsKey(key) && (key == "open" || key == "save")) key += (key == "open" ? openIndex++ : saveIndex++).ToString();
      if (!values.ContainsKey(key)) throw new Exception("测试对话框缺少 " + key);
      return values[key];
    }

    string Open(string kind, bool rules = false) {
      if (fixtureFile != null || sharedOwner?.fixtureFile != null) return Fixture("open");
      if (kind == "folder") {
        using (var dialog = new FolderBrowserDialog { Description = "选择比较文件夹", ShowNewFolderButton = false }) return dialog.ShowDialog(this) == DialogResult.OK ? dialog.SelectedPath : null;
      }
      using (var dialog = new OpenFileDialog { Title = rules ? "导入比较规则" : "选择比较文件", Filter = rules ? "JSON 规则|*.json" : "所有文件|*.*", Multiselect = false }) return dialog.ShowDialog(this) == DialogResult.OK ? dialog.FileName : null;
    }

    string Save(string format, bool rules = false) {
      if (fixtureFile != null || sharedOwner?.fixtureFile != null) return Fixture("save");
      using (var dialog = new SaveFileDialog {
        Title = rules ? "导出比较规则" : "导出比较报告", AddExtension = true, OverwritePrompt = true,
        FileName = rules ? "wiiMerge-rules.json" : "wiiMerge-" + DateTime.Now.ToString("yyyy-MM-dd") + "." + format,
        Filter = rules ? "JSON 规则|*.json" : format == "html" ? "HTML 报告|*.html" : format == "txt" ? "文本文件|*.txt|所有文件|*.*" : "Excel 工作簿|*.xlsx"
      }) return dialog.ShowDialog(this) == DialogResult.OK ? dialog.FileName : null;
    }

    async void Message(object sender, CoreWebView2WebMessageReceivedEventArgs message) {
      object id = null;
      try {
        // Never accept native requests from another document origin.
        var source = new Uri(message.Source);
        if (source.Scheme != origin.Scheme || source.Host != origin.Host || source.Port != origin.Port) return;
        var request = serializer.Deserialize<Dictionary<string, object>>(message.WebMessageAsJson);
        id = request["id"];
        var args = (Dictionary<string, object>)request["args"];
        object result = null;
        string filename;
        switch ((string)request["method"]) {
          case "windowAction":
            switch ((string)args["action"]) {
              case "minimize": WindowState = FormWindowState.Minimized; break;
              case "maximize": ToggleMaximize(); break;
              case "close": BeginInvoke(new Action(Close)); break;
              case "drag": ReleaseCapture(); SendMessage(Handle, 0xA1, new IntPtr(2), IntPtr.Zero); break;
              case "resize-n": case "resize-s": case "resize-e": case "resize-w":
              case "resize-ne": case "resize-nw": case "resize-se": case "resize-sw":
                if (WindowState == FormWindowState.Normal) {
                  var hits = new Dictionary<string,int> { {"resize-w",10},{"resize-e",11},{"resize-n",12},{"resize-nw",13},{"resize-ne",14},{"resize-s",15},{"resize-sw",16},{"resize-se",17} };
                  ReleaseCapture(); SendMessage(Handle, 0xA1, new IntPtr(hits[(string)args["action"]]), IntPtr.Zero);
                } break;
              default: throw new Exception("无效的窗口操作。");
            } result = true; break;
          case "setDirty": dirty = Convert.ToBoolean(args["value"]); result = true; break;
          case "openDiff": {
            string reportId = (string)args["reportId"];
            await Post("/native/report-info", new { id = reportId });
            var child = new MainWindow(new string[0]);
            child.sharedOwner = sharedOwner ?? this; child.profile = profile; child.token = token;
            child.reportId = reportId;
            child.detailQuery = "?view=diff&report=" + Uri.EscapeDataString(reportId) + (args.ContainsKey("itemKey") && args["itemKey"] != null ? "&item=" + Uri.EscapeDataString((string)args["itemKey"]) : "") + (args.ContainsKey("folderKey") && args["folderKey"] != null ? "&folder=" + Uri.EscapeDataString((string)args["folderKey"]) : "");
            var owner = sharedOwner ?? this;
            owner.children.Add(child);
            child.FormClosed += async (_, __) => {
              owner.children.Remove(child);
              if (!owner.children.Any(c => c.reportId == reportId))
                try { await owner.Post("/native/release-report", new { id = reportId }); } catch { }
            };
            child.Show(); result = true; break;
          }
          case "adoptFile":
            if (fixtureFile == null && sharedOwner?.fixtureFile == null && MessageBox.Show(this,"将用选定一侧整体替换另一侧文件，并保存原文件备份。继续吗？","整文件采用",MessageBoxButtons.YesNo,MessageBoxIcon.Warning)!=DialogResult.Yes) break;
            result = await Post("/native/adopt-file",args); break;
          case "saveDocument": {
            string side = (string)args["side"];
            if (side != "left" && side != "right") throw new Exception("无效的保存方向。");
            var info = (Dictionary<string, object>)await Post("/native/document-info", new { id = args["id"] });
            var sides = (Dictionary<string, object>)info["sides"]; var selectedSide = (Dictionary<string, object>)sides[side];
            bool saveAs = Convert.ToBoolean(args["saveAs"]) || !Convert.ToBoolean(selectedSide["writable"]);
            string destination = saveAs ? Save("txt") : null;
            if (!saveAs || destination != null) result = await Post("/native/save-document", new { id = args["id"], side, path = destination }); break;
          }
          case "droppedPaths": {
            if (message.AdditionalObjects == null || message.AdditionalObjects.Count < 1 || message.AdditionalObjects.Count > 2) throw new Exception("一次拖入一个或两个文件 / 文件夹。");
            var values = new List<object>();
            foreach (object obj in message.AdditionalObjects) { var file = obj as CoreWebView2File; if (file == null) throw new Exception("无效的拖放文件。"); values.Add(await Post("/native/authorize", new { path = file.Path })); }
            result = values; break;
          }
          case "choosePath":
            string kind = (string)args["kind"];
            if (kind != "file" && kind != "folder") throw new Exception("无效的选择类型。");
            filename = Open(kind);
            if (filename != null) { var authorized = (Dictionary<string, object>)await Post("/native/authorize", new { path = filename }); result = authorized["path"]; } break;
          case "droppedPath":
            if (message.AdditionalObjects == null || message.AdditionalObjects.Count != 1 || !(message.AdditionalObjects[0] is CoreWebView2File)) throw new Exception("无效的拖放文件。");
            filename = ((CoreWebView2File)message.AdditionalObjects[0]).Path;
            result = await Post("/native/authorize", new { path = filename }); break;
          case "exportReport":
            string format = (string)args["format"];
            if (format != "html" && format != "xlsx") throw new Exception("不支持的导出格式。");
            filename = Save(format);
            if (filename != null) result = await Post("/native/export-report", new { path = filename, format, id = args["id"] }); break;
          case "importRules":
            filename = Open("file", true); if (filename != null) result = await Post("/native/import-rules", new { path = filename }); break;
          case "exportRules":
            filename = Save("json", true); if (filename != null) result = await Post("/native/export-rules", new { path = filename, rules = args["rules"] }); break;
          case "test:attachFile": {
            if (fixtureFile == null && sharedOwner?.fixtureFile == null) throw new Exception("测试接口未启用。");
            var document = serializer.Deserialize<Dictionary<string, object>>(await view.CoreWebView2.CallDevToolsProtocolMethodAsync("DOM.getDocument", "{}"));
            var documentRoot = (Dictionary<string, object>)document["root"];
            var node = serializer.Deserialize<Dictionary<string, object>>(await view.CoreWebView2.CallDevToolsProtocolMethodAsync("DOM.querySelector", serializer.Serialize(new { nodeId = documentRoot["nodeId"], selector = "#native-host-file-test" })));
            await view.CoreWebView2.CallDevToolsProtocolMethodAsync("DOM.setFileInputFiles", serializer.Serialize(new { nodeId = node["nodeId"], files = new[] { Fixture("drop") } }));
            result = true; break;
          }
          case "test:capture":
            if (fixtureFile == null && sharedOwner?.fixtureFile == null) throw new Exception("测试接口未启用。");
            using (var image = File.Create(Fixture(sharedOwner == null ? "screenshot" : "diffScreenshot"))) await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, image);
            result = true; break;
          case "test:childStatus":
            if (fixtureFile == null) throw new Exception("测试接口未启用。");
            result = File.Exists(Fixture("diffResult")) ? serializer.DeserializeObject(File.ReadAllText(Fixture("diffResult"))) : null; break;
          case "test:resetChild":
            if (fixtureFile == null) throw new Exception("测试接口未启用。");
            if (File.Exists(Fixture("diffResult"))) File.Delete(Fixture("diffResult")); result = true; break;
          case "test:dropPair":
            if (fixtureFile == null) throw new Exception("测试接口未启用。");
            var docForDrop = serializer.Deserialize<Dictionary<string, object>>(await view.CoreWebView2.CallDevToolsProtocolMethodAsync("DOM.getDocument", "{}"));
            var inputForDrop = serializer.Deserialize<Dictionary<string, object>>(await view.CoreWebView2.CallDevToolsProtocolMethodAsync("DOM.querySelector", serializer.Serialize(new { nodeId = ((Dictionary<string, object>)docForDrop["root"])["nodeId"], selector = "#native-host-file-test" })));
            await view.CoreWebView2.CallDevToolsProtocolMethodAsync("DOM.setFileInputFiles", serializer.Serialize(new { nodeId = inputForDrop["nodeId"], files = new[] { Fixture("dropLeft"), Fixture("dropRight") } })); result = true; break;
          case "test:windowGeometry":
            if (fixtureFile == null && sharedOwner?.fixtureFile == null) throw new Exception("测试接口未启用。");
            var screen = Screen.FromHandle(Handle);
            result = new { state = WindowState.ToString(), bounds = new { x = Left, y = Top, width = Width, height = Height }, work = new { x = screen.WorkingArea.X, y = screen.WorkingArea.Y, width = screen.WorkingArea.Width, height = screen.WorkingArea.Height },
              cases = new[] {
                MaximizeArea(new Rectangle(1920, 0, 2560, 1440), new Rectangle(1920, 0, 2560, 1400)),
                MaximizeArea(new Rectangle(-1920, 0, 1920, 1080), new Rectangle(-1880, 0, 1880, 1080)),
                MaximizeArea(new Rectangle(0, -1440, 2560, 1440), new Rectangle(0, -1400, 2560, 1400)),
                MaximizeArea(new Rectangle(-2560, -1440, 2560, 1440), new Rectangle(-2560, -1440, 2560, 1400))
              }.Select(area => new { x = area.X, y = area.Y, width = area.Width, height = area.Height }).ToArray() }; break;
          case "test:finished":
            if (fixtureFile == null && sharedOwner?.fixtureFile == null) throw new Exception("测试接口未启用。");
            args["frameless"] = FormBorderStyle == FormBorderStyle.None;
            args["borderless"] = Padding == Padding.Empty;
            args["shadowEnabled"] = shadowEnabled;
            File.WriteAllText(Fixture(sharedOwner == null ? "result" : "diffResult"), serializer.Serialize(args)); result = true; break;
          default: throw new Exception("不允许的本机操作。");
        }
        if (!IsDisposed) view.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new { id, result }));
      } catch (Exception error) {
        if (!IsDisposed && view.CoreWebView2 != null) view.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new { id, error = error.Message }));
      }
    }

    protected override void WndProc(ref System.Windows.Forms.Message m) {
      // Keep the resize/snap styles for DWM shadows without a non-client border.
      if (m.Msg == 0x83 && m.WParam != IntPtr.Zero) { m.Result = IntPtr.Zero; return; }
      base.WndProc(ref m);
      if (m.Msg == 0x24 && m.LParam != IntPtr.Zero) ApplyMonitorBounds(m.LParam);
      if (m.Msg == 0x31e) ConfigureShadow();
      if (m.Msg == 0x84 && WindowState == FormWindowState.Normal) {
        var p = PointToClient(Cursor.Position); bool l = p.X < 6, r = p.X >= ClientSize.Width - 6, t = p.Y < 6, b = p.Y >= ClientSize.Height - 6;
        if (l || r || t || b) m.Result = new IntPtr(t ? (l ? 13 : r ? 14 : 12) : b ? (l ? 16 : r ? 17 : 15) : l ? 10 : 11);
      }
    }
    void Stop() {
      view.Dispose(); client.Dispose();
      if (sharedOwner == null && engine != null) {
        try { engine.StandardInput.Close(); if (!engine.WaitForExit(2500)) engine.Kill(); } catch (InvalidOperationException) { }
        engine.Dispose();
      }
    }
  }
}
