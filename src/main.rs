// Nexora Core Backend in Rust - Powers high-performance math, DSP, native desktop window, and desktop app launcher.
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::process::Command;

pub const GOLDEN_SPIRAL_RATIO: f32 = 2.39996;
pub const MATRIX_COLS: usize = 72;
pub const MATRIX_ROWS: usize = 60;
pub const CELL_SIZE: usize = 8;
pub const WIN_WIDTH: usize = MATRIX_COLS * CELL_SIZE;  // 576
pub const WIN_HEIGHT: usize = MATRIX_ROWS * CELL_SIZE; // 480

pub const PALETTE: [u32; 6] = [
    0x080a0e, // 0: Void dark base background
    0x78350f, // 1: Deep amber bronze shadow
    0xb45309, // 2: Rich golden amber
    0xf59e0b, // 3: Primary solar amber
    0xfbbf24, // 4: Radiant warm gold
    0xfffbeb, // 5: Luminous core warm white
];

/// 3D Point on the Golden Spiral Sphere
#[derive(Debug, PartialEq, Clone)]
pub struct SpherePoint {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

/// Generates points evenly distributed over a sphere using the golden spiral method.
pub fn generate_golden_sphere(n: usize) -> Vec<SpherePoint> {
    let mut points = Vec::with_capacity(n);
    let n_f = n as f32;

    for i in 0..n {
        let i_f = i as f32;
        let y = 1.0 - (2.0 * (i_f + 0.5)) / n_f;
        let r = (1.0 - y * y).max(0.0).sqrt();
        let a = i_f * GOLDEN_SPIRAL_RATIO;

        points.push(SpherePoint {
            x: a.cos() * r,
            y,
            z: a.sin() * r,
        });
    }
    points
}

/// Clamps value between min and max
pub fn clamp(v: f32, min: f32, max: f32) -> f32 {
    if v < min { min } else if v > max { max } else { v }
}

/// Cubic smoothstep function
pub fn smooth(x: f32) -> f32 {
    if x <= 0.0 { 0.0 } else if x >= 1.0 { 1.0 } else { x * x * (3.0 - 2.0 * x) }
}

/// Voice Level smoothing calculator matching Nexora spec
pub fn calculate_voice_level(mode: &str, voice: Option<f32>, t: f32) -> f32 {
    match mode {
        "talk" => {
            if let Some(v) = voice {
                clamp(0.3 + v * 0.9, 0.0, 1.0)
            } else {
                let wave1 = (t * 11.3).sin().abs() * (t * 2.9 + 1.0).sin().abs();
                let wave2 = 0.2 * (t * 23.0).sin();
                clamp(0.45 + 0.35 * wave1 + wave2, 0.0, 1.0)
            }
        }
        "listen" => {
            clamp(0.35 + 0.3 * (t * 4.1).sin().abs(), 0.0, 1.0)
        }
        "think" => 0.25,
        _ => 0.14 + 0.06 * (t * 1.5).sin(),
    }
}

/// Cell buffer for LED matrix rendering (exact parity with JS DitherMatrix)
pub struct MatrixGrid {
    pub cells: [u8; MATRIX_COLS * MATRIX_ROWS],
}

impl MatrixGrid {
    pub fn new() -> Self {
        Self {
            cells: [0; MATRIX_COLS * MATRIX_ROWS],
        }
    }

    pub fn clear(&mut self) {
        self.cells.fill(0);
    }

