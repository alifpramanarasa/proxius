//! Hub kolaborasi realtime: satu "room" per workspace dengan channel broadcast
//! dan daftar presence (siapa online).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceUser {
    pub id: Uuid,
    pub name: String,
    pub email: String,
}

struct Conn {
    user_id: Uuid,
    name: String,
    email: String,
}

struct Room {
    tx: broadcast::Sender<String>,
    conns: HashMap<u64, Conn>,
}

#[derive(Clone)]
pub struct Hub {
    rooms: Arc<Mutex<HashMap<Uuid, Room>>>,
    next: Arc<AtomicU64>,
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}

impl Hub {
    pub fn new() -> Self {
        Self {
            rooms: Arc::new(Mutex::new(HashMap::new())),
            next: Arc::new(AtomicU64::new(1)),
        }
    }

    pub fn next_conn_id(&self) -> u64 {
        self.next.fetch_add(1, Ordering::Relaxed)
    }

    /// Gabung ke room; kembalikan receiver broadcast. Menyiarkan presence baru.
    pub fn join(
        &self,
        workspace: Uuid,
        conn_id: u64,
        user_id: Uuid,
        name: String,
        email: String,
    ) -> broadcast::Receiver<String> {
        let mut rooms = self.rooms.lock().unwrap();
        let room = rooms.entry(workspace).or_insert_with(|| Room {
            tx: broadcast::channel(256).0,
            conns: HashMap::new(),
        });
        let rx = room.tx.subscribe();
        room.conns.insert(
            conn_id,
            Conn {
                user_id,
                name,
                email,
            },
        );
        broadcast_presence(room);
        rx
    }

    /// Keluar dari room; menyiarkan presence terbaru.
    pub fn leave(&self, workspace: Uuid, conn_id: u64) {
        let mut rooms = self.rooms.lock().unwrap();
        if let Some(room) = rooms.get_mut(&workspace) {
            room.conns.remove(&conn_id);
            if room.conns.is_empty() {
                rooms.remove(&workspace);
            } else {
                broadcast_presence(room);
            }
        }
    }

    /// Kirim pesan mentah (JSON string) ke seluruh room.
    pub fn broadcast(&self, workspace: Uuid, msg: String) {
        let rooms = self.rooms.lock().unwrap();
        if let Some(room) = rooms.get(&workspace) {
            let _ = room.tx.send(msg);
        }
    }
}

/// Daftar user unik yang online (dedupe multi-koneksi), lalu broadcast.
fn broadcast_presence(room: &Room) {
    let mut seen = std::collections::HashSet::new();
    let mut users = Vec::new();
    for c in room.conns.values() {
        if seen.insert(c.user_id) {
            users.push(PresenceUser {
                id: c.user_id,
                name: c.name.clone(),
                email: c.email.clone(),
            });
        }
    }
    let payload = serde_json::json!({ "type": "presence", "users": users });
    let _ = room.tx.send(payload.to_string());
}
