// Unduh teks sebagai file lewat Blob + anchor. Bekerja di browser dan
// webview Tauri (cukup untuk export test case; dialog "Save As" native bisa
// menyusul).

export function downloadText(filename: string, text: string, mime = "text/markdown") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
