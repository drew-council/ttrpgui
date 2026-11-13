{
  pkgs,
  ...
}:
{
  projectRootFile = "flake.nix";
  programs = {
    nixfmt = {
      enable = true;
    };
    jsonfmt = {
      enable = true;
      excludes = [ "tsconfig.json" ];
    };
    shellcheck = {
      enable = true;
    };
    yamlfmt = {
      enable = true;
    };
    toml-sort = {
      enable = true;
    };
    dos2unix = {
      enable = true;
    };
    keep-sorted = {
      enable = true;
    };
    topiary-nushell = {
      enable = true;
    };
  };

  settings = {
    # Game data, including deliberately invalid files.
    excludes = [ "fixtures/**" ];
    # Biome reads the repo's biome.json, as `bun run check` does; the treefmt-nix module would pass its own config.
    formatter.biome = {
      command = pkgs.lib.getExe pkgs.biome;
      options = [
        "check"
        "--write"
        "--no-errors-on-unmatched"
      ];
      includes = [
        "*.ts"
        "*.tsx"
        "*.js"
        "*.cjs"
        "*.mjs"
        "*.json"
        "*.css"
      ];
    };
  };
}
