// Penyimpanan sementara objek File (khusus mode browser) untuk field file
// pada body form-data. Tidak dipersist — bila tab ditutup/diseka, user pilih ulang.
// Di desktop (Tauri) kita pakai path file, bukan objek File ini.

const store = new Map<string, File>();

export function setFieldFile(id: string, file: File | null): void {
  if (file) store.set(id, file);
  else store.delete(id);
}

export function getFieldFile(id: string): File | undefined {
  return store.get(id);
}
