// High-performance 3D Vector Math & Golden Spiral Projection

use serde::{Deserialize, Serialize};

pub const GOLDEN_SPIRAL_RATIO: f32 = 2.3999632;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Vector3D {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vector3D {
    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    pub fn magnitude(&self) -> f32 {
        (self.x * self.x + self.y * self.y + self.z * self.z).sqrt()
    }

    pub fn normalize(&self) -> Self {
        let mag = self.magnitude();
        if mag > 0.0001 {
            Self {
                x: self.x / mag,
                y: self.y / mag,
                z: self.z / mag,
            }
        } else {
            Self::new(0.0, 0.0, 0.0)
        }
    }
}

/// Generates points evenly distributed over a sphere using the golden spiral method
pub fn generate_golden_sphere(n: usize) -> Vec<Vector3D> {
    let mut points = Vec::with_capacity(n);
    let n_f = n as f32;

    for i in 0..n {
        let i_f = i as f32;
        let y = 1.0 - (2.0 * (i_f + 0.5)) / n_f;
        let r = (1.0 - y * y).max(0.0).sqrt();
        let a = i_f * GOLDEN_SPIRAL_RATIO;

        points.push(Vector3D {
            x: a.cos() * r,
            y,
            z: a.sin() * r,
        });
    }
    points
}

/// Smoothstep Hermite interpolation
pub fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Dynamic voice harmonic smoothing
pub fn calculate_voice_harmonics(time: f32, mode: &str, raw_level: Option<f32>) -> f32 {
    match mode {
        "speaking" => {
            if let Some(level) = raw_level {
                (0.35 + level * 0.85).clamp(0.0, 1.0)
            } else {
                let wave1 = (time * 11.2).sin().abs() * (time * 3.1 + 0.8).sin().abs();
                let wave2 = 0.25 * (time * 22.0).sin();
                (0.42 + 0.38 * wave1 + wave2).clamp(0.0, 1.0)
            }
        }
        "listening" => {
            (0.32 + 0.35 * (time * 4.4).sin().abs()).clamp(0.0, 1.0)
        }
        "thinking" => 0.28,
        "offline" => 0.02,
        _ => 0.12 + 0.06 * (time * 1.5).sin(),
    }
}
