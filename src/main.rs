mod desktop;

fn main() -> anyhow::Result<()> {
    // Zed runs the current executable as a shell-environment helper. Handle it
    // before initializing GPUI, opening files, or acquiring the instance lock.
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    match args.as_slice() {
        [] => desktop::run(false, None, None, false),
        [arg] if arg == "--smoke-test" => desktop::run(true, None, None, false),
        [arg] if arg == "--campaign-smoke-test" => {
            desktop::run(true, Some(Default::default()), None, false)
        }
        [arg] if arg == "--performance-smoke-test" => {
            desktop::run(true, Some(Default::default()), None, true)
        }
        [arg, path] if arg == "--campaign" => desktop::run(false, Some(path.into()), None, false),
        [arg, phase]
            if arg == "--session-smoke-test" && (phase == "prepare" || phase == "restore") =>
        {
            desktop::run(
                true,
                Some(Default::default()),
                Some(phase == "restore"),
                false,
            )
        }
        [arg] if arg == "--printenv" => {
            util::shell_env::print_env();
            Ok(())
        }
        [arg] if arg == "--help" || arg == "-h" => {
            println!(
                "ttrpgui\n\nUsage: ttrpgui [--campaign DIRECTORY | --help | --printenv | --smoke-test | --campaign-smoke-test]\n\nLaunches the native campaign workspace. --campaign opens or creates a portable campaign.\nSmoke tests use GPUI's headless platform and exit after verification."
            );
            Ok(())
        }
        _ => anyhow::bail!("unsupported arguments; use --help"),
    }
}
