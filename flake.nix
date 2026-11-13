{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    topiary-nushell = {
      url = "github:drew-council/topiary-nushell-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    treefmt-nix.url = "github:numtide/treefmt-nix";
  };
  outputs =
    inputs@{
      self,
      nixpkgs,
      flake-utils,
      topiary-nushell,
      treefmt-nix,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };
        treefmtEval = treefmt-nix.lib.evalModule pkgs {
          imports = [
            topiary-nushell.treefmtModules.default
            ./treefmt.nix
          ];
        };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            (aspellWithDicts (ps: with ps; [ en ]))
            nushell
            bun
            biome
            nodejs
            electron
            xvfb-run
            # Atmosphere sync downloads with these at runtime.
            yt-dlp
            ffmpeg
          ];
          ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
          ELECTRON_OVERRIDE_DIST_PATH = pkgs.electron.dist;
          # The npm `playwright` version MUST match nixpkgs' playwright-driver.
          PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
          PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "1";
        };

        formatter = treefmtEval.config.build.wrapper;
        checks.formatting = treefmtEval.config.build.check self;
      }
    );
}
