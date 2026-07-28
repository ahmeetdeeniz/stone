# Public preview release checklist

## Source release

- [x] Root MIT License and package identifiers are present and verified.
- [x] Unlicensed brand font and raw supplied icon files are absent from the public tree and rewritten
      public history.
- [ ] Private GitHub vulnerability reporting is enabled and tested.
- [ ] Current-tree and full-history secret scans are reviewed; any real credential is rotated.
- [ ] `pnpm verify:public-boundary` and `pnpm verify:clean-workspace` pass.
- [ ] `pnpm verify:license` and `pnpm verify:public-assets` pass after generated builds.
- [ ] README links and every credential-free setup command pass from a clean clone.
- [ ] Repository description, topics, default branch, issue settings, and social preview are set.
- [ ] No repository visibility, tag, release, or binary action occurs before owner approval.

## Product screenshots

Capture the real current build with intentional sample data and no personal identifiers:

- [ ] Mobile Notes/editor with Markdown Live Preview
- [ ] Mobile Projects/Kanban and Today
- [ ] Tablet drawing with `.stoneink` source and PNG preview
- [ ] Windows editor and project/Today summary
- [ ] Windows GitHub connection/restore without user code, repository identity, or token
- [ ] MCP client showing only synthetic Stone data
- [ ] Light/dark, narrow-window, keyboard, screen-reader labels, and contrast reviewed
- [ ] Images cropped, metadata removed, compressed, and given meaningful alt text

## Windows preview installer

- [ ] Version/tag intent matches package, Tauri, mobile, MCP, changelog, and artifact names.
- [ ] Workflow Variable status is correct and the installer is rebuilt after any change.
- [ ] NSIS artifact and `.sha256` are downloaded and compared.
- [ ] Exact candidate installs, launches, signs in, restarts, and uninstalls on a clean Windows user.
- [ ] Unsigned-binary/reputation limitations are disclosed.

## Android preview APK

- [ ] Unique package ID, owner Firebase config, and signing custody are confirmed.
- [ ] Exact signed APK installs and runs on a physical Android device.
- [ ] Offline edit/restart/sync/conflict/export/account-deletion flows pass.
- [ ] No public APK is announced until physical-device validation passes.

## Private iOS/TestFlight

- [ ] Unique bundle ID and owner Apple/Firebase credentials are confirmed.
- [ ] Archive/upload and private TestFlight install pass on a physical iPhone.
- [ ] No public iOS binary or App Store support is promised.

## Tablet/stylus

- [ ] Pressure, palm/touch behavior, pan/zoom, selection, shapes, save/reopen, export, and sync pass
      on target Android tablet and iPad hardware.

## MCP

- [ ] Operator deploys HTTPS service with private server credentials.
- [ ] OAuth metadata, redirect allow-list, audience/scopes, revisions, idempotency, and audit records
      are verified against the intended provider.
- [ ] Provider publication is described separately from repository availability.
