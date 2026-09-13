mod desktop;

fn main() -> anyhow::Result<()> {
    // Zed runs the current executable as a shell-environment helper. Handle it
    // before initializing GPUI, opening files, or acquiring the instance lock.
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    match args.as_slice() {
        [] => desktop::run(false),
        [arg] if arg == "--smoke-test" => desktop::run(true),
        [arg] if arg == "--printenv" => {
            util::shell_env::print_env();
            Ok(())
        }
        [arg] if arg == "--help" || arg == "-h" => {
            println!(
                "ttrpgui\n\nUsage: ttrpgui [--help | --printenv | --smoke-test]\n\nLaunches the native editor proof with no arguments.\n--smoke-test uses GPUI's headless platform and exits after verification."
            );
            Ok(())
        }
        _ => anyhow::bail!("unsupported arguments; use --help"),
    }
}
