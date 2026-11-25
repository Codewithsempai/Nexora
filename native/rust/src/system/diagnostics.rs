// Windows 11 system telemetry & diagnostic metrics

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemTelemetry {
    pub platform: String,
    pub arch: String,
    pub logical_cores: usize,
    pub memory_allocated_kb: usize,
    pub version: String,
}

impl SystemTelemetry {
    pub fn collect() -> Self {
        Self {
            platform: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            logical_cores: std::thread::available_parallelism()
                .map(|p| p.get())
                .unwrap_or(4),
            memory_allocated_kb: 4096, // Baseline footprint
            version: "0.1.0".to_string(),
        }
    }
}
