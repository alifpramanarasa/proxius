//! Inti gRPC dinamis untuk Proxius.
//!
//! Fase 1 (crate ini): parse `.proto` tanpa `protoc` (pure-Rust via protox),
//! lalu encode/decode pesan protobuf ↔ JSON berdasarkan deskriptor. Ini bagian
//! tersulit & bisa diuji tanpa jaringan (lihat #[test]).
//! Fase 2 (menyusul): transport HTTP/2 via tonic + Tauri command + UI.

use anyhow::{anyhow, Context, Result};
use prost::Message;
use prost_reflect::{DescriptorPool, DynamicMessage, MethodDescriptor};
use prost_types::FileDescriptorSet;
use serde::Serialize;

/// Compile sumber `.proto` (self-contained, tanpa import eksternal) → DescriptorPool.
pub fn compile_proto(name: &str, source: &str) -> Result<DescriptorPool> {
    let fdp = protox_parse::parse(name, source).map_err(|e| anyhow!("parse proto gagal: {e}"))?;
    let set = FileDescriptorSet { file: vec![fdp] };
    DescriptorPool::from_file_descriptor_set(set).context("bangun descriptor pool gagal")
}

/// Bangun DescriptorPool dari byte FileDescriptorProto (mis. hasil server reflection).
pub fn pool_from_file_descriptors(files: Vec<Vec<u8>>) -> Result<DescriptorPool> {
    let mut set = FileDescriptorSet { file: Vec::new() };
    for bytes in files {
        let fdp = prost_types::FileDescriptorProto::decode(bytes.as_slice())
            .context("decode FileDescriptorProto gagal")?;
        set.file.push(fdp);
    }
    DescriptorPool::from_file_descriptor_set(set).context("bangun pool dari deskriptor gagal")
}

/// Daftar path method "/package.Service/Method" yang tersedia.
pub fn list_methods(pool: &DescriptorPool) -> Vec<String> {
    let mut out = Vec::new();
    for svc in pool.services() {
        for m in svc.methods() {
            out.push(format!("/{}/{}", svc.full_name(), m.name()));
        }
    }
    out
}

fn find_method(pool: &DescriptorPool, path: &str) -> Result<MethodDescriptor> {
    let p = path.trim_start_matches('/');
    let (svc_name, method_name) = p
        .rsplit_once('/')
        .ok_or_else(|| anyhow!("path method tidak valid: {path}"))?;
    let svc = pool
        .get_service_by_name(svc_name)
        .ok_or_else(|| anyhow!("service tidak ditemukan: {svc_name}"))?;
    let method = svc.methods().find(|m| m.name() == method_name);
    method.ok_or_else(|| anyhow!("method tidak ditemukan: {method_name}"))
}

/// JSON request → byte protobuf (message input dari method).
pub fn encode_request(pool: &DescriptorPool, method_path: &str, json: &str) -> Result<Vec<u8>> {
    let method = find_method(pool, method_path)?;
    let mut de = serde_json::Deserializer::from_str(json);
    let msg = DynamicMessage::deserialize(method.input(), &mut de)
        .context("JSON tidak cocok dengan message input")?;
    de.end().ok();
    Ok(msg.encode_to_vec())
}

/// Array JSON → banyak byte protobuf (untuk client/bidi streaming).
pub fn encode_requests(pool: &DescriptorPool, method_path: &str, json_array: &str) -> Result<Vec<Vec<u8>>> {
    let arr: Vec<serde_json::Value> = serde_json::from_str(json_array)
        .context("streaming: request harus array JSON, mis. [{...},{...}]")?;
    arr.iter()
        .map(|v| encode_request(pool, method_path, &serde_json::to_string(v)?))
        .collect()
}

/// Byte protobuf response → JSON (message output dari method).
pub fn decode_response(pool: &DescriptorPool, method_path: &str, bytes: &[u8]) -> Result<String> {
    let method = find_method(pool, method_path)?;
    let msg = DynamicMessage::decode(method.output(), bytes).context("decode response gagal")?;
    let mut buf = Vec::new();
    let mut ser = serde_json::Serializer::new(&mut buf);
    msg.serialize(&mut ser).context("serialize JSON gagal")?;
    Ok(String::from_utf8(buf)?)
}

// ── Transport (Fase 2): tonic HTTP/2, unary. Perlu server gRPC nyata utk uji. ──

use bytes::{Buf, BufMut};
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};

