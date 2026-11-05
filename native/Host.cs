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
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace WiiMerge {
  static class Program {
    [STAThread]
    static void Main(string[] args) {
      Application.EnableVisualStyles();
      Application.SetCompatibleTextRenderingDefault(false);
      try { Application.Run(new MainWindow(args)); }
      catch (Exception error) { MessageBox.Show(error.Message, "wiiMerge 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }
  }

  sealed class MainWindow : Form {
    readonly WebView2 view = new WebView2();
    readonly JavaScriptSerializer serializer = new JavaScriptSerializer();
    readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    readonly string fixtureFile;
    readonly string profile;
    readonly string token;
    readonly HttpClient client = new HttpClient(new HttpClientHandler { UseProxy = false }) { Timeout = TimeSpan.FromSeconds(130) };
    Process engine;
    Uri origin;

    public MainWindow(string[] args) {
      Text = "wiiMerge";
      Width = 1440; Height = 940; MinimumSize = new Size(1050, 720);
      StartPosition = FormStartPosition.CenterScreen;
      Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
      foreach (string arg in args) {
        if (arg.StartsWith("--smoke-fixtures=", StringComparison.Ordinal)) fixtureFile = Path.GetFullPath(arg.Substring(17));
        else if (arg.StartsWith("--profile=", StringComparison.Ordinal)) profile = Path.GetFullPath(arg.Substring(10));
      }
      if (profile == null) profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "wiimerge");
      byte[] key = new byte[32]; using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(key);
      token = BitConverter.ToString(key).Replace("-", "").ToLowerInvariant();
      Controls.Add(view); view.Dock = DockStyle.Fill;
      Shown += async (_, __) => await Start();
      FormClosed += (_, __) => Stop();
    }

    async Task Start() {
      try {
        try { CoreWebView2Environment.GetAvailableBrowserVersionString(); }
        catch (WebView2RuntimeNotFoundException) {
          if (fixtureFile != null) throw new Exception("Microsoft Edge WebView2 Runtime is missing on the test machine.");
          MessageBox.Show("此精简版需要 Microsoft Edge WebView2 Runtime。\n\nWindows 11 通常已自带。请从微软官网安装 Evergreen WebView2 Runtime 后重新运行：\nhttps://developer.microsoft.com/microsoft-edge/webview2/\n\n也可使用自带运行时的 wiiMerge 兼容版。", "需要 WebView2", MessageBoxButtons.OK, MessageBoxIcon.Information);
          Close(); return;
        }
        var start = new ProcessStartInfo {
          FileName = Path.Combine(root, "runtime", "node.exe"),
          Arguments = "--max-old-space-size=768 \"" + Path.Combine(root, "app", "server.cjs") + "\"",
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
        origin = new Uri((string)ready["origin"]);
        if (origin.Scheme != "http" || origin.Host != "127.0.0.1") throw new Exception("无效的本地引擎地址。");
        client.BaseAddress = origin; client.DefaultRequestHeaders.Add("X-WiiMerge-Native", token);
        var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(profile, "WebView2"));
        await view.EnsureCoreWebView2Async(environment);
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
        view.CoreWebView2.Navigate((string)ready["launchURL"]);
      } catch (Exception error) {
        if (fixtureFile != null) File.WriteAllText(Path.Combine(Path.GetDirectoryName(fixtureFile), "host-error.txt"), error.ToString());
        MessageBox.Show(error.Message, "wiiMerge 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error); Close();
      }
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
      if (fixtureFile == null) return null;
      var values = serializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(fixtureFile));
      if (!values.ContainsKey(key)) throw new Exception("测试对话框缺少 " + key);
      return values[key];
    }

    string Open(string kind, bool rules = false) {
      if (fixtureFile != null) return Fixture("open");
      if (kind == "folder") {
        using (var dialog = new FolderBrowserDialog { Description = "选择比较文件夹", ShowNewFolderButton = false }) return dialog.ShowDialog(this) == DialogResult.OK ? dialog.SelectedPath : null;
      }
      using (var dialog = new OpenFileDialog { Title = rules ? "导入比较规则" : "选择比较文件", Filter = rules ? "JSON 规则|*.json" : "所有文件|*.*", Multiselect = false }) return dialog.ShowDialog(this) == DialogResult.OK ? dialog.FileName : null;
    }

    string Save(string format, bool rules = false) {
      if (fixtureFile != null) return Fixture("save");
      using (var dialog = new SaveFileDialog {
        Title = rules ? "导出比较规则" : "导出比较报告", AddExtension = true, OverwritePrompt = true,
        FileName = rules ? "wiiMerge-rules.json" : "wiiMerge-" + DateTime.Now.ToString("yyyy-MM-dd") + "." + format,
        Filter = rules ? "JSON 规则|*.json" : format == "html" ? "HTML 报告|*.html" : "Excel 工作簿|*.xlsx"
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
          default: throw new Exception("不允许的本机操作。");
        }
        if (!IsDisposed) view.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new { id, result }));
      } catch (Exception error) {
        if (!IsDisposed && view.CoreWebView2 != null) view.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new { id, error = error.Message }));
      }
    }

    void Stop() {
      view.Dispose(); client.Dispose();
      if (engine != null) {
        try { engine.StandardInput.Close(); if (!engine.WaitForExit(2500)) engine.Kill(); } catch (InvalidOperationException) { }
        engine.Dispose();
      }
    }
  }
}
