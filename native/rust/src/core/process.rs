// Native process management & execution safety bounds

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessMetrics {
    pub pid: u32,
    pub threads: usize,
    pub uptime_secs: u64,
}

impl ProcessMetrics {
    pub fn current() -> Self {
        Self {
            pid: std::process::id(),
            threads: 4, // Default thread pool size
            uptime_secs: 0,
        }
    }
}