/// Codec "mentah": pesan sudah berupa byte protobuf (encode/decode di luar).
#[derive(Default)]
struct RawCodec;
struct RawEncoder;
struct RawDecoder;

impl Codec for RawCodec {
    type Encode = Vec<u8>;
    type Decode = Vec<u8>;
    type Encoder = RawEncoder;
    type Decoder = RawDecoder;
    fn encoder(&mut self) -> RawEncoder {
        RawEncoder
    }
    fn decoder(&mut self) -> RawDecoder {
        RawDecoder
    }
}
impl Encoder for RawEncoder {
    type Item = Vec<u8>;
    type Error = tonic::Status;
    fn encode(&mut self, item: Vec<u8>, dst: &mut EncodeBuf<'_>) -> Result<(), tonic::Status> {
        dst.put_slice(&item);
        Ok(())
    }
}
impl Decoder for RawDecoder {
    type Item = Vec<u8>;
    type Error = tonic::Status;
    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<Vec<u8>>, tonic::Status> {
        let mut v = vec![0u8; src.remaining()];
        src.copy_to_slice(&mut v);
        Ok(Some(v))
    }
}

/// Panggil satu method unary gRPC; kirim byte protobuf, terima byte protobuf.
pub async fn call_unary(endpoint: &str, method_path: &str, req: Vec<u8>) -> Result<Vec<u8>> {
    let channel = tonic::transport::Channel::from_shared(endpoint.to_string())
        .context("endpoint gRPC tidak valid")?
        .connect()
        .await
        .context("gagal konek ke server gRPC")?;
    let mut client = tonic::client::Grpc::new(channel);
    client
        .ready()
        .await
        .map_err(|e| anyhow!("channel gRPC belum siap: {e}"))?;
    let path = http::uri::PathAndQuery::from_maybe_shared(method_path.to_string())
        .context("path method tidak valid")?;
    let resp = client
        .unary(tonic::Request::new(req), path, RawCodec)
        .await
        .map_err(|s| anyhow!("gRPC status: {s}"))?;
    Ok(resp.into_inner())
}

/// Panggil method server-streaming; kumpulkan semua pesan response (byte).
pub async fn call_server_streaming(
    endpoint: &str,
    method_path: &str,
    req: Vec<u8>,
) -> Result<Vec<Vec<u8>>> {
    let channel = tonic::transport::Channel::from_shared(endpoint.to_string())
        .context("endpoint gRPC tidak valid")?
        .connect()
        .await
        .context("gagal konek ke server gRPC")?;
    let mut client = tonic::client::Grpc::new(channel);
    client
        .ready()
        .await
        .map_err(|e| anyhow!("channel gRPC belum siap: {e}"))?;
    let path = http::uri::PathAndQuery::from_maybe_shared(method_path.to_string())
        .context("path method tidak valid")?;
    let resp = client
        .server_streaming(tonic::Request::new(req), path, RawCodec)
        .await
        .map_err(|s| anyhow!("gRPC status: {s}"))?;
    let mut inner = resp.into_inner();
    let mut out = Vec::new();
    while let Some(msg) = inner.message().await.map_err(|s| anyhow!("gRPC recv: {s}"))? {
        out.push(msg);
    }
    Ok(out)
}

/// Panggil method client/bidi streaming: kirim banyak request, kumpulkan response.
pub async fn call_streaming(
    endpoint: &str,
    method_path: &str,
    reqs: Vec<Vec<u8>>,
) -> Result<Vec<Vec<u8>>> {
    let channel = tonic::transport::Channel::from_shared(endpoint.to_string())
        .context("endpoint gRPC tidak valid")?
        .connect()
        .await
        .context("gagal konek ke server gRPC")?;
    let mut client = tonic::client::Grpc::new(channel);
    client
        .ready()
        .await
        .map_err(|e| anyhow!("channel gRPC belum siap: {e}"))?;
    let path = http::uri::PathAndQuery::from_maybe_shared(method_path.to_string())
        .context("path method tidak valid")?;
    let out = futures::stream::iter(reqs);
    let resp = client
        .streaming(tonic::Request::new(out), path, RawCodec)
        .await
        .map_err(|s| anyhow!("gRPC status: {s}"))?;
    let mut inner = resp.into_inner();
    let mut collected = Vec::new();
    while let Some(m) = inner.message().await.map_err(|s| anyhow!("gRPC recv: {s}"))? {
        collected.push(m);
    }
    Ok(collected)
}

