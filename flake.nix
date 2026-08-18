{
  description = "DSH Apple Container manager";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { nixpkgs, ... }:
    let
      system = "aarch64-darwin";
      pkgs = import nixpkgs { inherit system; };
      landlockKernel = pkgs.fetchurl {
        url = "https://github.com/pietgk/dsh-container/releases/download/kernel-6.18.5-landlock.1/vmlinux-arm64";
        hash = "sha256-WsErKOwB9e2J9KY5eimkIrPmFfKzgtjsMomRsaOVPRs=";
      };
      source = pkgs.lib.fileset.toSource {
        root = ./.;
        fileset = pkgs.lib.fileset.unions [
          ./src
          ./package.json
          ./pnpm-lock.yaml
          ./pnpm-workspace.yaml
          ./tsconfig.json
          ./tsconfig.build.json
        ];
      };
      dsh-container = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
        pname = "dsh-container";
        version = "0.1.0";
        src = source;

        pnpmDeps = pkgs.fetchPnpmDeps {
          inherit (finalAttrs) pname version src;
          fetcherVersion = 4;
          hash = "sha256-g+gU9VqRJzirdj6XBlmWj6si9zrcexdxfPt4OIv//vw=";
        };

        nativeBuildInputs = [
          pkgs.nodejs_24
          pkgs.pnpm
          pkgs.pnpmConfigHook
          pkgs.makeWrapper
        ];

        buildPhase = ''
          runHook preBuild
          pnpm build
          runHook postBuild
        '';

        installPhase = ''
          runHook preInstall
          pnpm prune --prod
          mkdir -p "$out/lib/dsh-container/spikes/phase-0/apple-kernel" "$out/bin"
          cp -R dist node_modules package.json "$out/lib/dsh-container/"
          cp ${landlockKernel} \
            "$out/lib/dsh-container/spikes/phase-0/apple-kernel/vmlinux-arm64"
          makeWrapper ${pkgs.nodejs_24}/bin/node "$out/bin/dsh-container" \
            --add-flags "$out/lib/dsh-container/dist/cli.js"
          runHook postInstall
        '';

        meta = {
          description = "Manage isolated DSH evaluation instances on Apple Container";
          mainProgram = "dsh-container";
          platforms = [ "aarch64-darwin" ];
        };
      });
    in
    {
      packages.${system} = {
        default = dsh-container;
        inherit dsh-container;
      };

      apps.${system}.default = {
        type = "app";
        program = "${dsh-container}/bin/dsh-container";
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs_24
          pnpm
        ];

        shellHook = ''
          echo "DSH manager shell: Node $(node --version), pnpm $(pnpm --version)"
          echo "Apple Container remains managed by nix-darwin/Homebrew on the host."
        '';
      };
    };
}
