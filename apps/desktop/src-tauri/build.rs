use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("manifest directory must be set"));
    let icons_dir = manifest_dir.join("icons");
    fs::create_dir_all(&icons_dir).expect("Stone icon directory must be created");
    write_if_changed(&icons_dir.join("icon.ico"), &stone_icon());
    write_if_changed(&icons_dir.join("icon.png"), FALLBACK_PNG);

    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR must be set"));
    let icon_path = out_dir.join("stone.ico");
    fs::write(&icon_path, stone_icon()).expect("Stone icon must be generated");
    let windows = tauri_build::WindowsAttributes::new().window_icon_path(icon_path);
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri build");
}

const FALLBACK_PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
    0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

fn write_if_changed(path: &PathBuf, contents: &[u8]) {
    let unchanged = fs::read(path)
        .map(|current| current == contents)
        .unwrap_or(false);
    if !unchanged {
        fs::write(path, contents).expect("Stone generated asset must be written");
    }
}

fn stone_icon() -> Vec<u8> {
    const SIZE: usize = 32;
    const PIXEL_BYTES: usize = SIZE * SIZE * 4;
    const MASK_BYTES: usize = SIZE * 4;
    let image_bytes = 40 + PIXEL_BYTES + MASK_BYTES;
    let mut bytes = Vec::with_capacity(22 + image_bytes);

    bytes.extend_from_slice(&[0, 0, 1, 0, 1, 0]);
    bytes.extend_from_slice(&[32, 32, 0, 0, 1, 0, 32, 0]);
    bytes.extend_from_slice(&(image_bytes as u32).to_le_bytes());
    bytes.extend_from_slice(&22u32.to_le_bytes());

    bytes.extend_from_slice(&40u32.to_le_bytes());
    bytes.extend_from_slice(&(SIZE as i32).to_le_bytes());
    bytes.extend_from_slice(&((SIZE * 2) as i32).to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&32u16.to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.extend_from_slice(&(PIXEL_BYTES as u32).to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());

    for y in (0..SIZE).rev() {
        for x in 0..SIZE {
            let mark = (5..9).contains(&y) && (7..25).contains(&x)
                || (5..17).contains(&y) && (7..11).contains(&x)
                || (12..20).contains(&y) && (7..25).contains(&x)
                || (16..28).contains(&y) && (21..25).contains(&x)
                || (24..28).contains(&y) && (7..25).contains(&x);
            let (blue, green, red) = if mark { (226, 232, 240) } else { (57, 70, 104) };
            bytes.extend_from_slice(&[blue, green, red, 255]);
        }
    }
    bytes.extend(std::iter::repeat_n(0, MASK_BYTES));
    bytes
}