fn decode_msg(method: &MethodDescriptor, bytes: &[u8]) -> Result<serde_json::Value> {
    let dm = DynamicMessage::decode(method.output(), bytes).context("decode response gagal")?;
    let mut buf = Vec::new();
    dm.serialize(&mut serde_json::Serializer::new(&mut buf))
        .context("serialize JSON gagal")?;
    Ok(serde_json::from_slice(&buf)?)
}

/// Router: pilih unary / server-streaming / client-bidi berdasarkan descriptor.
/// Unary → 1 objek JSON; streaming apa pun → array JSON pesan.
/// Untuk client/bidi, `json` harus array `[{...},{...}]`.
async fn call_and_decode(
    pool: &DescriptorPool,
    endpoint: &str,
    method_path: &str,
    json: &str,
) -> Result<String> {
    let method = find_method(pool, method_path)?;
    let client_stream = method.is_client_streaming();
    let server_stream = method.is_server_streaming();

    let msgs: Vec<Vec<u8>> = if client_stream {
        let reqs = encode_requests(pool, method_path, json)?;
        call_streaming(endpoint, method_path, reqs).await?
    } else if server_stream {
        let req = encode_request(pool, method_path, json)?;
        call_server_streaming(endpoint, method_path, req).await?
    } else {
        let req = encode_request(pool, method_path, json)?;
        vec![call_unary(endpoint, method_path, req).await?]
    };

    let items = msgs
        .iter()
        .map(|m| decode_msg(&method, m))
        .collect::<Result<Vec<_>>>()?;
    // Unary → objek tunggal; streaming → array.
    if !client_stream && !server_stream {
        Ok(serde_json::to_string_pretty(&items[0])?)
    } else {
        Ok(serde_json::to_string_pretty(&items)?)
    }
}

/// Alur lengkap: compile proto → encode JSON → panggil (unary/stream) → JSON.
pub async fn grpc_unary(
    endpoint: &str,
    proto: &str,
    method_path: &str,
    json: &str,
) -> Result<String> {
    let pool = compile_proto("service.proto", proto)?;
    call_and_decode(&pool, endpoint, method_path, json).await
}

// ── Server reflection: ambil deskriptor dari server (tanpa paste .proto) ──

const REFLECTION_PATH: &str = "/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo";
const REFLECTION_PROTO: &str = r#"
syntax = "proto3";
package grpc.reflection.v1alpha;
message ServerReflectionRequest {
  string host = 1;
  oneof message_request {
    string file_by_filename = 3;
    string file_containing_symbol = 4;
    string list_services = 7;
  }
}
message ServerReflectionResponse {
  string valid_host = 1;
  ServerReflectionRequest original_request = 2;
  oneof message_response {
    FileDescriptorResponse file_descriptor_response = 4;
    ListServiceResponse list_services_response = 6;
    ErrorResponse error_response = 7;
  }
}
message FileDescriptorResponse { repeated bytes file_descriptor_proto = 1; }
message ListServiceResponse { repeated ServiceResponse service = 1; }
message ServiceResponse { string name = 1; }
message ErrorResponse { int32 error_code = 1; string error_message = 2; }
service ServerReflection {
  rpc ServerReflectionInfo(stream ServerReflectionRequest)
      returns (stream ServerReflectionResponse);
}
"#;

/// Ambil deskriptor sebuah simbol (mis. "pkg.Service") via gRPC reflection → pool.
pub async fn reflect(endpoint: &str, symbol: &str) -> Result<DescriptorPool> {
    use prost_reflect::Value;

    let refl_pool = compile_proto("reflection.proto", REFLECTION_PROTO)?;
    let method = find_method(&refl_pool, REFLECTION_PATH)?;

    // Bangun request: file_containing_symbol = symbol.
    let mut req = DynamicMessage::new(method.input());
    req.set_field_by_name("file_containing_symbol", Value::String(symbol.to_string()));
    let req_bytes = req.encode_to_vec();

    let channel = tonic::transport::Channel::from_shared(endpoint.to_string())
        .context("endpoint gRPC tidak valid")?
        .connect()
        .await
        .context("gagal konek ke server gRPC")?;
    let mut client = tonic::client::Grpc::new(channel);
    client
        .ready()
        .await
        .map_err(|e| anyhow!("channel gRPC belum siap: {e}"))?;
    let path = http::uri::PathAndQuery::from_static(REFLECTION_PATH);
    let out = futures::stream::once(async move { req_bytes });
    let resp = client
        .streaming(tonic::Request::new(out), path, RawCodec)
        .await
        .map_err(|s| anyhow!("gRPC status: {s}"))?;
    let mut inner = resp.into_inner();
    let msg = inner
        .message()
        .await
        .map_err(|s| anyhow!("gRPC recv: {s}"))?
        .ok_or_else(|| anyhow!("tidak ada respons reflection"))?;

    let resp_msg = DynamicMessage::decode(method.output(), msg.as_slice())
        .context("decode reflection response gagal")?;
    let fdr = resp_msg
        .get_field_by_name("file_descriptor_response")
        .map(|c| c.into_owned())
        .ok_or_else(|| anyhow!("server tak mengembalikan file descriptor (reflection tidak aktif?)"))?;
    let fdr_msg = fdr
        .as_message()
        .ok_or_else(|| anyhow!("format reflection tak terduga"))?;
    let list = fdr_msg
        .get_field_by_name("file_descriptor_proto")
        .map(|c| c.into_owned())
        .ok_or_else(|| anyhow!("tidak ada file_descriptor_proto"))?;
    let arr = list
        .as_list()
        .ok_or_else(|| anyhow!("file_descriptor_proto bukan list"))?;
    let files: Vec<Vec<u8>> = arr
        .iter()
        .filter_map(|v| v.as_bytes().map(|b| b.to_vec()))
        .collect();
    pool_from_file_descriptors(files)
}

