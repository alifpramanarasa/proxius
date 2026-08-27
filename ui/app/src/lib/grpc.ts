import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./api";

/** gRPC hanya tersedia di desktop (butuh HTTP/2 native). */
export const grpcAvailable = isTauri;

/** Daftar method "/pkg.Service/Method" dari sumber .proto (via engine Rust). */
export async function grpcMethods(proto: string): Promise<string[]> {
  return invoke<string[]>("grpc_methods", { proto });
}

/** Panggil satu method unary gRPC: proto + JSON request → JSON response. */
export async function grpcUnary(
  endpoint: string,
  proto: string,
  method: string,
  message: string,
): Promise<string> {
  return invoke<string>("grpc_unary", { endpoint, proto, method, message });
}

/** Daftar method sebuah simbol service via server reflection (tanpa proto). */
export async function grpcReflectMethods(endpoint: string, symbol: string): Promise<string[]> {
  return invoke<string[]>("grpc_reflect_methods", { endpoint, symbol });
}

/** Panggil unary via reflection: endpoint + symbol + method + JSON → JSON. */
export async function grpcUnaryReflect(
  endpoint: string,
  symbol: string,
  method: string,
  message: string,
): Promise<string> {
  return invoke<string>("grpc_unary_reflect", { endpoint, symbol, method, message });
}
