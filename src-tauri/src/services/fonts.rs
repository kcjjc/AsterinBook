use crate::contracts::{AppError, Result};
use std::collections::BTreeSet;
use windows_sys::Win32::Graphics::Gdi::*;
// GDI invokes this callback synchronously while the caller's set remains alive.
unsafe extern "system" fn collect(
    font: *const LOGFONTW,
    _: *const TEXTMETRICW,
    _: u32,
    data: isize,
) -> i32 {
    let names = unsafe { &mut *(data as *mut BTreeSet<String>) };
    let face = unsafe { &(*font).lfFaceName };
    let n = face.iter().position(|&u| u == 0).unwrap_or(face.len());
    let name = String::from_utf16_lossy(&face[..n]);
    if !name.starts_with('@') && !name.is_empty() {
        names.insert(name);
    }
    1
}
pub fn list_fonts() -> Result<Vec<String>> {
    let mut names = BTreeSet::new();
    unsafe {
        let dc = GetDC(std::ptr::null_mut());
        if dc.is_null() {
            return Err(AppError::new("IO_ERROR", "无法读取系统字体"));
        }
        let mut font: LOGFONTW = std::mem::zeroed();
        font.lfCharSet = DEFAULT_CHARSET;
        EnumFontFamiliesExW(
            dc,
            &font,
            Some(collect),
            &mut names as *mut BTreeSet<String> as isize,
            0,
        );
        ReleaseDC(std::ptr::null_mut(), dc);
    }
    Ok(names.into_iter().collect())
}
