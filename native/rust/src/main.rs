// NEXORA — Native Performance Core & System Bridge
// Phase 1 Foundation

pub mod core;
pub mod services;
pub mod system;

use std::env;
use std::io::{self, BufRead, Write};
use core::math::{calculate_voice_harmonics, generate_golden_sphere};
use services::bridge::{JsonRpcRequest, JsonRpcResponse};
use system::diagnostics::SystemTelemetry;

fn handle_json_rpc(req: JsonRpcRequest) -> JsonRpcResponse {
    match req.method.as_str() {
        "ping" => {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            JsonRpcResponse::success(req.id, serde_json::json!({
                "pong": true,
                "timestamp": now,
                "status": "online"
            }))
        }
        "diagnostics" => {
            let diag = SystemTelemetry::collect();
            JsonRpcResponse::success(req.id, serde_json::to_value(diag).unwrap_or_default())
        }
        "generate_sphere" => {
            let n = req.params
                .as_ref()
                .and_then(|p| p.get("count"))
                .and_then(|c| c.as_u64())
                .unwrap_or(520) as usize;
            let sphere = generate_golden_sphere(n);
            JsonRpcResponse::success(req.id, serde_json::to_value(sphere).unwrap_or_default())
        }
        "audio_smooth" => {
            let time = req.params
                .as_ref()
                .and_then(|p| p.get("time"))
                .and_then(|t| t.as_f64())
                .unwrap_or(0.0) as f32;
            let mode = req.params
                .as_ref()
                .and_then(|p| p.get("mode"))
                .and_then(|m| m.as_str())
                .unwrap_or("idle");
            let smoothed = calculate_voice_harmonics(time, mode, None);
            JsonRpcResponse::success(req.id, serde_json::json!({ "level": smoothed }))
        }
        _ => JsonRpcResponse::error(req.id, -32601, "Method not found"),
    }
}

fn run_sidecar_loop() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        if let Ok(line_str) = line {
            let trimmed = line_str.trim();
            if trimmed.is_empty() {
                continue;
            }

            if let Ok(req) = serde_json::from_str::<JsonRpcRequest>(trimmed) {
                let resp = handle_json_rpc(req);
                if let Ok(resp_str) = serde_json::to_string(&resp) {
                    let _ = writeln!(stdout, "{}", resp_str);
                    let _ = stdout.flush();
                }
            } else {
                let err_resp = JsonRpcResponse::error(None, -32700, "Parse error");
                if let Ok(resp_str) = serde_json::to_string(&err_resp) {
                    let _ = writeln!(stdout, "{}", resp_str);
                    let _ = stdout.flush();
                }
            }
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.iter().any(|a| a == "--sidecar") {
        run_sidecar_loop();
        return;
    }

    println!("=======================================================");
    println!("  NEXORA Native Performance Core — Phase 1 Foundation");
    println!("=======================================================");
    let telemetry = SystemTelemetry::collect();
    println!("  Platform: {} ({})", telemetry.platform, telemetry.arch);
    println!("  Logical CPU Cores: {}", telemetry.logical_cores);
    println!("  Core Version: {}", telemetry.version);
    println!("  Status: Operational");
    println!("-------------------------------------------------------");
    println!("Run with `--sidecar` to launch stdio JSON-RPC bridge for Electron.");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::math::smoothstep;

    #[test]
    fn test_golden_spiral_math() {
        let sphere = generate_golden_sphere(520);
        assert_eq!(sphere.len(), 520);

        for pt in &sphere {
            let mag = pt.magnitude();
            assert!((mag - 1.0).abs() < 0.05, "Spherical radius must be ~1.0, got: {}", mag);
        }
    }

    #[test]
    fn test_smoothstep() {
        assert_eq!(smoothstep(0.0, 1.0, -0.5), 0.0);
        assert_eq!(smoothstep(0.0, 1.0, 1.5), 1.0);
        assert!((smoothstep(0.0, 1.0, 0.5) - 0.5).abs() < 0.001);
    }

    #[test]
    fn test_voice_harmonics_bounds() {
        for t in 0..50 {
            let time = t as f32 * 0.1;
            let speaking = calculate_voice_harmonics(time, "speaking", None);
            let listening = calculate_voice_harmonics(time, "listening", None);
            let idle = calculate_voice_harmonics(time, "idle", None);

            assert!(speaking >= 0.0 && speaking <= 1.0);
            assert!(listening >= 0.0 && listening <= 1.0);
            assert!(idle >= 0.0 && idle <= 1.0);
        }
    }

    #[test]
    fn test_json_rpc_ping() {
        let req = JsonRpcRequest {
            jsonrpc: Some("2.0".to_string()),
            id: Some(42),
            method: "ping".to_string(),
            params: None,
        };

        let resp = handle_json_rpc(req);
        assert_eq!(resp.id, Some(42));
        assert!(resp.result.is_some());
        assert_eq!(resp.result.unwrap()["pong"], true);
    }

    #[test]
    fn test_json_rpc_diagnostics() {
        let req = JsonRpcRequest {
            jsonrpc: Some("2.0".to_string()),
            id: Some(99),
            method: "diagnostics".to_string(),
            params: None,
        };

        let resp = handle_json_rpc(req);
        assert_eq!(resp.id, Some(99));
        assert!(resp.result.is_some());
        assert_eq!(resp.result.unwrap()["version"], "0.1.0");
    }
}
