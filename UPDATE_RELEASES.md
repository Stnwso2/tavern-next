# Tavern Next updates

Tavern Next checks the configured GitHub Releases feed when it starts. When a newer signed version is available, it offers to download and install it inside the app. On Windows, the installer closes the app during replacement and the app then relaunches.

The updater is configured for `Stnwso2/tavern-next`. The repository must remain public so installed copies can download `latest.json` and signed NSIS updates without a GitHub login. The application source code is public as well. GitHub Actions builds and publishes a release whenever a `v*` version tag is pushed.

## One-time transition

Version 0.1.1 does not contain the updater. Install version 0.1.2 once with its setup executable. Updates published after that can be installed from inside the app.

## Signing key

The public key is embedded in `src-tauri/tauri.conf.json`. The matching private signing key is stored locally at `work/updater-signing/tavern-next.key`; it is excluded from Git. Keep it private and make a secure backup. Losing it means existing installations will not accept future releases. Before the GitHub workflow can publish, add the private key as the repository Actions secret `TAURI_SIGNING_PRIVATE_KEY`. The optional password secret is left unset for this generated key.

## Publish a later version

1. Increase the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Commit the changes and push a tag matching the version, such as `v0.1.3`.
3. GitHub Actions builds the Windows NSIS update bundle, signs it, creates the release, and uploads `latest.json`.
