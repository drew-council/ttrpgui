# ttrpgui

This project uses Nix and direnv for a reproducible development environment.

Configured languages: typescript.

Run `direnv allow` to activate the development shell and `nix fmt` to format the repository.

## Development

The Nix shell provides Bun, Biome, Node.js, and Electron.

```sh
nix develop
bun install
bun start
```

`index.ts` opens a blank window. `index.html` is the empty renderer page.
Electron runs with the Nix runtime. Its npm package provides the matching types and launcher.

```sh
bun run check
bun run build
nix fmt
nix flake check
```

## License

Licensed under either of Apache License, Version 2.0 or MIT license at your option.

