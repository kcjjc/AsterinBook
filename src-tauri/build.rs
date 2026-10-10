fn main() {
    #[cfg(feature = "desktop")]
    {
        tauri_build::build();
        // The standalone native verification example needs the same v6 controls
        // activation as the resource manifest Tauri embeds in the shipping binary.
        println!("cargo:rustc-link-arg-examples=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-examples=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
}
