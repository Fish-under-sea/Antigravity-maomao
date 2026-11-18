import { execFile } from "node:child_process";

function runPicker(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf8", timeout: 120000 }, (err, stdout) => {
      if (err) {
        // User canceled dialog returns non-zero in zenity/osascript
        if (err.code === 1) {
          resolve(null);
          return;
        }
        reject(err);
        return;
      }
      const picked = String(stdout || "").trim();
      resolve(picked || null);
    });
  });
}

export async function pickLocalMediaFile() {
  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dlg = New-Object System.Windows.Forms.OpenFileDialog",
      "$dlg.Title = '选择织梦皮肤背景（MP4 / WEBM / 图片）'",
      "$dlg.Filter = '图片与视频 (*.mp4;*.webm;*.png;*.jpg;*.jpeg;*.webp;*.gif)|*.mp4;*.webm;*.png;*.jpg;*.jpeg;*.webp;*.gif|视频 (*.mp4;*.webm)|*.mp4;*.webm|图片 (*.png;*.jpg;*.jpeg;*.webp;*.gif)|*.png;*.jpg;*.jpeg;*.webp;*.gif'",
      "$dlg.CheckFileExists = $true",
      "$dlg.Multiselect = $false",
      "if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dlg.FileName) }",
    ].join("; ");
    return runPicker("powershell.exe", ["-NoProfile", "-STA", "-Command", script]);
  }
  if (process.platform === "darwin") {
    return runPicker("osascript", [
      "-e",
      'POSIX path of (choose file with prompt "选择织梦皮肤背景" of type {"public.movie", "public.image"})',
    ]);
  }
  return runPicker("zenity", [
    "--file-selection",
    "--title=选择织梦皮肤背景",
    "--file-filter=Media | *.mp4 *.webm *.png *.jpg *.jpeg *.webp *.gif",
  ]);
}