    pub fn put(&mut self, x: f32, y: f32, level: u8) {
        let ix = x.floor() as isize;
        let iy = y.floor() as isize;
        if ix < 0 || ix >= MATRIX_COLS as isize || iy < 0 || iy >= MATRIX_ROWS as isize {
            return;
        }
        let idx = (iy as usize) * MATRIX_COLS + (ix as usize);
        if level > self.cells[idx] {
            self.cells[idx] = level.min(5);
        }
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" {
    fn MessageBeep(uType: u32) -> i32;
}

/// Native Win32 / Cross-Platform Desktop Window for Nexora (minifb)
/// Renders the EXACT 72x60 chunky LED matrix blocks, glowing heart, overhead reticle & spark
pub fn run_native_desktop() {
    let mut buffer: Vec<u32> = vec![0; WIN_WIDTH * WIN_HEIGHT];
    let mut window = match minifb::Window::new(
        "Nexora - Holographic Desktop AI",
        WIN_WIDTH,
        WIN_HEIGHT,
        minifb::WindowOptions {
            resize: false,
            topmost: true,
            ..minifb::WindowOptions::default()
        },
    ) {
        Ok(win) => win,
        Err(err) => {
            eprintln!("Unable to create native desktop window: {}", err);
            return;
        }
    };

    window.set_target_fps(60);
    let sphere = generate_golden_sphere(520);
    let mut grid = MatrixGrid::new();
    let mut t = 0.0f32;

    println!("✨ NEXORA Holographic Desktop Orb Active (Press Escape to exit)");

    while window.is_open() && !window.is_key_down(minifb::Key::Escape) {
        t += 0.016;
        grid.clear();

        let cx = (MATRIX_COLS / 2) as f32;
        let cy = (MATRIX_ROWS / 2) as f32;
        let rad = 14.0f32;

        let (mx_px, my_px) = window.get_mouse_pos(minifb::MouseMode::Clamp).unwrap_or((WIN_WIDTH as f32 / 2.0, WIN_HEIGHT as f32 / 2.0));
        let mouse_cell_x = mx_px / CELL_SIZE as f32;
        let mouse_cell_y = my_px / CELL_SIZE as f32;

        let look_x = clamp((mouse_cell_x - cx) / (rad * 1.5), -1.0, 1.0);
        let look_y = clamp((mouse_cell_y - cy) / (rad * 1.5), -1.0, 1.0);

        let v = calculate_voice_level("idle", None, t);

        // Click audio trigger
        if window.get_mouse_down(minifb::MouseButton::Left) {
            #[cfg(target_os = "windows")]
            unsafe { MessageBeep(0); }
        }

        // Spin & 3D rotation angles
        let yaw = t * 0.32 + look_x * 0.45;
        let pitch = -0.32 + look_y * 0.30;
        let cyw = yaw.cos();
        let syw = yaw.sin();
        let cp = pitch.cos();
        let sp = pitch.sin();

        // 1. Render 3D Golden Spiral Wave Sphere with Smooth Depth
        for p in &sphere {
            let harmonic1 = (p.y * 6.8 - t * 1.2).sin() * 0.5;
            let harmonic2 = (p.z.atan2(p.x) * 4.0 + t * 0.96).sin() * 0.5;
            let r = rad * (1.0 + 0.10 * (harmonic1 + harmonic2) + v * 0.08);

            let x = p.x * cyw + p.z * syw;
            let mut z = -p.x * syw + p.z * cyw;
            let y = p.y * cp - z * sp;
            z = p.y * sp + z * cp;

            let depth = (z + 1.0) * 0.5;
            if depth < 0.18 {
                continue;
            }

            let px = cx + x * r;
            let py = cy + y * r;

            let light = (-x * 0.35 - y * 0.45 + z * 0.82).clamp(0.0, 1.0);
            let lv = (1.5 + light * 2.8 + depth * 1.2).clamp(1.0, 5.0);
            let level = lv.round() as u8;
            grid.put(px, py, level);
        }

        // 2. Dimensional Luminous Core: Radiant Golden-Orange Center
        let hr = 3;
        let hx = (cx + look_x * rad * 0.22).round() as isize;
        let hy = (cy + look_y * rad * 0.18).round() as isize;
        for dy in -hr - 1..=hr + 1 {
            for dx in -hr - 1..=hr + 1 {
                let d = (dx as f32 / (hr as f32 + 0.5)).hypot(dy as f32 / (hr as f32 + 0.5));
                if d <= 1.35 {
                    let level = if d < 0.5 { 5 } else if d < 0.95 { 4 } else { 3 };
                    grid.put((hx + dx) as f32, (hy + dy) as f32, level);
                }
            }
        }

        // 3. Floating Amber Particle Embers
        for i in 0..28 {
            let speed = 0.6 + ((i % 5) as f32) * 0.3;
            let seed = (i as f32) * 1.618;
            let age = (t * speed + seed) % 3.0;
            let progress = age / 3.0;
            let sway = (t * 2.0 + seed * 3.0).sin() * (1.2 + progress * 2.0);
            let rx = (((i * 17) % 20) as f32 - 10.0) * 0.12;
            let ex = cx + rx * rad * 1.4 + sway;
            let ey = cy - rad * 0.2 - progress * (rad * 1.6) - ((i % 10) as f32) * 0.15 * rad;
            let b = if progress < 0.25 {
                3
            } else if progress < 0.7 {
                4
            } else {
                2
            };
            grid.put(ex, ey, b);
        }

        // 4. Transfer Grid to Framebuffer as Smooth Circular Particles with Soft Bloom
        buffer.fill(PALETTE[0]);

        for cy_i in 0..MATRIX_ROWS {
            for cx_i in 0..MATRIX_COLS {
                let lvl = grid.cells[cy_i * MATRIX_COLS + cx_i] as usize;
                if lvl > 0 {
                    let color = PALETTE[lvl];
                    let center_x = cx_i * CELL_SIZE + CELL_SIZE / 2;
                    let center_y = cy_i * CELL_SIZE + CELL_SIZE / 2;

                    // Draw smooth circular particles
                    let r_sq = if lvl >= 4 { 3.2 * 3.2 } else { 2.4 * 2.4 };
                    for dy in -3..=3 {
                        for dx in -3..=3 {
                            if (dx * dx + dy * dy) as f32 <= r_sq {
                                let px = (center_x as isize + dx) as usize;
                                let py = (center_y as isize + dy) as usize;
                                if px < WIN_WIDTH && py < WIN_HEIGHT {
                                    buffer[py * WIN_WIDTH + px] = color;
                                }
                            }
                        }
                    }

                    // Soft ambient golden halo for high intensity particles
                    if lvl >= 4 {
                        let glow_color = if lvl == 5 { 0xf59e0b } else { 0xb45309 };
                        for (gx, gy) in [
                            (center_x.saturating_sub(4), center_y),
                            (center_x + 4, center_y),
                            (center_x, center_y.saturating_sub(4)),
                            (center_x, center_y + 4),
                        ] {
                            if gx < WIN_WIDTH && gy < WIN_HEIGHT && buffer[gy * WIN_WIDTH + gx] == PALETTE[0] {
                                buffer[gy * WIN_WIDTH + gx] = glow_color;
                            }
                        }
                    }
                }
            }
        }

        window.update_with_buffer(&buffer, WIN_WIDTH, WIN_HEIGHT).unwrap();
    }
}

/// Serves static files and routes for the Nexora web/desktop companion client
fn handle_connection(mut stream: std::net::TcpStream) {
    let mut buffer = [0; 2048];
    let bytes_read = stream.read(&mut buffer).unwrap_or(0);
    if bytes_read == 0 {
        return;
    }

    let request = String::from_utf8_lossy(&buffer[..bytes_read]);
    let first_line = request.lines().next().unwrap_or("");
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let raw_path = parts.next().unwrap_or("/");

    if method != "GET" {
        return;
    }

    let path = if raw_path == "/" {
        "index.html"
    } else {
        raw_path.trim_start_matches('/')
    };

    let (content_type, file_path) = if path.ends_with(".html") {
        ("text/html; charset=utf-8", path.to_string())
    } else if path.ends_with(".js") {
        ("application/javascript; charset=utf-8", path.to_string())
    } else if path.ends_with(".css") {
        ("text/css; charset=utf-8", path.to_string())
    } else if path.ends_with(".json") {
        ("application/json", path.to_string())
    } else {
        ("text/plain", path.to_string())
    };

    let (status_line, body) = if Path::new(&file_path).exists() {
        match fs::read(&file_path) {
            Ok(bytes) => ("HTTP/1.1 200 OK", bytes),
            Err(_) => ("HTTP/1.1 500 INTERNAL SERVER ERROR", b"500 Internal Error".to_vec()),
        }
    } else {
        ("HTTP/1.1 404 NOT FOUND", b"404 Not Found".to_vec())
    };

    let response_headers = format!(
        "{}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n",
        status_line,
        content_type,
        body.len()
    );

    let _ = stream.write_all(response_headers.as_bytes());
    let _ = stream.write_all(&body);
    let _ = stream.flush();
}

/// Launches the desktop app in dedicated standalone window mode
fn launch_desktop_window(url: &str) {
    #[cfg(target_os = "windows")]
    {
        // 1. Try launching native Electron desktop window first
        let electron_path = Path::new(r"node_modules\electron\dist\electron.exe");
        if electron_path.exists() {
            println!("🚀 Launching native Electron desktop assistant window...");
            if let Ok(_) = Command::new(electron_path).arg(".").spawn() {
                return;
            }
        }

        // Try npx electron fallback
        if let Ok(_) = Command::new("cmd").args(["/C", "npx", "electron", "."]).spawn() {
            return;
        }

        // 2. Standalone App Window without browser chrome (no tabs, no address bar)
        let app_arg = format!("--app={}", url);
        let size_arg = "--window-size=680,840";

        let candidate_browsers = [
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
        ];

        for &browser in &candidate_browsers {
            if Path::new(browser).exists() {
                println!("🚀 Launching standalone desktop window via {}...", browser);
                let _ = Command::new(browser)
                    .args([&app_arg, size_arg])
                    .spawn();
                return;
            }
        }

        // 3. Fallback
        let _ = Command::new("cmd")
            .args(["/C", "start", url])
            .spawn();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("open").arg(url).spawn();
    }
}

/// Path of the Electron binary installed by `npm install` (platform specific).
fn electron_binary(root: &Path) -> std::path::PathBuf {
    let dist = root.join("node_modules").join("electron").join("dist");
    if cfg!(target_os = "windows") {
        dist.join("electron.exe")
    } else if cfg!(target_os = "macos") {
        dist.join("Electron.app").join("Contents").join("MacOS").join("Electron")
    } else {
        dist.join("electron")
    }
}

/// Runs an npm command through the platform shell (npm is `npm.cmd` on Windows).
fn run_npm(root: &Path, args: &[&str]) -> bool {
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.args(["/C", "npm"]);
        c
    } else {
        Command::new("npm")
    };
    cmd.args(args).current_dir(root).status().map(|s| s.success()).unwrap_or(false)
}

/// `cargo run -- --desktop`: starts the real NEXORA desktop application (Electron shell)
/// straight from Cargo, so there is no need to type `npm start`.
/// - Works from any directory (uses the project root that holds this Cargo.toml).
/// - First run: installs the Electron dependency automatically if it is missing.
/// - Extra flags such as `--dev` are forwarded to the app.
/// Returns the process exit code.
fn run_desktop_app(extra: &[String]) -> i32 {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut electron = electron_binary(root);

    if !electron.exists() {
        println!("📦 Electron is not installed yet - running `npm install` once (needs Node.js)...");
        if !run_npm(root, &["install"]) || !electron.exists() {
            eprintln!("❌ Could not set up Electron automatically. Install Node.js (https://nodejs.org) and run `npm install` in {}", root.display());
            return 1;
        }
        electron = electron_binary(root);
    }

    println!("🚀 Launching NEXORA desktop application...");
    match Command::new(&electron).arg(".").args(extra).current_dir(root).status() {
        Ok(status) => status.code().unwrap_or(0),
        Err(err) => {
            eprintln!("❌ Failed to start Electron ({}): {}", electron.display(), err);
            1
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    // `--minifb` keeps the small native LED-matrix orb window.
    if args.iter().any(|a| a == "--minifb") {
        run_native_desktop();
        return;
    }
    // `--desktop` launches the full NEXORA desktop application (no npm command needed).
    if args.iter().any(|a| a == "--desktop") {
        let extra: Vec<String> = args.iter().skip(1).filter(|a| a.as_str() != "--desktop").cloned().collect();
        std::process::exit(run_desktop_app(&extra));
    }

    let host = "127.0.0.1:8080";
    let listener = TcpListener::bind(host).expect("Failed to bind to 127.0.0.1:8080");

    let url = format!("http://{}", host);
    println!("🟣 Nexora Desktop AI running at {}", url);
    println!("Launching standalone desktop application window...");

    launch_desktop_window(&url);

    for stream in listener.incoming() {
        if let Ok(stream) = stream {
            handle_connection(stream);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_golden_sphere_generation() {
        let sphere = generate_golden_sphere(520);
        assert_eq!(sphere.len(), 520);

        for p in &sphere {
            let r = (p.x * p.x + p.y * p.y + p.z * p.z).sqrt();
            assert!((r - 1.0).abs() < 0.05, "Point radius should be ~1.0, got {}", r);
        }
    }

    #[test]
    fn test_voice_level_bounds() {
        for t_step in 0..100 {
            let t = t_step as f32 * 0.1;
            let talk_level = calculate_voice_level("talk", None, t);
            let listen_level = calculate_voice_level("listen", None, t);
            let rest_level = calculate_voice_level("rest", None, t);

            assert!(talk_level >= 0.0 && talk_level <= 1.0);
            assert!(listen_level >= 0.0 && listen_level <= 1.0);
            assert!(rest_level >= 0.0 && rest_level <= 1.0);
        }
    }

    #[test]
    fn test_smooth_function() {
        assert_eq!(smooth(-0.5), 0.0);
        assert_eq!(smooth(1.5), 1.0);
        assert!((smooth(0.5) - 0.5).abs() < 0.001);
    }
}