/// Reflection → daftar method service.
pub async fn reflect_methods(endpoint: &str, symbol: &str) -> Result<Vec<String>> {
    Ok(list_methods(&reflect(endpoint, symbol).await?))
}

/// Reflection + panggil unary tanpa perlu paste proto.
pub async fn grpc_unary_reflect(
    endpoint: &str,
    symbol: &str,
    method_path: &str,
    json: &str,
) -> Result<String> {
    let pool = reflect(endpoint, symbol).await?;
    call_and_decode(&pool, endpoint, method_path, json).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROTO: &str = r#"
        syntax = "proto3";
        package echo;
        message EchoRequest { string text = 1; int32 n = 2; }
        message EchoReply { string text = 1; }
        service Echo { rpc Say(EchoRequest) returns (EchoReply); }
    "#;

    #[test]
    fn compiles_and_lists_methods() {
        let pool = compile_proto("echo.proto", PROTO).unwrap();
        let methods = list_methods(&pool);
        assert!(methods.iter().any(|m| m == "/echo.Echo/Say"), "{methods:?}");
    }

    #[test]
    fn pool_from_descriptor_bytes_roundtrip() {
        // Simulasikan reflection: encode FileDescriptorProto → byte → bangun ulang pool.
        let pool = compile_proto("echo.proto", PROTO).unwrap();
        let files: Vec<Vec<u8>> = pool
            .file_descriptor_protos()
            .map(|f| f.encode_to_vec())
            .collect();
        let pool2 = pool_from_file_descriptors(files).unwrap();
        assert!(list_methods(&pool2).iter().any(|m| m == "/echo.Echo/Say"));
    }

    #[test]
    fn encode_requests_array_for_streaming() {
        let pool = compile_proto("echo.proto", PROTO).unwrap();
        let batch =
            encode_requests(&pool, "/echo.Echo/Say", r#"[{"text":"a"},{"text":"b","n":2}]"#).unwrap();
        assert_eq!(batch.len(), 2);
        let desc = pool.get_message_by_name("echo.EchoRequest").unwrap();
        let m1 = DynamicMessage::decode(desc, batch[1].as_slice()).unwrap();
        let mut buf = Vec::new();
        m1.serialize(&mut serde_json::Serializer::new(&mut buf)).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&buf).unwrap();
        assert_eq!(v["text"], "b");
        assert_eq!(v["n"], 2);
    }

    #[test]
    fn roundtrip_json_protobuf() {
        let pool = compile_proto("echo.proto", PROTO).unwrap();
        let bytes = encode_request(&pool, "/echo.Echo/Say", r#"{"text":"hi","n":7}"#).unwrap();
        assert!(!bytes.is_empty());

        // Decode byte itu kembali via descriptor message input untuk verifikasi roundtrip.
        let req_desc = pool.get_message_by_name("echo.EchoRequest").unwrap();
        let back = DynamicMessage::decode(req_desc, bytes.as_slice()).unwrap();
        let mut buf = Vec::new();
        back.serialize(&mut serde_json::Serializer::new(&mut buf)).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&buf).unwrap();
        assert_eq!(v["text"], "hi");
        assert_eq!(v["n"], 7);
    }
}
